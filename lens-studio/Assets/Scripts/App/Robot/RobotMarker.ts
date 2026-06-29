import { AppStateData, OperatingMode, RobotInteractionMode } from "../AppState";
import { PoseMessage, protocolMetersToLensCentimeters } from "../../ARBridge/Network/Protocol";
import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { InteractableManipulation } from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation";
import { RoundButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton";
import {
  findChildRecursive,
  requireChild,
} from "../UI/kit/UIKit";
import {
  interpolatePose,
} from "../Utilities/AnimationUtilities";
import {
  yawRotationFromWorldRotation,
} from "../Utilities/Utilities";
import { ManualRegistrationAlignment, RobotMarkerPose } from "../../ARBridge/Registration/ManualRegistrationAlignment";
import { FrameCaptureController } from "../../ARBridge/Camera/FrameCaptureController";
import { UILogEntry } from "../UI/UILogger";
import { RobotUiCallbacks, RobotUiView } from "./RobotUiView";

export type { RobotUiAssistOverlay, RobotUiCallbacks } from "./RobotUiView";

const ROBOT_UI_WORLD_UP_OFFSET_CM = 20.0;

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
  manualPlacement: {
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

class RuntimePoseAnimator {
  private static readonly SMOOTHING_RATE = 18.0;
  private static readonly REALIGN_SNAP_BOOST_RATE = 28.0;
  private static readonly REALIGN_SNAP_DURATION_S = 0.15;

  private _tracking = false;
  private _targetPosition: vec3 | null = null;
  private _targetRotation: quat | null = null;
  private _boostUntil = 0;

  public get isTracking(): boolean {
    return this._tracking;
  }

  public get realignmentVfxActive(): boolean {
    return getTime() < this._boostUntil;
  }

  public reset(): void {
    this._tracking = false;
    this._targetPosition = null;
    this._targetRotation = null;
    this._boostUntil = 0;
  }

  public beginRealignmentSnap(): void {
    this._boostUntil = getTime() + RuntimePoseAnimator.REALIGN_SNAP_DURATION_S;
  }

  public setTarget(
    position: vec3,
    rotation: quat,
    snapImmediate: boolean,
  ): RuntimePoseSetTargetResult {
    this._targetPosition = new vec3(position.x, position.y, position.z);
    this._targetRotation = new quat(
      rotation.w,
      rotation.x,
      rotation.y,
      rotation.z,
    );
    this._tracking = true;

    if (snapImmediate) {
      return "immediate";
    }

    return "track";
  }

  public tick(
    current: { position: vec3; rotation: quat },
    dt: number,
    now: number,
  ): RuntimePoseTickResult | null {
    if (!this._targetPosition || !this._targetRotation) {
      return null;
    }

    if (dt <= 0) {
      return null;
    }

    const rate =
      now < this._boostUntil
        ? RuntimePoseAnimator.REALIGN_SNAP_BOOST_RATE
        : RuntimePoseAnimator.SMOOTHING_RATE;
    const smoothed = interpolatePose(
      current.position,
      this._targetPosition,
      current.rotation,
      this._targetRotation,
      dt,
      rate,
      rate,
    );
    return {
      position: smoothed.position,
      rotation: smoothed.rotation,
      realignmentVfxActive: now < this._boostUntil,
    };
  }
}

/** World-space robot marker with live pose, manual placement, floating robot menu anchor, and interaction-mode switching. */
@component
export class RobotMarker extends BaseScriptComponent {
  @input
  markerRoot: SceneObject;

  @input
  frameCapture: FrameCaptureController;

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

  private _manualRegistrationAlignment: ManualRegistrationAlignment | null = null;
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
    manualRegistrationAlignment: ManualRegistrationAlignment;
    getLastPose: () => PoseMessage | null;
    getIsRuntimePhase: () => boolean;
    getOperatingMode: () => OperatingMode;
    getInteractionMode: () => RobotInteractionMode;
    onWorldPositionChanged?: (position: vec3) => void;
  }): void {
    this._manualRegistrationAlignment = deps.manualRegistrationAlignment;
    this._getLastPose = deps.getLastPose;
    this._getIsRuntimePhase = deps.getIsRuntimePhase;
    this._getOperatingMode = deps.getOperatingMode;
    this._getInteractionMode = deps.getInteractionMode;
    this._onWorldPositionChanged = deps.onWorldPositionChanged ?? null;
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
    if (!this._manualRegistrationAlignment || !this._getLastPose || !this._getInteractionMode) {
      return;
    }
    const lastPose = this._getLastPose();
    const resolved = this._manualRegistrationAlignment.resolveRobotMarkerPose(
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
      case "registration_anchor":
        this.applyManualPose(resolved.position!, resolved.rotation!);
        break;
      case "world_frame_pose":
        if (bridgePose) {
          this.applyPose(bridgePose);
        }
        break;
      case "approximate_alignment":
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
    this.frameCapture?.setRobotWorldPosition(position);
    this._applyRuntimePose(position, rotation);
  }

  public applyManualPose(position: vec3, rotation: quat): void {
    if (!this.markerRoot) {
      return;
    }
    this.resetRuntimePoseSmoothing();
    this.markerRoot.enabled = true;
    this.frameCapture?.setRobotWorldPosition(position);
    this.setPose(position, rotation);
  }

  public applyRuntimeLensPose(position: vec3, rotation: quat): void {
    if (!this.markerRoot) {
      return;
    }
    this.markerRoot.enabled = true;
    this.frameCapture?.setRobotWorldPosition(position);
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

  private _applyRuntimePose(position: vec3, rotation: quat): void {
    if (!this.markerRoot) {
      return;
    }

    const desiredRotation = yawRotationFromWorldRotation(rotation);
    const snapImmediate = !this._poseAnimator.isTracking;
    const result = this._poseAnimator.setTarget(
      position,
      desiredRotation,
      snapImmediate,
    );

    if (result === "immediate") {
      this.setPose(position, desiredRotation);
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
