import type { ClientTrackingOrigin } from "../../DimOSARClient/localization/clientTrackingOrigin";
import { odomToClientTrackingPoint } from "../../DimOSARClient/localization/clientTrackingTransforms";
import { lidarBodyClearance, lidarHeightColor } from "../../DimOSARClient/sensors/lidarColors";
import { LIDAR_PRESETS, type LidarDisplayMode } from "../../DimOSARClient/sensors/lidarSettings";
import type { Quat, Vec3 } from "../../DimOSARClient/websocket/protocolTypes";
import { clientTrackingToSpecsPoint } from "../utilities/SpecsCoordinates";

const DOT_MATERIAL = requireAsset("../../../Materials/LidarDot.mat") as Material;
const MAX_POINTS = 4000;
const HEIGHT_COLORS = Array.from({ length: 256 }, (_, i) => lidarHeightColor(i / 255));

export function composeLidarPoint(point: Vec3, origin: ClientTrackingOrigin): Vec3 {
  return clientTrackingToSpecsPoint(odomToClientTrackingPoint(point, origin));
}

@component
export class PointCloudRenderer extends BaseScriptComponent {
  @input("int", "1500")
  maxPoints: number = 1500;

  private visual: RenderMeshVisual | null = null;
  private builder: MeshBuilder | null = null;
  private lastPoints: Vec3[] | null = null;
  private lastOrigin: ClientTrackingOrigin | null = null;
  private lastStyle: readonly number[] = [];
  private lastMode: LidarDisplayMode | null = null;
  private readonly indices: number[] = [];
  private positions: Vec3[] = [];
  private positionPoints: Vec3[] | null = null;
  private positionOrigin: ClientTrackingOrigin | null = null;
  private positionLimit = 0;

  onAwake(): void {
    this.visual = this.getSceneObject().getComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    if (!this.visual) throw new Error("PointCloudRenderer requires RenderMeshVisual");
    this.visual.mainMaterial = DOT_MATERIAL.clone();
    this.visual.meshShadowMode = MeshShadowMode.None;
    this.visual.setRenderOrder(-100);
    const pass = this.visual.mainMaterial.mainPass as Pass & { blendMode: BlendMode; depthWrite: boolean; twoSided: boolean };
    pass.blendMode = BlendMode.Normal; pass.depthWrite = false; pass.twoSided = true;
    this.builder = new MeshBuilder([{ name: "position", components: 3 }, { name: "color", components: 4 }, { name: "texture0", components: 2 }]);
    this.builder.topology = MeshTopology.Triangles; this.builder.indexType = MeshIndexType.UInt16;
    for (let i = 0; i < MAX_POINTS; i++) {
      const v = i * 4; this.indices.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
    }
    this.hide();
  }

  apply(input: { points: Vec3[] | null; origin: ClientTrackingOrigin | null;
    mode?: LidarDisplayMode; robot?: Vec3 | null; baseHeightM?: number; orientation?: Quat;
    bounds?: Vec3; pointLimit?: number; obstacleRangeM?: number; odomScaleCorrectionFactor?: number; viewportHeight?: number }): void {
    const mode = input.mode ?? "full", points = input.points, origin = input.origin;
    if (!origin || !points?.length || mode === "off") { this.hide(); return; }
    if (!this.visual || !this.builder) throw new Error("PointCloudRenderer is not initialized");
    const limit = Math.max(250, Math.min(MAX_POINTS, Math.floor(input.pointLimit ?? this.maxPoints)));
    const floor = input.robot ? input.robot[2] - (input.baseHeightM ?? 0) : 0;
    const factor = input.odomScaleCorrectionFactor ?? 1;
    const style = mode === "full" ? [limit, floor] : [limit, floor, input.obstacleRangeM ?? 0.6, factor,
      ...(input.robot ?? []), ...(input.orientation ?? []), ...(input.bounds ?? [])];
    // Like WebXR's scene-root point cloud, these vertices are already in world
    // coordinates. Keep authored/ancestor transforms out of the cloud entirely.
    const transform = this.getSceneObject().getTransform();
    transform.setWorldPosition(vec3.zero()); transform.setWorldRotation(quat.quatIdentity());
    transform.setWorldScale(vec3.one());
    (this.visual.mainMaterial.mainPass as Pass & { viewportHeightPx: number }).viewportHeightPx = input.viewportHeight ?? 1024;
    this.visual.enabled = true;
    if (points === this.lastPoints && origin === this.lastOrigin && mode === this.lastMode && style.length === this.lastStyle.length && style.every((value, i) => value === this.lastStyle[i])) return;
    const count = Math.min(points.length, limit), vertices: number[] = [];
    if (points !== this.positionPoints || origin !== this.positionOrigin || limit !== this.positionLimit) {
      this.positions = Array.from({ length: count }, (_, i) => composeLidarPoint(points[Math.floor(i * points.length / count)], origin));
      this.positionPoints = points; this.positionOrigin = origin; this.positionLimit = limit;
    }
    for (let i = 0; i < count; i++) {
      const source = points[Math.floor(i * points.length / count)];
      const world = this.positions[i];
      let color: number[];
      if (mode === "obstacles") {
        const t = input.robot ? Math.min(1, lidarBodyClearance(source, input.robot,
          input.orientation ?? [0, 0, 0, 1], input.bounds ?? [0.7, 0.5, 0.55], factor) / Math.max(0.001, input.obstacleRangeM ?? 0.6)) : 1;
        color = [1, 0, 0, 1 - t * t * (3 - 2 * t)];
      } else {
        const settings = LIDAR_PRESETS.full;
        const t = Math.max(0, Math.min(1, (source[2] - floor - settings.min_height_m) / (settings.max_height_m - settings.min_height_m)));
        color = [...HEIGHT_COLORS[Math.round(t * 255)], 1];
      }
      for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) vertices.push(...world, ...color, u, v);
    }
    if (this.builder.getVerticesCount()) this.builder.eraseVertices(0, this.builder.getVerticesCount());
    if (this.builder.getIndicesCount()) this.builder.eraseIndices(0, this.builder.getIndicesCount());
    this.builder.appendVerticesInterleaved(vertices); this.builder.appendIndices(this.indices.slice(0, count * 6));
    if (!this.builder.isValid()) throw new Error("LiDAR billboard mesh is invalid");
    this.builder.updateMesh(); this.visual.mesh = this.builder.getMesh();
    this.lastPoints = points; this.lastOrigin = origin; this.lastStyle = style; this.lastMode = mode;
  }
  hide(): void { if (this.visual) this.visual.enabled = false; }
  clear(): void { this.hide(); this.lastPoints = null; this.lastOrigin = null; }
}
