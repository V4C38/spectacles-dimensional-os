import { LidarMessage, protocolMetersToLensCentimeters } from "../Network/Protocol";
import { buildMockLidarPoints } from "./MockLidarPoints";

const MAX_POINTS = 1000;
const POINT_SIZE_CM = 2.4;
const Y_MIN_CM = -35;
const HEIGHT_RANGE_CM = 100;
const OBSTACLE_MIN_DIST_CM = 15;
const OBSTACLE_OPAQUE_CM = 50;
const OBSTACLE_FADE_END_CM = 150;
const HEIGHT_POINT_ALPHA = 0.4;
const FLOATS_PER_VERTEX = 7;
const VERTS_PER_POINT = 8;
const INDICES_PER_POINT = 36;

/** Outward-facing triangles for a unit cube (indices 0–7). */
const CUBE_INDICES = [
  0, 2, 1, 0, 3, 2,
  4, 5, 6, 4, 6, 7,
  0, 1, 5, 0, 5, 4,
  2, 3, 7, 2, 7, 6,
  1, 2, 6, 1, 6, 5,
  0, 4, 7, 0, 7, 3,
];

const _vertBuffer: number[] = new Array(
  MAX_POINTS * VERTS_PER_POINT * FLOATS_PER_VERTEX,
);
const _indexBuffer: number[] = new Array(MAX_POINTS * INDICES_PER_POINT);

// ================================================================
// Rebuilds height and obstacle LiDAR meshes from live or mock point clouds.
// ================================================================
/** Rebuilds height and obstacle LiDAR meshes from live or mock point clouds. */
@component
export class PointCloudRenderer extends BaseScriptComponent {
  @input
  pointParent: SceneObject;

  @input
  heightVisual: RenderMeshVisual;

  @input
  obstacleVisual: RenderMeshVisual;

  private _heightBuilder: MeshBuilder | null = null;
  private _obstacleBuilder: MeshBuilder | null = null;
  private _robotWorldPosition: vec3 | null = null;
  private _heightVisible = false;

  onAwake(): void {
    this._heightBuilder = this._createBuilder();
    this._obstacleBuilder = this._createBuilder();
    this._configureVisual(this.heightVisual, true);
    this._configureVisual(this.obstacleVisual, true);
    this.setHeightLayerVisible(false);
    this._clearMesh(this._heightBuilder, this.heightVisual);
    this._clearMesh(this._obstacleBuilder, this.obstacleVisual);
  }

  public updateLidar(msg: LidarMessage): void {
    // Obstacle layer always rebuilds from live lidar; not gated by showLiDAR.
    this._rebuildObstacleMesh(msg.points);
    if (this._heightVisible) {
      this._rebuildHeightMesh(msg.points);
    }
  }

  /** Offline preview — height layer only (no mock obstacles). */
  public showMockHeightCloud(anchorCm: vec3 = vec3.zero()): void {
    const offsetM = anchorCm.uniformScale(0.01);
    const anchored = buildMockLidarPoints().map(
      (p) =>
        [p[0] + offsetM.x, p[1] + offsetM.y, p[2] + offsetM.z] as [
          number,
          number,
          number,
        ],
    );
    this._rebuildHeightMesh(anchored);
    if (this.heightVisual) {
      this.heightVisual.getSceneObject().enabled = true;
    }
  }

  public setRobotWorldPosition(position: vec3): void {
    this._robotWorldPosition = position;
  }

  public setHeightLayerVisible(enabled: boolean): void {
    this._heightVisible = enabled;
    if (this.heightVisual) {
      this.heightVisual.getSceneObject().enabled = enabled;
    }
  }

  public clearHeightLayer(): void {
    this._clearMesh(this._heightBuilder, this.heightVisual);
    if (this.heightVisual) {
      this.heightVisual.getSceneObject().enabled = false;
    }
  }

  public clearAll(): void {
    this._robotWorldPosition = null;
    this.clearHeightLayer();
    this._clearMesh(this._obstacleBuilder, this.obstacleVisual);
    if (this.obstacleVisual) {
      this.obstacleVisual.getSceneObject().enabled = false;
    }
  }

  /** Protocol points are world metres; mesh vertices must be in the visual's local cm space. */
  private _protocolPointToVisualLocalCm(
    point: [number, number, number],
    visual: RenderMeshVisual,
  ): vec3 {
    const worldCm = protocolMetersToLensCentimeters(point);
    return visual
      .getSceneObject()
      .getTransform()
      .getInvertedWorldTransform()
      .multiplyPoint(worldCm);
  }

  private _robotLocalCm(robot: vec3 | null, visual: RenderMeshVisual): vec3 | null {
    if (!robot) {
      return null;
    }
    return visual
      .getSceneObject()
      .getTransform()
      .getInvertedWorldTransform()
      .multiplyPoint(robot);
  }

