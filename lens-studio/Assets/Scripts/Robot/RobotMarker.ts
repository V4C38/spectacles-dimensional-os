import { OperatingMode, RobotInteractionMode } from "../Core/AppState";
import { PoseMessage, protocolMetersToLensCentimeters } from "../Bridge/Protocol";
import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { InteractableManipulation } from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation";
import { RoundButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton";
import { findChildRecursive, requireChild } from "../UI/kit/UIKit";
import {
  quatAngularDistanceRad,
  vec3Distance,
  yawRotationFromWorldRotation,
} from "../Core/MathUtils";
import { FrameCaptureController } from "../Alignment/FrameCaptureController";
import { ManualPoseCorrection, ResolvedDisplayPose } from "../Alignment/ManualPoseCorrection";
import { RobotMarkerView } from "./RobotMarkerView";

const ROBOT_UI_WORLD_UP_OFFSET_CM = 15.0;

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
  commitPose: boolean;
}

type RuntimePoseSetTargetResult = "immediate" | "track" | "rejected";

class RuntimePoseAnimator {
  private static readonly POSITION_DEADBAND_CM = 0.75;
  private static readonly ROTATION_DEADBAND_RAD = (1.0 * Math.PI) / 180.0;
  private static readonly POSITION_SNAP_CM = 0.2;
  private static readonly ROTATION_SNAP_RAD = (0.25 * Math.PI) / 180.0;
  private static readonly SMOOTHING_RATE = 14.0;
  private static readonly REALIGN_SNAP_DURATION_S = 0.2;

  private _tracking = false;
  private _targetPosition: vec3 | null = null;
  private _targetRotation: quat | null = null;
  private _snapRequested = false;
  private _snapActive = false;
  private _snapStartTime = 0;
  private _snapStartPosition: vec3 | null = null;
  private _snapStartRotation: quat | null = null;

  public get isTracking(): boolean {
    return this._tracking;
  }

  public get realignmentVfxActive(): boolean {
    return this._snapActive;
  }

  public reset(): void {
    this._tracking = false;
    this._targetPosition = null;
    this._targetRotation = null;
    this._snapRequested = false;
    this._snapActive = false;
    this._snapStartPosition = null;
    this._snapStartRotation = null;
  }

  public beginRealignmentSnap(): void {
    this._snapRequested = true;
  }

