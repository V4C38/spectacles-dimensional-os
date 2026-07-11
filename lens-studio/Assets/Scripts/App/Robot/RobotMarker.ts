import { AppStateData, OperatingMode, RobotInteractionMode } from "../AppState";
import { PoseMessage, protocolMetersToLensCentimeters } from "../../ARBridge/Network/Protocol";
import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { InteractableManipulation } from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation";
import { RoundButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton";
import {
  findChildRecursive,
  requireChild,
} from "../UI/UIKit";
import {
  interpolatePose,
} from "../Utilities/AnimationUtilities";
import {
  yawRotationFromWorldRotation,
} from "../Utilities/Utilities";
import { ManualRegistrationPlacement, RobotMarkerPose } from "../../ARBridge/Registration/ManualRegistrationPlacement";
import { UILogEntry } from "../UI/UILogger";
import { RobotUiCallbacks, RobotUiView } from "./RobotUiView";

export type { RobotUiAssistOverlay, RobotUiCallbacks } from "./RobotUiView";

const ROBOT_UI_WORLD_UP_OFFSET_CM = 20.0;
const PROTOCOL_M_TO_LENS_CM = 100.0;

type BoolOrActive = boolean | "whenActive";

const INTERACTION_MODE_CONFIG: Record<
  RobotInteractionMode,
  {
    visible: BoolOrActive;
    manualPlacement: boolean;
    toggle: BoolOrActive;
    menu: BoolOrActive;
    syncPose: BoolOrActive;
    menuWhenVisible: "hide" | "operatingMode";
  }
> = {
  hidden: {
    visible: false,
    manualPlacement: false,
    toggle: false,
    menu: false,
    syncPose: false,
    menuWhenVisible: "hide",
  },
  manual_placement: {
    visible: true,
    manualPlacement: true,
    toggle: false,
    menu: false,
    syncPose: true,
    menuWhenVisible: "hide",
  },
  runtimeRobot: {
    visible: "whenActive",
    manualPlacement: false,
    toggle: "whenActive",
    menu: "whenActive",
    syncPose: "whenActive",
    menuWhenVisible: "operatingMode",
  },
};

interface RuntimePoseTickResult {
  position: vec3;
  rotation: quat;
  realignmentVfxActive: boolean;
}

type RuntimePoseSetTargetResult = "immediate" | "track";

type RuntimePoseTarget = {
  position: vec3;
  rotation: quat;
  velocityCmPerS: vec3;
  yawRateRadPerS: number;
  poseTs: number;
  receiveMonoS: number;
};

class RuntimePoseAnimator {
  /** Exponential smoothing rates tuned for infrequent, variable-rate odom ingress. */
  private static readonly SMOOTHING_RATE_MIN = 5.0;
  private static readonly SMOOTHING_RATE_MAX = 9.0;
  /** Rotation eases toward bridge samples; kept lower than position to avoid overshoot. */
  private static readonly SMOOTHING_ROTATION_RATE = 4.5;
  /** Linear speed at which position smoothing reaches ``SMOOTHING_RATE_MAX`` (cm/s). */
  private static readonly SMOOTHING_SPEED_REF_CM_S = 25.0;
  /**
   * When pose age grows (extrapolating between odom samples), scale smoothing rate
   * down toward this fraction so the marker glides instead of chasing stale targets.
   */
  private static readonly STALE_AGE_RATE_FACTOR = 0.35;
  private static readonly REALIGN_SNAP_BOOST_RATE = 28.0;
  private static readonly REALIGN_SNAP_DURATION_S = 0.15;
  /** Bridge odom can arrive irregularly; allow longer velocity extrapolation between samples. */
  private static readonly MAX_EXTRAP_S = 0.55;
  private static readonly MAX_EXTRAP_DISPLACEMENT_CM = 40.0;
  /** Periodic pose-age diagnostics; emit only when extrapolation looks unhealthy. */
  private static readonly POSE_AGE_LOG_INTERVAL_S = 5.0;
  private static readonly POSE_AGE_CLAMP_HIT_LOG_THRESHOLD = 0.1;

  private _tracking = false;
  private _base: RuntimePoseTarget | null = null;
  private _boostUntil = 0;
  private _getRobotClockNowS: (() => number | null) | null = null;
  private _lastPoseAgeLogMono = 0;
  private _recentClampHits = 0;
  private _recentAgeSamples = 0;

  public get isTracking(): boolean {
    return this._tracking;
  }

  public get realignmentVfxActive(): boolean {
    return getTime() < this._boostUntil;
  }

  public setRobotClockNowProvider(getRobotClockNowS: () => number | null): void {
    this._getRobotClockNowS = getRobotClockNowS;
  }

  public reset(): void {
    this._tracking = false;
    this._base = null;
    this._boostUntil = 0;
    this._recentClampHits = 0;
    this._recentAgeSamples = 0;
  }

  public beginRealignmentSnap(): void {
    this._boostUntil = getTime() + RuntimePoseAnimator.REALIGN_SNAP_DURATION_S;
  }

  public setTarget(
    target: RuntimePoseTarget,
    snapImmediate: boolean,
  ): RuntimePoseSetTargetResult {
    this._base = {
      position: new vec3(target.position.x, target.position.y, target.position.z),
      rotation: new quat(
        target.rotation.w,
        target.rotation.x,
        target.rotation.y,
        target.rotation.z,
      ),
      velocityCmPerS: new vec3(
        target.velocityCmPerS.x,
        target.velocityCmPerS.y,
        target.velocityCmPerS.z,
      ),
      yawRateRadPerS: target.yawRateRadPerS,
      poseTs: target.poseTs,
      receiveMonoS: target.receiveMonoS,
    };
    this._tracking = true;

    if (snapImmediate) {
      return "immediate";
    }

    return "track";
  }

  public predictedTarget(now: number): { position: vec3; rotation: quat } | null {
    if (!this._base) {
      return null;
    }
    const ageS = this._poseAgeS(now, true);
    const base = this._base;
    const extrapolation = RuntimePoseAnimator._clampDisplacement(
      new vec3(
        base.velocityCmPerS.x * ageS,
        base.velocityCmPerS.y * ageS,
        base.velocityCmPerS.z * ageS,
      ),
    );
    const position = new vec3(
      base.position.x + extrapolation.x,
      base.position.y + extrapolation.y,
      base.position.z + extrapolation.z,
    );
    const yawDelta = base.yawRateRadPerS * ageS;
    const halfYaw = yawDelta * 0.5;
    const yawQuat = new quat(Math.cos(halfYaw), 0, Math.sin(halfYaw), 0);
    const rotation = base.rotation.multiply(yawQuat);
    return {
      position,
      rotation,
    };
  }

  public tick(
    current: { position: vec3; rotation: quat },
    dt: number,
    now: number,
  ): RuntimePoseTickResult | null {
    const predicted = this.predictedTarget(now);
    if (!predicted || !this._base) {
      return null;
    }

    if (dt <= 0) {
      return null;
    }

    const ageRateFactor = this._ageSmoothingFactor(now);
    const positionRate = this._smoothingRate(now) * ageRateFactor;
    const rotationRate = this._rotationSmoothingRate(now) * ageRateFactor;
    const smoothed = interpolatePose(
      current.position,
      predicted.position,
      current.rotation,
      predicted.rotation,
      dt,
      positionRate,
      rotationRate,
    );
    this._maybeLogPoseAge(now);
    return {
      position: smoothed.position,
      rotation: smoothed.rotation,
      realignmentVfxActive: now < this._boostUntil,
    };
  }

  private _rawPoseAgeS(now: number): number {
    const base = this._base;
    if (!base) {
      return 0;
    }
    const robotNow = this._getRobotClockNowS?.() ?? null;
    if (robotNow !== null) {
      return robotNow - base.poseTs;
    }
    return now - base.receiveMonoS;
  }

  private _poseAgeS(now: number, recordDiagnostics: boolean): number {
    const rawAge = this._rawPoseAgeS(now);
    const clamped = Math.min(
      Math.max(0, rawAge),
      RuntimePoseAnimator.MAX_EXTRAP_S,
    );
    if (recordDiagnostics) {
      this._recentAgeSamples += 1;
      if (rawAge > RuntimePoseAnimator.MAX_EXTRAP_S) {
        this._recentClampHits += 1;
      }
    }
    return clamped;
  }

  private _maybeLogPoseAge(now: number): void {
    if (now - this._lastPoseAgeLogMono < RuntimePoseAnimator.POSE_AGE_LOG_INTERVAL_S) {
      return;
    }
    this._lastPoseAgeLogMono = now;
    const rawAge = this._rawPoseAgeS(now);
    const clampedAge = this._poseAgeS(now, false);
    const clampFraction = this._recentAgeSamples > 0
      ? this._recentClampHits / this._recentAgeSamples
      : 0;
    const shouldLog = rawAge < 0
      || clampFraction >= RuntimePoseAnimator.POSE_AGE_CLAMP_HIT_LOG_THRESHOLD
      || rawAge > RuntimePoseAnimator.MAX_EXTRAP_S;
    if (shouldLog) {
      print(
        `[RuntimePoseAnimator] pose_age raw=${rawAge.toFixed(3)}s `
        + `clamped=${clampedAge.toFixed(3)}s `
        + `clamp_hit_fraction=${clampFraction.toFixed(2)}`,
      );
      if (rawAge < 0) {
        print("[RuntimePoseAnimator] pose_age negative — check clock offset sign");
      }
    }
    this._recentClampHits = 0;
    this._recentAgeSamples = 0;
  }

  private _smoothingRate(now: number): number {
    if (now < this._boostUntil) {
      return RuntimePoseAnimator.REALIGN_SNAP_BOOST_RATE;
    }
    const base = this._base;
    if (!base) {
      return RuntimePoseAnimator.SMOOTHING_RATE_MIN;
    }
    const speed = Math.sqrt(
      base.velocityCmPerS.x * base.velocityCmPerS.x
        + base.velocityCmPerS.y * base.velocityCmPerS.y
        + base.velocityCmPerS.z * base.velocityCmPerS.z,
    );
    const linearMotion = RuntimePoseAnimator._smoothstep01(
      speed / RuntimePoseAnimator.SMOOTHING_SPEED_REF_CM_S,
    );
    return RuntimePoseAnimator.SMOOTHING_RATE_MIN
      + (RuntimePoseAnimator.SMOOTHING_RATE_MAX - RuntimePoseAnimator.SMOOTHING_RATE_MIN) * linearMotion;
  }

  private _rotationSmoothingRate(now: number): number {
    if (now < this._boostUntil) {
      return RuntimePoseAnimator.REALIGN_SNAP_BOOST_RATE;
    }
    return RuntimePoseAnimator.SMOOTHING_ROTATION_RATE;
  }

  /** Slow smoothing further while extrapolating aged odom between sparse updates. */
  private _ageSmoothingFactor(now: number): number {
    const ageS = this._poseAgeS(now, false);
    const staleBlend = RuntimePoseAnimator._smoothstep01(
      ageS / RuntimePoseAnimator.MAX_EXTRAP_S,
    );
    return 1.0
      - (1.0 - RuntimePoseAnimator.STALE_AGE_RATE_FACTOR) * staleBlend;
  }

  private static _clampDisplacement(delta: vec3): vec3 {
    const len = Math.sqrt(delta.x * delta.x + delta.y * delta.y + delta.z * delta.z);
    if (len <= RuntimePoseAnimator.MAX_EXTRAP_DISPLACEMENT_CM || len <= 1e-6) {
      return delta;
    }
    const scale = RuntimePoseAnimator.MAX_EXTRAP_DISPLACEMENT_CM / len;
    return new vec3(delta.x * scale, delta.y * scale, delta.z * scale);
  }

  private static _smoothstep01(x: number): number {
    const t = Math.max(0, Math.min(1, x));
    return t * t * (3 - 2 * t);
  }
}

/** World-space robot marker with live pose, manual placement, floating robot menu anchor, and interaction-mode switching. */
@component
export class RobotMarker extends BaseScriptComponent {
  @input
  markerRoot: SceneObject;

  private readonly _poseAnimator = new RuntimePoseAnimator();
  private _configured = false;
  private _placementHandle: SceneObject | null = null;
  private _manualCollider: ColliderComponent | null = null;
  private _manualInteractable: Interactable | null = null;
  private _manualManipulation: InteractableManipulation | null = null;
  private _toggleRoot: SceneObject | null = null;
  private _directionArrow: SceneObject | null = null;
  private _toggleCollider: ColliderComponent | null = null;
  private _toggleButton: RoundButton | null = null;
  private _menuRoot: SceneObject | null = null;
  private _buttonVfxActive: SceneObject | null = null;
  private _buttonVfxInactive: SceneObject | null = null;
  private _manualPlacementActive = false;
  private _debugMode = false;
  private _renderOffsetCm = vec3.zero();
  private _toggleBaseLocalPosition: vec3 | null = null;
  private _directionArrowBaseLocalPosition: vec3 | null = null;
  private _placementHandleBaseLocalPosition: vec3 | null = null;
  private _rotation = quat.quatIdentity();
  private _lastNotifiedWorldPosition: vec3 | null = null;

  private _manualRegistrationPlacement: ManualRegistrationPlacement | null = null;
  private _ui: RobotUiView | null = null;
  private _getLastPose: (() => PoseMessage | null) | null = null;
  private _getIsRuntimePhase: (() => boolean) | null = null;
  private _getOperatingMode: (() => OperatingMode) | null = null;
  private _getInteractionMode: (() => RobotInteractionMode) | null = null;
  private _onWorldPositionChanged: ((position: vec3) => void) | null = null;

  public get ui(): RobotUiView | null {
    return this._ui;
  }

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this._configureVisuals();
      this.setVisible(false);
    });
    this.createEvent("UpdateEvent").bind(() => {
      if (this._manualPlacementActive) {
        this.syncRotationFromScene();
      } else if (this._poseAnimator.isTracking) {
        this._tickRuntimePoseSmoothing();
      }
      this._notifyWorldPositionIfMoved();
      this._syncMenuWorldAnchor();
    });
  }

  public initialize(deps: {
    manualRegistrationPlacement: ManualRegistrationPlacement;
    getLastPose: () => PoseMessage | null;
    getIsRuntimePhase: () => boolean;
    getOperatingMode: () => OperatingMode;
    getInteractionMode: () => RobotInteractionMode;
    getRobotClockNowS?: () => number | null;
    onWorldPositionChanged?: (position: vec3) => void;
  }): void {
    this._manualRegistrationPlacement = deps.manualRegistrationPlacement;
    this._getLastPose = deps.getLastPose;
    this._getIsRuntimePhase = deps.getIsRuntimePhase;
    this._getOperatingMode = deps.getOperatingMode;
    this._getInteractionMode = deps.getInteractionMode;
    this._onWorldPositionChanged = deps.onWorldPositionChanged ?? null;
    this._poseAnimator.setRobotClockNowProvider(
      deps.getRobotClockNowS ?? (() => null),
    );
    this._ensureUi();
  }

  public bindUiCallbacks(callbacks: RobotUiCallbacks): void {
    this._ensureUi();
    this._ui?.bindCallbacks(callbacks);
  }

  public applyAppState(state: AppStateData, uiLogEntry: UILogEntry | null = null): void {
    this._ensureUi();
    this._ui?.syncFromState(state, uiLogEntry);
  }

  public applyInteractionMode(mode: RobotInteractionMode): void {
    const config = INTERACTION_MODE_CONFIG[mode];
    const isRuntimePhase = this._getIsRuntimePhase?.() ?? false;
    const resolve = (value: BoolOrActive): boolean =>
      value === "whenActive" ? isRuntimePhase : value;

    this.setManualPlacementEnabled(config.manualPlacement);
    this.setToggleEnabled(resolve(config.toggle));
    this.setMenuEnabled(resolve(config.menu));
    this.setVisible(resolve(config.visible));

    const view = this._ui;
    const markerVisible = resolve(config.visible);
    if (!markerVisible || config.menuWhenVisible === "hide") {
      view?.hide();
    } else if (config.menuWhenVisible === "operatingMode") {
      const opMode = this._getOperatingMode?.();
      if (opMode) {
        view?.setOperatingMode(opMode);
      }
    }

    if (resolve(config.syncPose)) {
      this.syncPose();
    }
  }

  public syncPose(): void {
    if (!this._manualRegistrationPlacement || !this._getLastPose || !this._getInteractionMode) {
      return;
    }
    const lastPose = this._getLastPose();
    const resolved = this._manualRegistrationPlacement.resolveRobotMarkerPose(
      lastPose,
      this._getInteractionMode(),
    );
    this._applyRobotMarkerPoseInternal(resolved, lastPose);
  }

  public applyRobotMarkerPose(resolved: RobotMarkerPose, bridgePose: PoseMessage | null): void {
    this._applyRobotMarkerPoseInternal(resolved, bridgePose);
  }

  private _applyRobotMarkerPoseInternal(
    resolved: RobotMarkerPose,
    bridgePose: PoseMessage | null,
  ): void {
    switch (resolved.source) {
      case "manual_anchor":
        this.applyManualPose(resolved.position!, resolved.rotation!);
        break;
      case "world_frame_pose":
        if (bridgePose) {
          this.applyPose(bridgePose);
        }
        break;
      case "approximate_pose":
        this.applyRuntimeLensPose(resolved.position!, resolved.rotation!);
        break;
      case "none":
        break;
    }
  }

  public applyPose(msg: PoseMessage): void {
    if (!this.markerRoot) {
      return;
    }
    this.markerRoot.enabled = true;
    const q = msg.orientation;
    const position = protocolMetersToLensCentimeters(msg.position);
    const rotation = new quat(q[3], q[0], q[1], q[2]);
    const velocity = msg.velocity_mps;
    const velocityCmPerS = velocity
      ? new vec3(
        velocity[0] * PROTOCOL_M_TO_LENS_CM,
        velocity[1] * PROTOCOL_M_TO_LENS_CM,
        velocity[2] * PROTOCOL_M_TO_LENS_CM,
      )
      : vec3.zero();
    this._applyRuntimePose(position, rotation, {
      velocityCmPerS,
      yawRateRadPerS: msg.yaw_rate_rad_s ?? 0,
      poseTs: msg.ts,
    });
  }

  public applyManualPose(position: vec3, rotation: quat): void {
    if (!this.markerRoot) {
      return;
    }
    this.resetRuntimePoseSmoothing();
    this.markerRoot.enabled = true;
    this.setPose(position, rotation);
  }

  public applyRuntimeLensPose(position: vec3, rotation: quat): void {
    if (!this.markerRoot) {
      return;
    }
    this.markerRoot.enabled = true;
    this._applyRuntimePose(position, rotation);
  }

  public beginRealignmentSnap(): void {
    this._poseAnimator.beginRealignmentSnap();
  }

  public setDebugMode(enabled: boolean): void {
    this._debugMode = enabled;
    this._syncDirectionArrowVisibility();
  }

  public setVisible(visible: boolean): void {
    if (this.markerRoot) {
      this.markerRoot.enabled = visible;
    }
    if (!visible) {
      this.resetRuntimePoseSmoothing();
      this._lastNotifiedWorldPosition = null;
    }
    if (this._menuRoot && visible) {
      this._menuRoot.enabled = visible;
    }
  }

  public resetRuntimePoseSmoothing(): void {
    if (this._poseAnimator.realignmentVfxActive) {
      this._setRealignmentVfx(false);
    }
    this._poseAnimator.reset();
  }

  public setMenuEnabled(enabled: boolean): void {
    if (!this._configured) {
      this._configureVisuals();
    }
    if (this._menuRoot && !enabled) {
      this._menuRoot.enabled = enabled;
    }
  }

  public setToggleEnabled(enabled: boolean): void {
    if (!this._configured) {
      this._configureVisuals();
    }
    if (this._toggleCollider) {
      this._toggleCollider.enabled = enabled;
    }
    if (this._toggleButton) {
      this._toggleButton.enabled = enabled;
    }
  }

  public setManualPlacementEnabled(enabled: boolean): void {
    if (!this._configured) {
      this._configureVisuals();
    }
    this._manualPlacementActive = enabled;
    if (enabled) {
      this.resetRuntimePoseSmoothing();
    }
    if (this._placementHandle) {
      this._placementHandle.enabled = enabled;
    }
    if (this._manualCollider) {
      this._manualCollider.enabled = enabled;
    }
    if (this._manualInteractable) {
      this._manualInteractable.enabled = enabled;
      (this._manualInteractable as any).enableInstantDrag = enabled;
      (this._manualInteractable as any).useFilteredPinch = enabled;
    }
    if (this._manualManipulation) {
      this._manualManipulation.enabled = enabled;
    }
    if (enabled) {
      this.syncRotationFromScene();
    }
    this._syncDirectionArrowVisibility();
  }

  public getWorldPosition(): vec3 | null {
    if (!this.markerRoot) {
      return null;
    }
    return this.markerRoot.getTransform().getWorldPosition();
  }

  public getRotation(): quat | null {
    if (!this.markerRoot) {
      return null;
    }
    return this._rotation;
  }

  public setRotation(rotation: quat): void {
    if (!this.markerRoot) {
      return;
    }
    this._rotation = yawRotationFromWorldRotation(rotation);
    this.markerRoot.getTransform().setWorldRotation(this._rotation);
  }

  public setPose(position: vec3, rotation: quat): void {
    if (!this.markerRoot) {
      return;
    }
    this.markerRoot.getTransform().setWorldPosition(position);
    this.setRotation(rotation);
    this._syncMenuWorldAnchor();
    this._notifyWorldPositionChanged(position);
  }

  public syncRotationFromScene(): void {
    if (!this.markerRoot) {
      return;
    }
    this._rotation = yawRotationFromWorldRotation(
      this.markerRoot.getTransform().getWorldRotation(),
    );
  }

  public getMenuRoot(): SceneObject | null {
    if (this._menuRoot) {
      return this._menuRoot;
    }
    if (!this.markerRoot) {
      return null;
    }
    const searchRoot = this.markerRoot.getParent() ?? this.markerRoot;
    try {
      this._menuRoot = requireChild(searchRoot, "RobotUI", "RobotMarker");
    } catch (_error) {
      return null;
    }
    return this._menuRoot;
  }

  public setRenderOffsetCm(offsetCm: vec3): void {
    this._renderOffsetCm = offsetCm;
    this._syncVisualOffsets();
  }

  private _ensureUi(): void {
    if (this._ui || !this.markerRoot) {
      return;
    }
    if (!this._configured) {
      this._configureVisuals();
    }
    const menuRoot = this._menuRoot;
    if (!menuRoot) {
      return;
    }
    this._ui = new RobotUiView(this.markerRoot, menuRoot);
  }

  private _configureVisuals(): void {
    if (!this.markerRoot || this._configured) {
      return;
    }
    this._configured = true;
    this._menuRoot = this.getMenuRoot();
    if (!this._menuRoot) {
      throw new Error("RobotMarker: Missing scene object RobotUI");
    }

    const childBindings: Array<{ name: string; assign: (obj: SceneObject) => void }> = [
      {
        name: "RobotPlacementHandle",
        assign: (obj) => {
          this._placementHandle = obj;
          this._placementHandleBaseLocalPosition = obj.getTransform().getLocalPosition();
        },
      },
      {
        name: "RobotToggleButton",
        assign: (obj) => {
          this._toggleRoot = obj;
          this._toggleBaseLocalPosition = obj.getTransform().getLocalPosition();
        },
      },
      {
        name: "RobotDirectionArrow",
        assign: (obj) => {
          this._directionArrow = obj;
          this._directionArrow.enabled = false;
          this._directionArrowBaseLocalPosition = obj.getTransform().getLocalPosition();
        },
      },
    ];

    for (const binding of childBindings) {
      binding.assign(
        requireChild(this.markerRoot, binding.name, "RobotMarker"),
      );
    }

    if (this._placementHandle) {
      this._manualCollider = this._placementHandle.getComponent(
        "Component.ColliderComponent",
      ) as ColliderComponent;
      this._manualInteractable = this._placementHandle.getComponent(
        Interactable.getTypeName(),
      ) as Interactable;
      this._manualManipulation = this._placementHandle.getComponent(
        InteractableManipulation.getTypeName(),
      ) as InteractableManipulation;
    }

    if (this._toggleRoot) {
      this._toggleCollider = this._toggleRoot.getComponent(
        "Component.ColliderComponent",
      ) as ColliderComponent;
      this._toggleButton = this._toggleRoot.getComponent(
        RoundButton.getTypeName(),
      ) as RoundButton;
      this._buttonVfxActive = findChildRecursive(this._toggleRoot, "ButtonVFX_Active");
      this._buttonVfxInactive = findChildRecursive(this._toggleRoot, "ButtonVFX_Inactive");
    }

    if (
      !this._manualCollider ||
      !this._manualInteractable ||
      !this._manualManipulation ||
      !this._toggleButton
    ) {
      throw new Error(
        "RobotMarker: Robot marker is missing authored interaction components",
      );
    }

    const manualInteractable = this._manualInteractable as any;
    if (manualInteractable?.onTriggerEnd?.add) {
      manualInteractable.onTriggerEnd.add(() => {
        this.syncRotationFromScene();
      });
    }

    this.setToggleEnabled(false);
    this.setMenuEnabled(false);
    this.setManualPlacementEnabled(false);
    this.syncRotationFromScene();
    this._syncVisualOffsets();
    this._syncMenuWorldAnchor();
  }

  private _applyRuntimePose(
    position: vec3,
    rotation: quat,
    kinematics?: {
      velocityCmPerS: vec3;
      yawRateRadPerS: number;
      poseTs: number;
    },
  ): void {
    if (!this.markerRoot) {
      return;
    }

    const desiredRotation = yawRotationFromWorldRotation(rotation);
    const snapImmediate = !this._poseAnimator.isTracking;
    const receiveMonoS = getTime();
    const result = this._poseAnimator.setTarget(
      {
        position,
        rotation: desiredRotation,
        velocityCmPerS: kinematics?.velocityCmPerS ?? vec3.zero(),
        yawRateRadPerS: kinematics?.yawRateRadPerS ?? 0,
        poseTs: kinematics?.poseTs ?? receiveMonoS,
        receiveMonoS,
      },
      snapImmediate,
    );

    if (result === "immediate") {
      const predicted = this._poseAnimator.predictedTarget(receiveMonoS);
      if (predicted) {
        this.setPose(predicted.position, predicted.rotation);
      } else {
        this.setPose(position, desiredRotation);
      }
      return;
    }

    this._setRealignmentVfx(this._poseAnimator.realignmentVfxActive);
  }

  private _tickRuntimePoseSmoothing(): void {
    if (!this.markerRoot) {
      return;
    }

    const transform = this.markerRoot.getTransform();
    const tickResult = this._poseAnimator.tick(
      {
        position: transform.getWorldPosition(),
        rotation: this.getRotation() ?? quat.quatIdentity(),
      },
      getDeltaTime(),
      getTime(),
    );
    if (!tickResult) {
      return;
    }

    transform.setWorldPosition(tickResult.position);
    this.setRotation(tickResult.rotation);
    this._setRealignmentVfx(tickResult.realignmentVfxActive);
  }

  private _notifyWorldPositionIfMoved(): void {
    if (!this.markerRoot) {
      return;
    }
    this._notifyWorldPositionChanged(
      this.markerRoot.getTransform().getWorldPosition(),
    );
  }

  private _notifyWorldPositionChanged(position: vec3): void {
    if (!this._onWorldPositionChanged) {
      return;
    }
    if (
      this._lastNotifiedWorldPosition &&
      this._lastNotifiedWorldPosition.distance(position) < 0.01
    ) {
      return;
    }
    this._lastNotifiedWorldPosition = new vec3(position.x, position.y, position.z);
    this._onWorldPositionChanged(this._lastNotifiedWorldPosition);
  }

  private _syncMenuWorldAnchor(): void {
    if (!this.markerRoot || !this._menuRoot) {
      return;
    }

    const rootPosition = this.markerRoot.getTransform().getWorldPosition();
    this._menuRoot.getTransform().setWorldPosition(
      new vec3(
        rootPosition.x,
        rootPosition.y + ROBOT_UI_WORLD_UP_OFFSET_CM,
        rootPosition.z,
      ),
    );
  }

  private _syncDirectionArrowVisibility(): void {
    if (!this._directionArrow && this.markerRoot) {
      this._directionArrow = findChildRecursive(this.markerRoot, "RobotDirectionArrow");
    }
    if (!this._directionArrow) {
      return;
    }
    this._directionArrow.enabled = this._debugMode || this._manualPlacementActive;
  }

  private _setRealignmentVfx(snapping: boolean): void {
    if (this._buttonVfxActive) {
      this._buttonVfxActive.enabled = !snapping;
    }
    if (this._buttonVfxInactive) {
      this._buttonVfxInactive.enabled = snapping;
    }
  }

  private _syncVisualOffsets(): void {
    if (this._toggleRoot && this._toggleBaseLocalPosition) {
      this._toggleRoot.getTransform().setLocalPosition(
        this._toggleBaseLocalPosition.add(this._renderOffsetCm),
      );
    }
    if (this._directionArrow && this._directionArrowBaseLocalPosition) {
      this._directionArrow.getTransform().setLocalPosition(
        this._directionArrowBaseLocalPosition.add(this._renderOffsetCm),
      );
    }
    if (this._placementHandle && this._placementHandleBaseLocalPosition) {
      this._placementHandle.getTransform().setLocalPosition(
        this._placementHandleBaseLocalPosition.add(this._renderOffsetCm),
      );
    }
  }
}
