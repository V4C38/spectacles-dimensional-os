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
  yawRotationFromWorldRotation,
} from "../Utilities/Utilities";
import { ManualRegistrationPlacement, RobotMarkerPose } from "../../ARBridge/Registration/ManualRegistrationPlacement";
import { UILogEntry } from "../UI/UILogger";
import { RobotUiCallbacks, RobotUiView } from "./RobotUiView";
import { RuntimePoseAnimator } from "./RuntimePoseAnimator";
import { RobotRuntimeState } from "../AppState";
import {
  runtimeBodyBoundsCenterOffsetCm,
  runtimeBodyBoundsScaleCm,
} from "./RobotRuntimeModel";

export type { RobotUiAssistOverlay, RobotUiCallbacks } from "./RobotUiView";

const ROBOT_UI_WORLD_UP_OFFSET_CM = 10.0;
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
  private _debugView: SceneObject | null = null;
  private _boundingBox: SceneObject | null = null;
  private _toggleCollider: ColliderComponent | null = null;
  private _toggleButton: RoundButton | null = null;
  private _menuRoot: SceneObject | null = null;
  private _manualPlacementActive = false;
  private _debugMode = false;
  private _renderOffsetCm = vec3.zero();
  private _toggleBaseLocalPosition: vec3 | null = null;
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
      speedMps: typeof msg.speed_mps === "number" ? msg.speed_mps : null,
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

  public setDebugMode(enabled: boolean): void {
    this._debugMode = enabled;
    this._syncDebugViewVisibility();
  }

  public setDebugBoundsFromRuntime(runtime: RobotRuntimeState): void {
    if (!this._configured) {
      this._configureVisuals();
    }
    this._syncDebugBounds(runtime);
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
    this._poseAnimator.reset();
  }

  public setPathGoal(goal: vec3 | null): void {
    this._poseAnimator.setPathGoal(goal);
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
    this._syncDebugViewVisibility();
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
        name: "RobotDebugView",
        assign: (obj) => {
          this._debugView = obj;
          this._debugView.enabled = false;
          this._boundingBox = findChildRecursive(obj, "BoundingBox");
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
      speedMps: number | null;
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
        speedMps: kinematics?.speedMps ?? null,
        poseTs: kinematics?.poseTs ?? receiveMonoS,
        receiveMonoS,
      },
      snapImmediate,
    );

    if (result === "immediate") {
      const unified = this._poseAnimator.computeUnifiedTarget(receiveMonoS);
      if (unified) {
        this.setPose(unified.position, unified.rotation);
      } else {
        this.setPose(position, desiredRotation);
      }
    }
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

  private _syncDebugViewVisibility(): void {
    if (!this._debugView && this.markerRoot) {
      this._debugView = findChildRecursive(this.markerRoot, "RobotDebugView");
    }
    if (!this._debugView) {
      return;
    }
    this._debugView.enabled = this._debugMode || this._manualPlacementActive;
  }

  private _syncDebugBounds(runtime: RobotRuntimeState): void {
    if (!this._boundingBox && this._debugView) {
      this._boundingBox = findChildRecursive(this._debugView, "BoundingBox");
    }
    if (!this._boundingBox) {
      return;
    }
    const scale = runtimeBodyBoundsScaleCm(runtime);
    const centerOffset = runtimeBodyBoundsCenterOffsetCm(runtime);
    if (!scale || !centerOffset) {
      return;
    }
    const transform = this._boundingBox.getTransform();
    transform.setLocalScale(scale);
    transform.setLocalPosition(centerOffset);
  }

  private _syncVisualOffsets(): void {
    if (this._toggleRoot && this._toggleBaseLocalPosition) {
      this._toggleRoot.getTransform().setLocalPosition(
        this._toggleBaseLocalPosition.add(this._renderOffsetCm),
      );
    }
    if (this._placementHandle && this._placementHandleBaseLocalPosition) {
      this._placementHandle.getTransform().setLocalPosition(
        this._placementHandleBaseLocalPosition.add(this._renderOffsetCm),
      );
    }
  }
}
