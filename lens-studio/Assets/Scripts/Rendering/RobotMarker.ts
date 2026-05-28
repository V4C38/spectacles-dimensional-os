import { PoseMessage, protocolMetersToLensCentimeters } from "../Network/Protocol";

@component
export class RobotMarker extends BaseScriptComponent {
  @input
  markerRoot: SceneObject;

  private _configured = false;
  private _crossbar: SceneObject | null = null;
  private _centerBlock: SceneObject | null = null;

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

  private _configureVisuals(): void {
    if (!this.markerRoot || this._configured) {
      return;
    }
    this._configured = true;

    const label = this._findChild("RobotID");
    if (label) {
      label.enabled = false;
    }

    const body = this._findChild("Marker");
    if (!body) {
      return;
    }

    const bodyTransform = body.getTransform();
    bodyTransform.setLocalPosition(vec3.zero());
    bodyTransform.setLocalScale(new vec3(6.8, 1.5, 1.5));

    const bodyVisual = body.getComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    if (!bodyVisual) {
      return;
    }

    this._crossbar = this._ensurePart("RobotMarkerCrossbar", bodyVisual);
    this._centerBlock = this._ensurePart("RobotMarkerCenter", bodyVisual);

    if (this._crossbar) {
      const crossbarTransform = this._crossbar.getTransform();
      crossbarTransform.setLocalPosition(new vec3(2.8, 0, 0));
      crossbarTransform.setLocalScale(new vec3(1.4, 4.6, 1.5));
    }

    if (this._centerBlock) {
      const centerTransform = this._centerBlock.getTransform();
      centerTransform.setLocalPosition(new vec3(1.5, 0, 0));
      centerTransform.setLocalScale(new vec3(2.0, 2.0, 2.0));
    }
  }

  private _findChild(name: string): SceneObject | null {
    if (!this.markerRoot) {
      return null;
    }
    for (let i = 0; i < this.markerRoot.getChildrenCount(); i++) {
      const child = this.markerRoot.getChild(i);
      if (child.name === name) {
        return child;
      }
    }
    return null;
  }

  private _ensurePart(name: string, templateVisual: RenderMeshVisual): SceneObject | null {
    const existing = this._findChild(name);
    if (existing) {
      return existing;
    }

    if (!this.markerRoot) {
      return null;
    }

    const obj = global.scene.createSceneObject(name);
    obj.setParent(this.markerRoot);
    const visual = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    if (!visual) {
      return obj;
    }

    visual.mesh = templateVisual.mesh;
    visual.mainMaterial = templateVisual.mainMaterial;
    visual.meshShadowMode = MeshShadowMode.None;
    return obj;
  }
}
