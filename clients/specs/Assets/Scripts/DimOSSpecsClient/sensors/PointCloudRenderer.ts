import { type ClientTrackingOrigin, odomToClientTrackingPoint } from "DimOSARClient.lspkg/Scripts/DimOSARClient/localization/ClientTracking";

import { LidarFrameSampler } from "DimOSARClient.lspkg/Scripts/DimOSARClient/sensors/LidarRendering";
import { type LidarDisplayMode } from "DimOSARClient.lspkg/Scripts/DimOSARClient/sensors/LidarDisplay";
import type { ReadonlyFacts, Quat, Vec3 } from "DimOSARClient.lspkg/Scripts/DimOSARClient/ClientContracts";
import { clientTrackingToSpecsPoint } from "../utilities/SpecsCoordinates";

const DOT_MATERIAL = requireAsset("../../../Materials/LidarDot.mat") as Material;
const MAX_POINTS = 4000;

export function composeLidarPoint(point: Readonly<Vec3>, origin: ReadonlyFacts<ClientTrackingOrigin>): Vec3 {
  return clientTrackingToSpecsPoint(odomToClientTrackingPoint(point, origin));
}

@component
export class PointCloudRenderer extends BaseScriptComponent {
  @input("int", "1500")
  maxPoints: number = 1500;

  private visual: RenderMeshVisual | null = null;
  private builder: MeshBuilder | null = null;
  private readonly indices: number[] = [];
  private positions: readonly Vec3[] = [];
  private positionPoints: readonly Readonly<Vec3>[] | null = null;
  private positionOrigin: ReadonlyFacts<ClientTrackingOrigin> | null = null;
  private readonly sampler = new LidarFrameSampler<ReadonlyFacts<ClientTrackingOrigin>>(composeLidarPoint,
    { maximum: MAX_POINTS, minimum: 250, default: 1500 });
  private diagnosticScale = 1;
  private diagnosticRobot: Readonly<Vec3> | null = null;

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

  apply(input: { points: readonly Readonly<Vec3>[] | null; origin: ReadonlyFacts<ClientTrackingOrigin> | null;
    mode?: LidarDisplayMode; robot?: Readonly<Vec3> | null; baseHeightM?: number; orientation?: Readonly<Quat>;
    bounds?: Readonly<Vec3>; pointLimit?: number; obstacleRangeM?: number; odomScaleCorrectionFactor?: number; viewportHeight?: number }): void {
    const mode = input.mode ?? "full", points = input.points, origin = input.origin;
    if (!origin || !points?.length || mode === "off") { this.hide(); return; }
    if (!this.visual || !this.builder) throw new Error("PointCloudRenderer is not initialized");
    this.diagnosticScale = input.odomScaleCorrectionFactor ?? 1;
    this.diagnosticRobot = input.robot ?? null;
    const frame = this.sampler.sample({ ...input, points, origin, mode,
      pointLimit: input.pointLimit ?? this.maxPoints });
    // Like WebXR's scene-root point cloud, these vertices are already in world
    // coordinates. Keep authored/ancestor transforms out of the cloud entirely.
    const transform = this.getSceneObject().getTransform();
    transform.setWorldPosition(vec3.zero()); transform.setWorldRotation(quat.quatIdentity());
    transform.setWorldScale(vec3.one());
    (this.visual.mainMaterial.mainPass as Pass & { viewportHeightPx: number }).viewportHeightPx = input.viewportHeight ?? 1024;
    this.visual.enabled = true;
    if (!frame.positionsChanged && !frame.colorsChanged) return;
    this.positions = frame.positions;
    this.positionPoints = points;
    this.positionOrigin = origin;
    const count = frame.positions.length;
    const vertices: number[] = [];
    for (let i = 0; i < count; i++) {
      for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        vertices.push(...frame.positions[i], ...frame.colors[i], u, v);
      }
    }
    if (this.builder.getVerticesCount()) this.builder.eraseVertices(0, this.builder.getVerticesCount());
    if (this.builder.getIndicesCount()) this.builder.eraseIndices(0, this.builder.getIndicesCount());
    this.builder.appendVerticesInterleaved(vertices); this.builder.appendIndices(this.indices.slice(0, count * 6));
    if (!this.builder.isValid()) throw new Error("LiDAR billboard mesh is invalid");
    this.builder.updateMesh(); this.visual.mesh = this.builder.getMesh();
  }
  /** Bounded debug evidence: compare the raw sample, CPU transform and native projection. */
  spatialDiagnostics(camera: Camera): Record<string, unknown> {
    const transform = this.getSceneObject().getTransform();
    const matrix = transform.getWorldTransform();
    return { points: this.positionPoints?.length ?? 0, renderedPoints: this.positions.length,
      odomScaleCorrectionFactor: this.diagnosticScale, origin: this.positionOrigin,
      samples: this.positions.slice(0, 3).map((world, index) => {
        const renderedWorld = matrix.multiplyPoint(new vec3(...world));
        const screen = camera.worldSpaceToScreenSpace(renderedWorld);
        const rawIndex = Math.floor(index * (this.positionPoints?.length ?? 0) / Math.max(1, this.positions.length));
        const raw = this.positionPoints?.[rawIndex];
        const correctedDistanceM = raw && this.diagnosticRobot ? Math.hypot(raw[0] - this.diagnosticRobot[0], raw[1] - this.diagnosticRobot[1]) : null;
        return { odom: raw, worldCm: world, correctedPlanarDistanceM: correctedDistanceM,
          nativePlanarDistanceM: correctedDistanceM === null ? null : correctedDistanceM / this.diagnosticScale,
          renderedWorldCm: [renderedWorld.x, renderedWorld.y, renderedWorld.z], screen: [screen.x, screen.y] };
      }) };
  }
  hide(): void { if (this.visual) this.visual.enabled = false; }
  clear(): void { this.hide(); this.sampler.clear(); this.positionPoints = null; this.positionOrigin = null; }
}
