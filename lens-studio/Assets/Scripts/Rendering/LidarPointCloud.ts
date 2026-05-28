import { LAYOUT_DIRTY, DirtyComponent } from "../UI/Shared/DirtyComponent";
import { LidarMessage, protocolMetersToLensCentimeters } from "../Network/Protocol";

const MAX_POINTS = 2200;
const POINT_SIZE_CM = 2.4;
const APPLY_INTERVAL_S = 1.0;

const VOXEL_PALETTE: [number, number, number][] = [
  [0.10, 0.92, 0.95],
  [0.28, 0.95, 0.58],
  [0.96, 0.95, 0.12],
  [1.00, 0.68, 0.12],
  [1.00, 0.18, 0.72],
  [0.70, 0.16, 1.00],
];

@component
export class LidarPointCloud extends DirtyComponent {
  @input
  pointParent: SceneObject;

  @input
  pointTemplate: RenderMeshVisual;

  private _pending: LidarMessage | null = null;
  private _pointObjects: SceneObject[] = [];
  private _pointVisuals: RenderMeshVisual[] = [];
  private _pointPaletteIndices: number[] = [];
  private _paletteMaterials: Material[] = [];
  private _lastApplyTime = -APPLY_INTERVAL_S;
  private _warnedMissingTemplate = false;

  onAwake(): void {
    super.onAwake();
    this.setTracking(true);
  }

  public queueLidar(msg: LidarMessage): void {
    this._pending = msg;
  }

  protected onFlush(_flags: number): void {
    if (!this._pending || !this.pointParent) {
      return;
    }
    if (getTime() - this._lastApplyTime < APPLY_INTERVAL_S) {
      return;
    }

    const msg = this._pending;
    this._pending = null;
    const points = msg.points;
    const colors = msg.colors;
    const step = Math.max(1, Math.ceil(points.length / MAX_POINTS));
    const count = Math.min(MAX_POINTS, Math.ceil(points.length / step));
    this._ensurePool(count);
    if (this._pointObjects.length < count) {
      return;
    }

    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (let i = 0, sourceIndex = 0; i < count; i++, sourceIndex += step) {
      const p = points[sourceIndex];
      minZ = Math.min(minZ, p[2]);
      maxZ = Math.max(maxZ, p[2]);
    }

    const rangeZ = Math.max(maxZ - minZ, 0.001);
    for (let i = 0; i < count; i++) {
      const sourceIndex = Math.min(i * step, points.length - 1);
      const p = points[sourceIndex];
      const obj = this._pointObjects[i];
      obj.enabled = true;
      obj.getTransform().setWorldPosition(protocolMetersToLensCentimeters(p));
      this._applyPointColor(i, p, colors !== undefined ? colors[sourceIndex] : undefined, minZ, rangeZ);
    }
    for (let i = count; i < this._pointObjects.length; i++) {
      this._pointObjects[i].enabled = false;
    }
    this._lastApplyTime = getTime();
  }

  private _ensurePool(count: number): void {
    const template = this.pointTemplate as RenderMeshVisual | null;
    if (!template) {
      if (!this._warnedMissingTemplate) {
        print("LidarPointCloud: pointTemplate is not assigned");
        this._warnedMissingTemplate = true;
      }
      return;
    }
    this._ensurePaletteMaterials(template);

    while (this._pointObjects.length < count) {
      const obj = global.scene.createSceneObject(`LidarPt${this._pointObjects.length}`);
      obj.setParent(this.pointParent);
      const mesh = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
      if (mesh) {
        mesh.mesh = template.mesh;
        if (this._paletteMaterials.length > 0) {
          mesh.mainMaterial = this._paletteMaterials[0];
        }
        mesh.meshShadowMode = MeshShadowMode.None;
      }
      obj.getTransform().setLocalScale(new vec3(POINT_SIZE_CM, POINT_SIZE_CM, POINT_SIZE_CM));
      this._pointObjects.push(obj);
      this._pointVisuals.push(mesh);
      this._pointPaletteIndices.push(0);
    }
  }

  protected onTrack(): void {
    if (this._pending && getTime() - this._lastApplyTime >= APPLY_INTERVAL_S) {
      this.markDirty(LAYOUT_DIRTY);
    }
  }

  private _ensurePaletteMaterials(template: RenderMeshVisual): void {
    if (this._paletteMaterials.length > 0 || !template.mainMaterial) {
      return;
    }

    for (let i = 0; i < VOXEL_PALETTE.length; i++) {
      const material = template.mainMaterial.clone();
      this._setMaterialColor(material, VOXEL_PALETTE[i]);
      this._paletteMaterials.push(material);
    }
  }

  private _setMaterialColor(material: Material, color: [number, number, number]): void {
    const pass = material.mainPass as any;
    pass.baseColor = new vec4(color[0], color[1], color[2], 1.0);
    pass.Port_Emissive_N006 = new vec3(color[0], color[1], color[2]);
  }

  private _applyPointColor(
    index: number,
    point: [number, number, number],
    color: [number, number, number] | undefined,
    minZ: number,
    rangeZ: number,
  ): void {
    const visual = this._pointVisuals[index];
    if (!visual || this._paletteMaterials.length === 0) {
      return;
    }

    const paletteIndex = this._paletteIndexForPoint(point, color, minZ, rangeZ);
    if (this._pointPaletteIndices[index] !== paletteIndex) {
      visual.mainMaterial = this._paletteMaterials[paletteIndex];
      this._pointPaletteIndices[index] = paletteIndex;
    }
  }

  private _paletteIndexForPoint(
    point: [number, number, number],
    color: [number, number, number] | undefined,
    minZ: number,
    rangeZ: number,
  ): number {
    const heightT = Math.max(0, Math.min(1, (point[2] - minZ) / rangeZ));
    if (color && color[1] > color[0]) {
      return heightT < 0.5 ? 0 : 1;
    }
    if (heightT < 0.18) {
      return 0;
    }
    if (heightT < 0.35) {
      return 1;
    }
    if (heightT < 0.52) {
      return 2;
    }
    if (heightT < 0.70) {
      return 3;
    }
    if (heightT < 0.86) {
      return 4;
    }
    return 5;
  }

  public clear(): void {
    this._pending = null;
    this._pointObjects.forEach((o) => (o.enabled = false));
  }
}
