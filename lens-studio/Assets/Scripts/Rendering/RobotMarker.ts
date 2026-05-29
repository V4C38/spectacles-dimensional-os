import { PoseMessage, protocolMetersToLensCentimeters } from "../Network/Protocol";
import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { InteractableManipulation } from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation";

@component
export class RobotMarker extends BaseScriptComponent {
  @input
  markerRoot: SceneObject;

  private _configured = false;
  private _manualHandle: SceneObject | null = null;
  private _manualCollider: ColliderComponent | null = null;
  private _manualInteractable: Interactable | null = null;
  private _manualManipulation: InteractableManipulation | null = null;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this._configureVisuals();
      this.setVisible(false);
    });
  }

  public applyPose(msg: PoseMessage): void {
    if (!this.markerRoot) {
      return;
    }
    this.markerRoot.enabled = true;
    const t = this.markerRoot.getTransform();
    t.setWorldPosition(protocolMetersToLensCentimeters(msg.position));
    const q = msg.orientation;
    t.setWorldRotation(new quat(q[0], q[1], q[2], q[3]));
  }

  public applyManualPose(position: vec3, rotation: quat): void {
    if (!this.markerRoot) {
      return;
    }
    this.markerRoot.enabled = true;
    const t = this.markerRoot.getTransform();
    t.setWorldPosition(position);
    t.setWorldRotation(rotation);
  }

  public setVisible(visible: boolean): void {
    if (this.markerRoot) {
      this.markerRoot.enabled = visible;
    }
  }

  public setManualPlacementEnabled(enabled: boolean): void {
    if (!this._configured) {
      this._configureVisuals();
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

  private _configureVisuals(): void {
    if (!this.markerRoot || this._configured) {
      return;
    }
    this._configured = true;
    this._manualHandle = this._requireChild(this.markerRoot, "RobotPlacementHandle");
    this._ensureManualInteraction();
    this.setManualPlacementEnabled(false);
  }

  private _findChild(name: string, root: SceneObject | null = this.markerRoot): SceneObject | null {
    if (!root) {
      return null;
    }
    for (let i = 0; i < root.getChildrenCount(); i++) {
      const child = root.getChild(i);
      if (child.name === name) {
        return child;
      }
      const nested = this._findChild(name, child);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  private _ensureManualInteraction(): void {
    if (!this._manualHandle || !this.markerRoot) {
      return;
    }
    if (!this._manualCollider) {
      this._manualCollider = this._manualHandle.getComponent(
        "Component.ColliderComponent",
      ) as ColliderComponent;
      if (!this._manualCollider) {
        this._manualCollider = this._manualHandle.createComponent(
          "Component.ColliderComponent",
        ) as ColliderComponent;
      }
      if (this._manualCollider) {
        const hasVisual = Boolean(
          this._manualHandle.getComponent("Component.RenderMeshVisual") as RenderMeshVisual,
        );
        this._manualCollider.fitVisual = hasVisual;
        this._manualCollider.intangible = false;
        this._manualCollider.debugDrawEnabled = false;
        if (!hasVisual) {
          const shape = (this._manualCollider as any).shape ?? null;
          if (shape && "radius" in shape) {
            shape.radius = 10;
          }
        }
      }
    }

    if (!this._manualInteractable) {
      this._manualInteractable = this._manualHandle.getComponent(
        Interactable.getTypeName(),
      ) as Interactable;
      if (!this._manualInteractable) {
        this._manualInteractable = this._manualHandle.createComponent(
          Interactable.getTypeName(),
        ) as Interactable;
      }
      if (this._manualInteractable && this._manualCollider) {
        this._manualInteractable.colliders = [this._manualCollider];
        (this._manualInteractable as any).enableInstantDrag = false;
        (this._manualInteractable as any).useFilteredPinch = false;
      }
    }

    if (!this._manualManipulation) {
      this._manualManipulation = this._manualHandle.getComponent(
        InteractableManipulation.getTypeName(),
      ) as InteractableManipulation;
      if (!this._manualManipulation) {
        this._manualManipulation = this._manualHandle.createComponent(
          InteractableManipulation.getTypeName(),
        ) as InteractableManipulation;
      }
      if (this._manualManipulation) {
        this._manualManipulation.setManipulateRoot(this.markerRoot.getTransform());
        (this._manualManipulation as any).enableStretchZ = false;
        if (typeof (this._manualManipulation as any).setCanTranslate === "function") {
          (this._manualManipulation as any).setCanTranslate(true);
        }
        if (typeof (this._manualManipulation as any).setCanRotate === "function") {
          (this._manualManipulation as any).setCanRotate(false);
        }
        if (typeof (this._manualManipulation as any).setCanScale === "function") {
          (this._manualManipulation as any).setCanScale(false);
        }
      }
    }
  }

  private _requireChild(root: SceneObject, name: string): SceneObject {
    const child = this._findChild(name, root);
    if (!child) {
      throw new Error(`RobotMarker: Missing scene object ${name}`);
    }
    return child;
  }
}
