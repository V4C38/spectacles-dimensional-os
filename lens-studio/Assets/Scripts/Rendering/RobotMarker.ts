import { PoseMessage, protocolMetersToLensCentimeters } from "../Network/Protocol";
import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { InteractableManipulation } from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation";
import { RoundButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton";
import { requireChild } from "../UI/Shared/SceneLookup";

const ROBOT_UI_WORLD_UP_OFFSET_CM = 15.0;
const POSITION_SMOOTHING_RATE = 20.0;
const ROTATION_SMOOTHING_RATE = 22.0;
const DIRECTION_ARROW_YAW_CORRECTION = new quat(
  Math.cos(Math.PI / 4),
  0,
  -Math.sin(Math.PI / 4),
  0,
);

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec3(a: vec3, b: vec3, t: number): vec3 {
  return new vec3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));
}

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
  private _runtimePoseTargetPosition: vec3 | null = null;
  private _runtimePoseTargetRotation: quat | null = null;
  private _hasLiveRuntimePose = false;
  private _lastUpdateTime = -1.0;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this._configureVisuals();
      this.setVisible(false);
    });
    this.createEvent("UpdateEvent").bind(() => {
      this._updateRuntimePoseSmoothing();
      this._syncMenuWorldAnchor();
    });
  }

  public applyPose(msg: PoseMessage): void {
    if (!this.markerRoot) {
      return;
    }
    this.markerRoot.enabled = true;
    const q = msg.orientation;
    const position = protocolMetersToLensCentimeters(msg.position);
    const rotation = new quat(q[3], q[0], q[1], q[2]);
    this._runtimePoseTargetPosition = position;
    this._runtimePoseTargetRotation = rotation;
    if (!this._hasLiveRuntimePose) {
      this._hasLiveRuntimePose = true;
      this._applyTransformImmediate(position, rotation);
    }
  }

  public applyManualPose(position: vec3, rotation: quat): void {
    if (!this.markerRoot) {
      return;
    }
    this.resetRuntimePoseSmoothing();
    this.markerRoot.enabled = true;
    this._applyTransformImmediate(position, rotation);
  }

  public applyRuntimeLensPose(position: vec3, rotation: quat): void {
    if (!this.markerRoot) {
      return;
    }
    this.markerRoot.enabled = true;
    this._runtimePoseTargetPosition = position;
    this._runtimePoseTargetRotation = rotation;
    if (!this._hasLiveRuntimePose) {
      this._hasLiveRuntimePose = true;
      this._applyTransformImmediate(position, rotation);
    }
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
    this._runtimePoseTargetPosition = null;
    this._runtimePoseTargetRotation = null;
    this._hasLiveRuntimePose = false;
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
  }

  public getWorldPosition(): vec3 | null {
    if (!this.markerRoot) {
      return null;
    }
    return this.markerRoot.getTransform().getWorldPosition();
  }

  public getWorldRotation(): quat | null {
    if (!this.markerRoot) {
      return null;
    }
    return this.markerRoot.getTransform().getWorldRotation();
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
    this._placementHandle = placementHandle;
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
    this._directionArrow
      ?.getTransform()
      .setLocalRotation(DIRECTION_ARROW_YAW_CORRECTION);
    this.setToggleEnabled(false);
    this.setMenuEnabled(false);
    this.setManualPlacementEnabled(false);
    this._syncMenuWorldAnchor();
  }

  private _applyTransformImmediate(position: vec3, rotation: quat): void {
    if (!this.markerRoot) {
      return;
    }
    const t = this.markerRoot.getTransform();
    t.setWorldPosition(position);
    t.setWorldRotation(rotation);
    this._syncMenuWorldAnchor();
  }

  private _updateRuntimePoseSmoothing(): void {
    const now = getTime();
    const deltaTime =
      this._lastUpdateTime >= 0.0 ? Math.max(0.0, now - this._lastUpdateTime) : 0.0;
    this._lastUpdateTime = now;
    if (
      !this.markerRoot ||
      !this.markerRoot.enabled ||
      !this._hasLiveRuntimePose ||
      !this._runtimePoseTargetPosition ||
      !this._runtimePoseTargetRotation ||
      deltaTime <= 0.0
    ) {
      return;
    }

    const transform = this.markerRoot.getTransform();
    const positionAlpha = 1.0 - Math.exp(-POSITION_SMOOTHING_RATE * deltaTime);
    const rotationAlpha = 1.0 - Math.exp(-ROTATION_SMOOTHING_RATE * deltaTime);

    transform.setWorldPosition(
      lerpVec3(
        transform.getWorldPosition(),
        this._runtimePoseTargetPosition,
        positionAlpha,
      ),
    );
    transform.setWorldRotation(
      quat.slerp(
        transform.getWorldRotation(),
        this._runtimePoseTargetRotation,
        rotationAlpha,
      ),
    );
  }

  private _syncMenuWorldAnchor(): void {
    if (!this.markerRoot || !this._menuRoot) {
      return;
    }

    const rootPosition = this.markerRoot.getTransform().getWorldPosition();
    this._menuRoot
      .getTransform()
      .setWorldPosition(
        new vec3(
          rootPosition.x,
          rootPosition.y + ROBOT_UI_WORLD_UP_OFFSET_CM,
          rootPosition.z,
        ),
      );
  }
}
