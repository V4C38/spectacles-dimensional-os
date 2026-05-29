const SHAFT_SCALE = new vec3(10, 1.2, 1.2);
const HEAD_A_SCALE = new vec3(3.4, 1.2, 1.2);
const HEAD_B_SCALE = new vec3(3.4, 1.2, 1.2);
const GOAL_UP_OFFSET_CM = 1.2;

function cloneMaterialWithColor(
  source: Material,
  color: vec4,
): Material {
  const material = source.clone();
  const pass = material.mainPass as any;
  pass.baseColor = color;
  pass.Port_Emissive_N006 = new vec3(color.x, color.y, color.z);
  return material;
}

export class GoalMarkerRenderer {
  private readonly root: SceneObject;
  private readonly previewRoot: SceneObject;
  private readonly confirmedRoot: SceneObject;
  private readonly template: RenderMeshVisual | null;
  private readonly previewMaterial: Material | null;
  private readonly confirmedMaterial: Material | null;

  constructor(parent: SceneObject, template: RenderMeshVisual | null) {
    this.root = global.scene.createSceneObject("GoalMarkers");
    this.root.setParent(parent);
    this.template = template;
    const baseMaterial = template?.mainMaterial ?? null;
    this.previewMaterial = baseMaterial
      ? cloneMaterialWithColor(baseMaterial, new vec4(0.2, 0.85, 1.0, 0.95))
      : null;
    this.confirmedMaterial = baseMaterial
      ? cloneMaterialWithColor(baseMaterial, new vec4(1.0, 0.8, 0.15, 1.0))
      : null;
    this.previewRoot = this._createArrow("PreviewGoal", this.previewMaterial);
    this.confirmedRoot = this._createArrow("ConfirmedGoal", this.confirmedMaterial);
    this.clearPreview();
    this.clearConfirmed();
  }

  public setPreview(position: vec3, rotation: quat): void {
    this._applyArrowPose(this.previewRoot, position, rotation);
    this.previewRoot.enabled = true;
  }

  public clearPreview(): void {
    this.previewRoot.enabled = false;
  }

  public setConfirmed(position: vec3, rotation: quat): void {
    this._applyArrowPose(this.confirmedRoot, position, rotation);
    this.confirmedRoot.enabled = true;
  }

  public clearConfirmed(): void {
    this.confirmedRoot.enabled = false;
  }

  private _applyArrowPose(root: SceneObject, position: vec3, rotation: quat): void {
    const transform = root.getTransform();
    transform.setWorldPosition(new vec3(position.x, position.y + GOAL_UP_OFFSET_CM, position.z));
    transform.setWorldRotation(rotation);
  }

  private _createArrow(name: string, material: Material | null): SceneObject {
    const root = global.scene.createSceneObject(name);
    root.setParent(this.root);
    this._createPart(root, `${name}Shaft`, new vec3(0, 0, 0), SHAFT_SCALE, material);
    this._createPart(root, `${name}HeadA`, new vec3(4.8, 1.6, 0), HEAD_A_SCALE, material);
    this._createPart(root, `${name}HeadB`, new vec3(4.8, -1.6, 0), HEAD_B_SCALE, material);
    root.enabled = false;
    return root;
  }

  private _createPart(
    parent: SceneObject,
    name: string,
    localPosition: vec3,
    localScale: vec3,
    material: Material | null,
  ): void {
    const obj = global.scene.createSceneObject(name);
    obj.setParent(parent);
    obj.getTransform().setLocalPosition(localPosition);
    obj.getTransform().setLocalScale(localScale);
    const visual = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    if (!visual || !this.template) {
      return;
    }
    visual.mesh = this.template.mesh;
    const resolvedMaterial = material ?? this.template.mainMaterial ?? null;
    if (resolvedMaterial) {
      visual.mainMaterial = resolvedMaterial;
    }
    visual.meshShadowMode = MeshShadowMode.None;
  }
}
