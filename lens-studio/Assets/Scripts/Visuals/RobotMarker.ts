import {
  AppStateListener,
  DimosAppState,
  navigationOutcomePresentation,
  robotMarkerSteadyStatePresentation,
} from "../AppState";
import { PoseMessage, protocolMetersToLensCentimeters } from "../Network/Protocol";
import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { InteractableManipulation } from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation";
import { RoundButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton";
import { yawRotationFromWorldRotation } from "../Navigation/HeadingRotation";
import { findText, findChildRecursive, requireChild } from "../UI/Shared/UICore";
import { vec3Distance, quatAngularDistanceRad } from "../Shared/MathUtils";

const ROBOT_UI_WORLD_UP_OFFSET_CM = 15.0;
const POSITION_DEADBAND_CM = 0.75;
const ROTATION_DEADBAND_RAD = (1.0 * Math.PI) / 180.0;
const RUNTIME_POSE_SMOOTHING_RATE = 14.0;

/** World-space robot marker with live pose, manual placement, and floating robot menu anchor. */
@component
export class RobotMarker extends BaseScriptComponent {
  @input
  markerRoot: SceneObject;

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
  private _runtimeTrackingActive = false;
  private _runtimeTargetPosition: vec3 | null = null;
  private _runtimeTargetRotation: quat | null = null;
  private _manualPlacementActive = false;
  private _renderOffsetCm = vec3.zero();
  private _toggleBaseLocalPosition: vec3 | null = null;
  private _directionArrowBaseLocalPosition: vec3 | null = null;
  private _placementHandleBaseLocalPosition: vec3 | null = null;
  private _debugInfoText: Text | null = null;
  private _unsubscribeAppState: (() => void) | null = null;
  private _debugMode = false;
  private _rotation = quat.quatIdentity();
  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this._configureVisuals();
      this.setVisible(false);
    });
    this.createEvent("UpdateEvent").bind(() => {
      if (this._manualPlacementActive) {
        this.syncRotationFromScene();
      } else if (this._runtimeTrackingActive) {
        this._tickRuntimePoseSmoothing();
      }
      this._syncMenuWorldAnchor();
    });
    this.createEvent("OnDestroyEvent").bind(() => {
      this._unsubscribeAppState?.();
      this._unsubscribeAppState = null;
    });
  }

  public bindAppState(
    subscribe: (listener: AppStateListener) => () => void,
  ): void {
    this._unsubscribeAppState?.();
    this._unsubscribeAppState = subscribe((state) => this._applyDebugInfo(state));
  }

  public applyPose(msg: PoseMessage): void {
    if (!this.markerRoot) {
      return;
    }
    this.markerRoot.enabled = true;
    const q = msg.orientation;
    const position = protocolMetersToLensCentimeters(msg.position);
    const rotation = new quat(q[3], q[0], q[1], q[2]);
    this._applyRuntimePose(position, rotation);
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

  public setVisible(visible: boolean): void {
    if (this.markerRoot) {
      this.markerRoot.enabled = visible;
    }
    if (!visible) {
      this.resetRuntimePoseSmoothing();
    }
    if (this._menuRoot && visible) {
      this._menuRoot.enabled = visible;
    }
  }

  public resetRuntimePoseSmoothing(): void {
    this._runtimeTrackingActive = false;
    this._runtimeTargetPosition = null;
    this._runtimeTargetRotation = null;
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
    const placementHandle = requireChild(
      this.markerRoot,
      "RobotPlacementHandle",
      "RobotMarker",
    );
    const toggleRoot = requireChild(
      this.markerRoot,
      "RobotToggleButton",
      "RobotMarker",
    );
    const directionArrow = requireChild(
      this.markerRoot,
      "RobotDirectionArrow",
      "RobotMarker",
    );
    this._toggleRoot = toggleRoot;
    this._directionArrow = directionArrow;
    this._directionArrow.enabled = false;
    this._placementHandle = placementHandle;
    this._toggleBaseLocalPosition = toggleRoot.getTransform().getLocalPosition();
    this._directionArrowBaseLocalPosition = directionArrow.getTransform().getLocalPosition();
    this._placementHandleBaseLocalPosition = placementHandle.getTransform().getLocalPosition();
    this._manualCollider = placementHandle.getComponent(
      "Component.ColliderComponent",
    ) as ColliderComponent;
    this._manualInteractable = placementHandle.getComponent(
      Interactable.getTypeName(),
    ) as Interactable;
    this._manualManipulation = placementHandle.getComponent(
      InteractableManipulation.getTypeName(),
    ) as InteractableManipulation;
    this._toggleCollider = toggleRoot.getComponent(
      "Component.ColliderComponent",
    ) as ColliderComponent;
    this._toggleButton = toggleRoot.getComponent(
      RoundButton.getTypeName(),
    ) as RoundButton;
    this._debugInfoText = findText(this.markerRoot, "DebugInfoText");
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
    const snapImmediate = !this._runtimeTrackingActive;

    if (this._runtimeTrackingActive && this._runtimeTargetPosition && this._runtimeTargetRotation) {
      const positionDelta = vec3Distance(this._runtimeTargetPosition, position);
      const rotationDelta = quatAngularDistanceRad(
        this._runtimeTargetRotation,
        desiredRotation,
      );
      if (
        positionDelta < POSITION_DEADBAND_CM &&
        rotationDelta < ROTATION_DEADBAND_RAD
      ) {
        return;
      }
    }

    this._runtimeTargetPosition = new vec3(position.x, position.y, position.z);
    this._runtimeTargetRotation = new quat(
      desiredRotation.w,
      desiredRotation.x,
      desiredRotation.y,
      desiredRotation.z,
    );
    this._runtimeTrackingActive = true;

    if (snapImmediate) {
      this.setPose(position, desiredRotation);
    }
  }

  private _tickRuntimePoseSmoothing(): void {
    if (
      !this.markerRoot ||
      !this._runtimeTargetPosition ||
      !this._runtimeTargetRotation
    ) {
      return;
    }

    const dt = getDeltaTime();
    if (dt <= 0) {
      return;
    }

    const alpha = 1.0 - Math.exp(-RUNTIME_POSE_SMOOTHING_RATE * dt);
    const transform = this.markerRoot.getTransform();
    const currentPosition = transform.getWorldPosition();
    const targetPosition = this._runtimeTargetPosition;
    const nextPosition = vec3.lerp(currentPosition, targetPosition, alpha);
    transform.setWorldPosition(nextPosition);

    const currentRotation = this.getRotation() ?? quat.quatIdentity();
    const nextRotation = quat.slerp(
      currentRotation,
      this._runtimeTargetRotation,
      alpha,
    );
    this.setRotation(nextRotation);
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

  private _applyDebugInfo(state: DimosAppState): void {
    if (!this._debugInfoText && this.markerRoot) {
      this._debugInfoText = findText(this.markerRoot, "DebugInfoText");
    }
    this._debugMode = state.debugMode;
    this._syncDirectionArrowVisibility();
    this._refreshDebugInfoText(state);
  }

  private _refreshDebugInfoText(state: DimosAppState): void {
    if (!this._debugInfoText) {
      return;
    }
    const presentation = this._resolveDebugInfoPresentation(state);
    this._debugInfoText.text = presentation.text;
    this._debugInfoText.textFill.color = presentation.color;
  }

  private _resolveDebugInfoPresentation(state: DimosAppState): {
    text: string;
    color: vec4;
  } {
    const outcomePresentation = navigationOutcomePresentation(
      state.navigationOutcome,
    );
    if (outcomePresentation) {
      return outcomePresentation;
    }
    return robotMarkerSteadyStatePresentation(state);
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
