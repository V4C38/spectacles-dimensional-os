import { LidarMessage, protocolMetersToLensCentimeters } from "../Network/Protocol";

const MAX_HIGHLIGHTS = 120;
const CORRIDOR_RADIUS_CM = 28.0;
const HIGHLIGHT_LIFT_CM = 1.0;
const HIGHLIGHT_SCALE_MIN = 1.2;
const HIGHLIGHT_SCALE_MAX = 2.2;

function cloneHighlightMaterial(source: Material): Material {
  const material = source.clone();
  const pass = material.mainPass as any;
  const color = new vec4(1.0, 0.2, 0.2, 0.95);
  pass.baseColor = color;
  pass.Port_Emissive_N006 = new vec3(color.x, color.y, color.z);
  return material;
}

export class ObstacleHighlightRenderer {
  private readonly root: SceneObject;
  private readonly template: RenderMeshVisual | null;
  private readonly material: Material | null;
  private readonly points: SceneObject[] = [];
  private latestLidar: LidarMessage | null = null;
  private activePath: vec3[] = [];

  constructor(parent: SceneObject, template: RenderMeshVisual | null) {
    this.root = global.scene.createSceneObject("ObstacleHighlights");
    this.root.setParent(parent);
    this.template = template;
    this.material = template?.mainMaterial ? cloneHighlightMaterial(template.mainMaterial) : null;
  }

  public updateLidar(msg: LidarMessage): void {
    this.latestLidar = msg;
    this._refresh();
  }

  public setPath(points: vec3[]): void {
    this.activePath = points;
    this._refresh();
  }

  public clear(): void {
    this.activePath = [];
    this.points.forEach((point) => {
      point.enabled = false;
    });
  }

  private _refresh(): void {
    if (!this.latestLidar || this.activePath.length < 2) {
      this.points.forEach((point) => {
        point.enabled = false;
      });
      return;
    }

    const highlights: vec3[] = [];
    for (let i = 0; i < this.latestLidar.points.length && highlights.length < MAX_HIGHLIGHTS; i++) {
      const lensPoint = protocolMetersToLensCentimeters(this.latestLidar.points[i]);
      if (this._distanceToPath(lensPoint) <= CORRIDOR_RADIUS_CM) {
        highlights.push(lensPoint);
      }
    }

    this._ensurePool(highlights.length);
    for (let i = 0; i < highlights.length; i++) {
      const obj = this.points[i];
      const point = highlights[i];
      obj.enabled = true;
      obj.getTransform().setWorldPosition(new vec3(point.x, point.y + HIGHLIGHT_LIFT_CM, point.z));
      const distance = this._distanceToPath(point);
      const fade = Math.max(0, Math.min(1, 1 - distance / CORRIDOR_RADIUS_CM));
      const scale = HIGHLIGHT_SCALE_MIN + (HIGHLIGHT_SCALE_MAX - HIGHLIGHT_SCALE_MIN) * fade;
      obj.getTransform().setLocalScale(new vec3(scale, scale, scale));
    }
    for (let i = highlights.length; i < this.points.length; i++) {
      this.points[i].enabled = false;
    }
  }

  private _distanceToPath(point: vec3): number {
    let best = Number.POSITIVE_INFINITY;
    for (let i = 1; i < this.activePath.length; i++) {
      best = Math.min(best, this._distanceToSegment(point, this.activePath[i - 1], this.activePath[i]));
    }
    return best;
  }

  private _distanceToSegment(point: vec3, start: vec3, end: vec3): number {
    const ab = new vec3(end.x - start.x, end.y - start.y, end.z - start.z);
    const ap = new vec3(point.x - start.x, point.y - start.y, point.z - start.z);
    const abLenSq = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
    if (abLenSq <= 1e-4) {
      const dx = point.x - start.x;
      const dy = point.y - start.y;
      const dz = point.z - start.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    const t = Math.max(0, Math.min(1, (ap.x * ab.x + ap.y * ab.y + ap.z * ab.z) / abLenSq));
    const closest = new vec3(
      start.x + ab.x * t,
      start.y + ab.y * t,
      start.z + ab.z * t,
    );
    const dx = point.x - closest.x;
    const dy = point.y - closest.y;
    const dz = point.z - closest.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private _ensurePool(count: number): void {
    while (this.points.length < count) {
      const obj = global.scene.createSceneObject(`ObstaclePoint${this.points.length}`);
      obj.setParent(this.root);
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