  public setTarget(
    position: vec3,
    rotation: quat,
    snapImmediate: boolean,
    currentPose?: { position: vec3; rotation: quat },
  ): RuntimePoseSetTargetResult {
    if (
      !this._snapRequested &&
      this._tracking &&
      this._targetPosition &&
      this._targetRotation
    ) {
      const positionDelta = vec3Distance(this._targetPosition, position);
      const rotationDelta = quatAngularDistanceRad(
        this._targetRotation,
        rotation,
      );
      if (
        positionDelta < RuntimePoseAnimator.POSITION_DEADBAND_CM &&
        rotationDelta < RuntimePoseAnimator.ROTATION_DEADBAND_RAD
      ) {
        return "rejected";
      }
    }

    this._targetPosition = new vec3(position.x, position.y, position.z);
    this._targetRotation = new quat(
      rotation.w,
      rotation.x,
      rotation.y,
      rotation.z,
    );
    this._tracking = true;

    if (snapImmediate) {
      this._snapRequested = false;
      return "immediate";
    }

    if (this._snapRequested && currentPose) {
      this._snapRequested = false;
      this._snapStartPosition = new vec3(
        currentPose.position.x,
        currentPose.position.y,
        currentPose.position.z,
      );
      this._snapStartRotation = new quat(
        currentPose.rotation.w,
        currentPose.rotation.x,
        currentPose.rotation.y,
        currentPose.rotation.z,
      );
      this._snapStartTime = getTime();
      this._snapActive = true;
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

    if (this._snapActive && this._snapStartPosition && this._snapStartRotation) {
      const elapsed = now - this._snapStartTime;
      const rawT = elapsed / RuntimePoseAnimator.REALIGN_SNAP_DURATION_S;
      if (rawT >= 1.0) {
        this._snapActive = false;
        this._snapStartPosition = null;
        this._snapStartRotation = null;
        return {
          position: this._targetPosition,
          rotation: this._targetRotation,
          realignmentVfxActive: false,
          commitPose: true,
        };
      }
      const t = 1.0 - Math.pow(1.0 - rawT, 3);
      return {
        position: vec3.lerp(this._snapStartPosition, this._targetPosition, t),
        rotation: quat.slerp(
          this._snapStartRotation,
          this._targetRotation,
          t,
        ),
        realignmentVfxActive: true,
        commitPose: false,
      };
    }

    const positionDelta = vec3Distance(current.position, this._targetPosition);
    const rotationDelta = quatAngularDistanceRad(
      current.rotation,
      this._targetRotation,
    );
    if (
      positionDelta <= RuntimePoseAnimator.POSITION_SNAP_CM &&
      rotationDelta <= RuntimePoseAnimator.ROTATION_SNAP_RAD
    ) {
      return {
        position: this._targetPosition,
        rotation: this._targetRotation,
        realignmentVfxActive: false,
        commitPose: true,
      };
    }

    const alpha = 1.0 - Math.exp(-RuntimePoseAnimator.SMOOTHING_RATE * dt);
    return {
      position: vec3.lerp(current.position, this._targetPosition, alpha),
      rotation: quat.slerp(current.rotation, this._targetRotation, alpha),
      realignmentVfxActive: false,
      commitPose: false,
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

  private _poseCorrection: ManualPoseCorrection | null = null;
  private _robotMarkerView: RobotMarkerView | null = null;
  private _getLastPose: (() => PoseMessage | null) | null = null;
  private _getIsRuntimePhase: (() => boolean) | null = null;
  private _getOperatingMode: (() => OperatingMode) | null = null;
  private _getInteractionMode: (() => RobotInteractionMode) | null = null;
  private _syncNavPlacement: (() => void) | null = null;
  private _onWorldPositionChanged: ((position: vec3) => void) | null = null;

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
    poseCorrection: ManualPoseCorrection;
    getLastPose: () => PoseMessage | null;
    robotMarkerView: RobotMarkerView | null;
    getIsRuntimePhase: () => boolean;
    getOperatingMode: () => OperatingMode;
    getInteractionMode: () => RobotInteractionMode;
    syncNavigationPlacementState: () => void;
    onWorldPositionChanged?: (position: vec3) => void;
  }): void {
    this._poseCorrection = deps.poseCorrection;
    this._getLastPose = deps.getLastPose;
    this._robotMarkerView = deps.robotMarkerView;
    this._getIsRuntimePhase = deps.getIsRuntimePhase;
    this._getOperatingMode = deps.getOperatingMode;
    this._getInteractionMode = deps.getInteractionMode;
    this._syncNavPlacement = deps.syncNavigationPlacementState;
    this._onWorldPositionChanged = deps.onWorldPositionChanged ?? null;
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

    const view = this._robotMarkerView;
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

    this._syncNavPlacement?.();
  }

  public syncPose(): void {
    if (!this._poseCorrection || !this._getLastPose || !this._getInteractionMode) {
      return;
    }
    const lastPose = this._getLastPose();
    const resolved = this._poseCorrection.resolveDisplayPose(
      lastPose,
      this._getInteractionMode(),
    );
    this._applyResolvedPoseInternal(resolved, lastPose);
  }

  public applyResolvedPose(resolved: ResolvedDisplayPose, bridgePose: PoseMessage | null): void {
    this._applyResolvedPoseInternal(resolved, bridgePose);
  }

  private _applyResolvedPoseInternal(
    resolved: ResolvedDisplayPose,
    bridgePose: PoseMessage | null,
  ): void {
    switch (resolved.kind) {
      case "manual":
        this.applyManualPose(resolved.position!, resolved.rotation!);
        break;
      case "bridge":
        if (bridgePose) {
          this.applyPose(bridgePose);
        }
        break;
      case "corrected":
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
      this._menuRoot = requireChild(searchRoot, "RobotUIRoot", "RobotMarker");
    } catch (_error) {
      return null;
    }
    return this._menuRoot;
  }

  public setRenderOffsetCm(offsetCm: vec3): void {
    this._renderOffsetCm = offsetCm;
    this._syncVisualOffsets();
  }

  private _configureVisuals(): void {
    if (!this.markerRoot || this._configured) {
      return;
    }
    this._configured = true;
    this._menuRoot = this.getMenuRoot();
    if (!this._menuRoot) {
      throw new Error("RobotMarker: Missing scene object RobotUIRoot");
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
    const transform = this.markerRoot.getTransform();
    const result = this._poseAnimator.setTarget(
      position,
      desiredRotation,
      snapImmediate,
      snapImmediate
        ? undefined
        : {
            position: transform.getWorldPosition(),
            rotation: this.getRotation() ?? quat.quatIdentity(),
          },
    );

    if (result === "rejected") {
      return;
    }

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

    if (tickResult.commitPose) {
      this.setPose(tickResult.position, tickResult.rotation);
    } else {
      transform.setWorldPosition(tickResult.position);
      this.setRotation(tickResult.rotation);
    }
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
