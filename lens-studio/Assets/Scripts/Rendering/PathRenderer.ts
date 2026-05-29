import { protocolMetersToLensCentimeters } from "../Network/Protocol";

const PATH_SAMPLE_CM = 12.0;
const PATH_POINT_SCALE = 1.6;
const PATH_POINT_LIFT_CM = 0.8;
const MAX_PATH_POINTS = 160;

function clonePathMaterial(source: Material): Material {
  const material = source.clone();
  const pass = material.mainPass as any;
  const color = new vec4(0.15, 1.0, 0.45, 1.0);
  pass.baseColor = color;
  pass.Port_Emissive_N006 = new vec3(color.x, color.y, color.z);
  return material;
}

export class PathRenderer {
  private readonly root: SceneObject;
  private readonly template: RenderMeshVisual | null;
  private readonly material: Material | null;
  private readonly points: SceneObject[] = [];

  constructor(parent: SceneObject, template: RenderMeshVisual | null) {
    this.root = global.scene.createSceneObject("PathRenderer");
    this.root.setParent(parent);
    this.template = template;
    this.material = template?.mainMaterial ? clonePathMaterial(template.mainMaterial) : null;
  }

  public setProtocolPath(waypoints: [number, number, number][]): void {
    const lensPoints = waypoints.map((point) => protocolMetersToLensCentimeters(point));
    this.setLensPath(lensPoints);
  }

  public setLensPath(points: vec3[]): void {
    const sampled = this._samplePath(points);
    this._ensurePool(sampled.length);
    for (let i = 0; i < sampled.length; i++) {
      const obj = this.points[i];
      obj.enabled = true;
      obj.getTransform().setWorldPosition(
        new vec3(sampled[i].x, sampled[i].y + PATH_POINT_LIFT_CM, sampled[i].z),
      );
    }
    for (let i = sampled.length; i < this.points.length; i++) {
      this.points[i].enabled = false;
    }
  }

  public clear(): void {
    this.points.forEach((point) => {
      point.enabled = false;
    });
  }

  private _samplePath(points: vec3[]): vec3[] {
    if (points.length <= 1) {
      return points;
    }
    const sampled: vec3[] = [points[0]];
    for (let i = 1; i < points.length && sampled.length < MAX_PATH_POINTS; i++) {
      const start = points[i - 1];
      const end = points[i];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const dz = end.z - start.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const steps = Math.max(1, Math.ceil(distance / PATH_SAMPLE_CM));
      for (let step = 1; step <= steps && sampled.length < MAX_PATH_POINTS; step++) {
        const t = step / steps;
        sampled.push(
          new vec3(
            start.x + dx * t,
            start.y + dy * t,
            start.z + dz * t,
          ),
        );
      }
    }
    return sampled;
  }

  private _ensurePool(count: number): void {
    while (this.points.length < count) {
      const obj = global.scene.createSceneObject(`PathPoint${this.points.length}`);
      obj.setParent(this.root);
      obj.getTransform().setLocalScale(new vec3(PATH_POINT_SCALE, PATH_POINT_SCALE, PATH_POINT_SCALE));
      const visual = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
      if (visual && this.template) {
        visual.mesh = this.template.mesh;
        visual.mainMaterial = this.material ?? this.template.mainMaterial;
        visual.meshShadowMode = MeshShadowMode.None;
      }
      obj.enabled = false;
      this.points.push(obj);
    }
  }
}
