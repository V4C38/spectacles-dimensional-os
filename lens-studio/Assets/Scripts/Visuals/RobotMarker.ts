import { PoseMessage, protocolMetersToLensCentimeters } from "../Network/Protocol";
import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { InteractableManipulation } from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation";
import { RoundButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton";
import { requireChild } from "../UI/Shared/UICore";

const ROBOT_UI_WORLD_UP_OFFSET_CM = 15.0;
const POSITION_DEADBAND_CM = 0.75;
const ROTATION_DEADBAND_RAD = (1.0 * Math.PI) / 180.0;
const DIRECTION_ARROW_YAW_CORRECTION = new quat(
  Math.cos(Math.PI / 4),
  0,
  -Math.sin(Math.PI / 4),
  0,
);

function vec3Distance(a: vec3, b: vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function quatAngularDistanceRad(a: quat, b: quat): number {
  const dot = Math.abs(a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z);
  return 2.0 * Math.acos(Math.min(1.0, Math.max(-1.0, dot)));
}

// ================================================================
// World-space robot marker with live pose, manual placement, and floating robot menu anchor.
// ================================================================
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
  private _hasLiveRuntimePose = false;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this._configureVisuals();
      this.setVisible(false);
    });
    this.createEvent("UpdateEvent").bind(() => {
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
    this._applyRuntimePose(position, rotation);
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

  private _applyRuntimePose(position: vec3, rotation: quat): void {
    if (!this.markerRoot) {
      return;
    }

    if (!this._hasLiveRuntimePose) {
      this._hasLiveRuntimePose = true;
      this._applyTransformImmediate(position, rotation);
      return;
    }

    const transform = this.markerRoot.getTransform();
    const currentPosition = transform.getWorldPosition();
    const currentRotation = transform.getWorldRotation();
    const positionDelta = vec3Distance(currentPosition, position);
    const rotationDelta = quatAngularDistanceRad(currentRotation, rotation);
    if (
      positionDelta < POSITION_DEADBAND_CM &&
      rotationDelta < ROTATION_DEADBAND_RAD
    ) {
      return;
    }

    this._applyTransformImmediate(position, rotation);
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