  private _createBuilder(): MeshBuilder {
    const builder = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "color", components: 4, normalized: true },
    ]);
    builder.topology = MeshTopology.Triangles;
    builder.indexType = MeshIndexType.UInt16;
    return builder;
  }

  private _configureVisual(
    visual: RenderMeshVisual | null,
    useAlphaBlend: boolean,
  ): void {
    if (!visual) {
      return;
    }
    visual.meshShadowMode = MeshShadowMode.None;
    const material = visual.mainMaterial;
    if (!material || !material.mainPass) {
      print(
        "PointCloudRenderer: mesh visual is missing a material pass (check LidarHeight/LidarObstacle materials reference unlit.ss_graph)",
      );
      return;
    }
    const pass = material.mainPass as any;
    pass.blendMode = useAlphaBlend ? BlendMode.Normal : BlendMode.Disabled;
    pass.twoSided = true;
    pass.depthWrite = false;
    pass.baseColor = new vec4(1, 1, 1, 1);
    pass.Port_Default_N204 = 1;
    if (typeof pass.vertexColorMode !== "undefined") {
      pass.vertexColorMode = 1;
    }
  }

  private _rebuildHeightMesh(points: [number, number, number][]): void {
    const builder = this._heightBuilder;
    const visual = this.heightVisual;
    if (!builder || !visual) {
      return;
    }

    const half = POINT_SIZE_CM * 0.5;
    let vertOffset = 0;
    let pointCount = 0;

    for (let i = 0; i < points.length && pointCount < MAX_POINTS; i++) {
      const world = this._protocolPointToVisualLocalCm(points[i], visual);
      if (world.y < Y_MIN_CM) {
        continue;
      }

      const t = clamp((world.y - Y_MIN_CM) / HEIGHT_RANGE_CM, 0, 1);
      const r = t;
      const g = t;
      const b = 1.0;
      const a = HEIGHT_POINT_ALPHA;

      appendCube(
        _vertBuffer,
        vertOffset,
        world.x,
        world.y,
        world.z,
        half,
        r,
        g,
        b,
        a,
      );
      vertOffset += VERTS_PER_POINT * FLOATS_PER_VERTEX;
      pointCount++;
    }

    this._uploadMesh(builder, visual, pointCount);
  }

  private _rebuildObstacleMesh(points: [number, number, number][]): void {
    const builder = this._obstacleBuilder;
    const visual = this.obstacleVisual;
    if (!builder || !visual) {
      return;
    }

    const robot = this._robotLocalCm(this._robotWorldPosition, visual);
    const half = POINT_SIZE_CM * 0.5;
    let vertOffset = 0;
    let pointCount = 0;

    for (let i = 0; i < points.length && pointCount < MAX_POINTS; i++) {
      const world = this._protocolPointToVisualLocalCm(points[i], visual);
      if (world.y < Y_MIN_CM) {
        continue;
      }

      const dist = horizontalDistanceCm(world, robot);
      if (
        dist < OBSTACLE_MIN_DIST_CM ||
        dist > OBSTACLE_FADE_END_CM
      ) {
        continue;
      }

      let alpha = 1.0;
      if (dist > OBSTACLE_OPAQUE_CM) {
        alpha =
          1.0 -
          (dist - OBSTACLE_OPAQUE_CM) /
            (OBSTACLE_FADE_END_CM - OBSTACLE_OPAQUE_CM);
      }
      if (alpha <= 0.001) {
        continue;
      }

      appendCube(
        _vertBuffer,
        vertOffset,
        world.x,
        world.y,
        world.z,
        half,
        1.0,
        0.0,
        0.0,
        alpha,
      );
      vertOffset += VERTS_PER_POINT * FLOATS_PER_VERTEX;
      pointCount++;
    }

    visual.getSceneObject().enabled = pointCount > 0;
    this._uploadMesh(builder, visual, pointCount);
  }

  private _uploadMesh(
    builder: MeshBuilder,
    visual: RenderMeshVisual,
    pointCount: number,
  ): void {
    const vertCount = pointCount * VERTS_PER_POINT;
    const indexCount = pointCount * INDICES_PER_POINT;

    const existingVerts = builder.getVerticesCount();
    if (existingVerts > 0) {
      builder.eraseVertices(0, existingVerts);
    }
    const existingIndices = builder.getIndicesCount();
    if (existingIndices > 0) {
      builder.eraseIndices(0, existingIndices);
    }

    if (pointCount === 0) {
      return;
    }

    builder.appendVerticesInterleaved(
      _vertBuffer.slice(0, vertCount * FLOATS_PER_VERTEX),
    );

    for (let i = 0; i < pointCount; i++) {
      const base = i * VERTS_PER_POINT;
      const idxBase = i * INDICES_PER_POINT;
      for (let j = 0; j < INDICES_PER_POINT; j++) {
        _indexBuffer[idxBase + j] = base + CUBE_INDICES[j];
      }
    }
    builder.appendIndices(_indexBuffer.slice(0, indexCount));

    if (!builder.isValid()) {
      return;
    }
    builder.updateMesh();
    visual.mesh = builder.getMesh();
  }

  private _clearMesh(
    builder: MeshBuilder | null,
    visual: RenderMeshVisual | null,
  ): void {
    if (!builder || !visual) {
      return;
    }
    const vertCount = builder.getVerticesCount();
    if (vertCount > 0) {
      builder.eraseVertices(0, vertCount);
    }
    const indexCount = builder.getIndicesCount();
    if (indexCount > 0) {
      builder.eraseIndices(0, indexCount);
    }
    if (builder.isValid()) {
      builder.updateMesh();
      visual.mesh = builder.getMesh();
    }
  }
}

function appendCube(
  buffer: number[],
  offset: number,
  x: number,
  y: number,
  z: number,
  half: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  const corners = [
    [x - half, y - half, z - half],
    [x + half, y - half, z - half],
    [x + half, y - half, z + half],
    [x - half, y - half, z + half],
    [x - half, y + half, z - half],
    [x + half, y + half, z - half],
    [x + half, y + half, z + half],
    [x - half, y + half, z + half],
  ];
  for (let i = 0; i < corners.length; i++) {
    const base = offset + i * FLOATS_PER_VERTEX;
    buffer[base] = corners[i][0];
    buffer[base + 1] = corners[i][1];
    buffer[base + 2] = corners[i][2];
    buffer[base + 3] = r;
    buffer[base + 4] = g;
    buffer[base + 5] = b;
    buffer[base + 6] = a;
  }
}

function horizontalDistanceCm(point: vec3, robot: vec3 | null): number {
  const origin = robot ?? vec3.zero();
  const dx = point.x - origin.x;
  const dz = point.z - origin.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
