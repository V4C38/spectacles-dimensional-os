import { LAYOUT_DIRTY, DirtyComponent } from "../UI/Shared/DirtyComponent";
import { LidarMessage, protocolMetersToLensCentimeters } from "../Network/Protocol";

const MAX_POINTS = 2200;
const POINT_SIZE_CM = 2.4;
const APPLY_INTERVAL_S = 1.0;
const DISTANCE_COLOR_STEPS = 12;
const DISTANCE_NEAR_COLOR: [number, number, number] = [1.0, 0.0, 0.0];
const DISTANCE_FAR_COLOR: [number, number, number] = [1.0, 1.0, 1.0];
const DEFAULT_LIDAR_MATERIAL = requireAsset(
  "../../Materials/LidarVoxel.mat",
) as Material | null;

const DISTANCE_PALETTE: [number, number, number][] = createDistancePalette();

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
  private _robotWorldPosition: vec3 | null = null;

  onAwake(): void {
    super.onAwake();
    this.setTracking(true);
  }

  public queueLidar(msg: LidarMessage): void {
    this._pending = msg;
  }

  public setRobotWorldPosition(position: vec3): void {
    this._robotWorldPosition = position;
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
    const step = Math.max(1, Math.ceil(points.length / MAX_POINTS));
    const count = Math.min(MAX_POINTS, Math.ceil(points.length / step));
    this._ensurePool(count);
    if (this._pointObjects.length < count) {
      return;
    }

    let minDistance = Number.POSITIVE_INFINITY;
    let maxDistance = Number.NEGATIVE_INFINITY;
    const robotWorldPosition = this._robotWorldPosition;
    for (let i = 0, sourceIndex = 0; i < count; i++, sourceIndex += step) {
      const p = points[sourceIndex];
      const distance = this._distanceFromRobotCm(p, robotWorldPosition);
      minDistance = Math.min(minDistance, distance);
      maxDistance = Math.max(maxDistance, distance);
    }

    const rangeDistance = Math.max(maxDistance - minDistance, 0.001);
    for (let i = 0; i < count; i++) {
      const sourceIndex = Math.min(i * step, points.length - 1);
      const p = points[sourceIndex];
      const obj = this._pointObjects[i];
      obj.enabled = true;
      obj.getTransform().setWorldPosition(protocolMetersToLensCentimeters(p));
      this._applyPointColor(
        i,
        p,
        minDistance,
        rangeDistance,
        robotWorldPosition,
      );
    }
    for (let i = count; i < this._pointObjects.length; i++) {
      this._pointObjects[i].enabled = false;
    }
    this._lastApplyTime = getTime();
  }

  private _ensurePool(count: number): void {
    const template = this.pointTemplate as RenderMeshVisual | null;
    const materialTemplate =
      DEFAULT_LIDAR_MATERIAL ?? template?.mainMaterial ?? null;
    if (!template || !materialTemplate) {
      if (!this._warnedMissingTemplate) {
        print(
          "LidarPointCloud: pointTemplate mesh or LiDAR material is not assigned",
        );
        this._warnedMissingTemplate = true;
      }
      return;
    }
    this._ensurePaletteMaterials(materialTemplate);

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

  private _ensurePaletteMaterials(materialTemplate: Material): void {
    if (this._paletteMaterials.length > 0) {
      return;
    }

    for (let i = 0; i < DISTANCE_PALETTE.length; i++) {
      const material = materialTemplate.clone();
      this._setMaterialColor(material, DISTANCE_PALETTE[i]);
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
    minDistance: number,
    rangeDistance: number,
    robotWorldPosition: vec3 | null,
  ): void {
    const visual = this._pointVisuals[index];
    if (!visual || this._paletteMaterials.length === 0) {
      return;
    }

    const paletteIndex = this._paletteIndexForPoint(
      point,
      minDistance,
      rangeDistance,
      robotWorldPosition,
    );
    if (this._pointPaletteIndices[index] !== paletteIndex) {
      visual.mainMaterial = this._paletteMaterials[paletteIndex];
      this._pointPaletteIndices[index] = paletteIndex;
    }
  }

  private _paletteIndexForPoint(
    point: [number, number, number],
    minDistance: number,
    rangeDistance: number,
    robotWorldPosition: vec3 | null,
  ): number {
    const distance = this._distanceFromRobotCm(point, robotWorldPosition);
    const t = Math.max(0, Math.min(1, (distance - minDistance) / rangeDistance));
    return Math.min(
      DISTANCE_PALETTE.length - 1,
      Math.floor(t * (DISTANCE_PALETTE.length - 1)),
    );
  }

  private _distanceFromRobotCm(
    point: [number, number, number],
    robotWorldPosition: vec3 | null,
  ): number {
    const worldPoint = protocolMetersToLensCentimeters(point);
    const origin = robotWorldPosition ?? vec3.zero();
    const dx = worldPoint.x - origin.x;
    const dy = worldPoint.y - origin.y;
    const dz = worldPoint.z - origin.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  public clear(): void {
    this._pending = null;
    this._pointObjects.forEach((o) => (o.enabled = false));
  }
}

function createDistancePalette(): [number, number, number][] {
  const palette: [number, number, number][] = [];
  for (let i = 0; i < DISTANCE_COLOR_STEPS; i++) {
    const t =
      DISTANCE_COLOR_STEPS <= 1 ? 1.0 : i / (DISTANCE_COLOR_STEPS - 1);
    palette.push([
      lerp(DISTANCE_NEAR_COLOR[0], DISTANCE_FAR_COLOR[0], t),
      lerp(DISTANCE_NEAR_COLOR[1], DISTANCE_FAR_COLOR[1], t),
      lerp(DISTANCE_NEAR_COLOR[2], DISTANCE_FAR_COLOR[2], t),
    ]);
  }
  return palette;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
