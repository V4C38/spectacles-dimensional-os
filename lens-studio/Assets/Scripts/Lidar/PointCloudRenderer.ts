import { protocolMetersToLensCentimeters } from "../Bridge/Protocol";
import { findChildRecursive } from "../UI/kit/UIKit";
import { buildMockLidarPoints } from "./MockLidarPoints";

const MAX_POINTS = 1000;
const POINT_SIZE_CM = 2.4;
const DEFAULT_MIN_ABOVE_FLOOR_CM = 0.5;
const DEFAULT_MAX_ABOVE_FLOOR_CM = 155;
const LIDAR_FILTER_DEBUG_INTERVAL_S = 5.0;
const OBSTACLE_MIN_DIST_CM = 10;
const OBSTACLE_OPAQUE_CM = 40;
const OBSTACLE_FADE_END_CM = 60;
const FULL_LIDAR_POINT_ALPHA = 0.4;
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
// Rebuilds full and obstacle LiDAR meshes from live or mock point clouds.
// ================================================================
/** Rebuilds full and obstacle LiDAR meshes from live or mock point clouds. */
@component
export class PointCloudRenderer extends BaseScriptComponent {
  @input
  pointParent: SceneObject;

  @input
  obstacleVisual: RenderMeshVisual;

  private fullLidarVisual: RenderMeshVisual | null = null;
  private _fullLidarBuilder: MeshBuilder | null = null;
  private _obstacleLidarBuilder: MeshBuilder | null = null;
  private _robotWorldPosition: vec3 | null = null;
  private _robotFloorWorldY: number | null = null;
  private _minAboveFloorCm = DEFAULT_MIN_ABOVE_FLOOR_CM;
  private _maxAboveFloorCm = DEFAULT_MAX_ABOVE_FLOOR_CM;
  private _fullLidarVisible = false;
  private _lastFilterDebugLogTime = 0;

  onAwake(): void {
    this._resolveVisuals();
    this._fullLidarBuilder = this._createBuilder();
    this._obstacleLidarBuilder = this._createBuilder();
    this._configureVisual(this.fullLidarVisual, true);
    this._configureVisual(this.obstacleVisual, true);
    this.setFullLidarVisible(false);
    this._clearMesh(this._fullLidarBuilder, this.fullLidarVisual);
    this._clearMesh(this._obstacleLidarBuilder, this.obstacleVisual);
  }

  private _resolveVisuals(): void {
    if (!this.pointParent) {
      return;
    }
    const fullLidarObject = findChildRecursive(
      this.pointParent,
      "LidarHeightVisual",
    );
    if (fullLidarObject) {
      this.fullLidarVisual = fullLidarObject.getComponent(
        "Component.RenderMeshVisual",
      ) as RenderMeshVisual;
    }
    if (!this.obstacleVisual) {
      const obstacleObject = findChildRecursive(
        this.pointParent,
        "LidarObstacleVisual",
      );
      if (obstacleObject) {
        this.obstacleVisual = obstacleObject.getComponent(
          "Component.RenderMeshVisual",
        ) as RenderMeshVisual;
      }
    }
  }

  /** Offline mock point cloud anchored at the robot marker (or origin). */
  public renderMockLidar(anchorCm: vec3 = vec3.zero()): void {
    const offsetM = anchorCm.uniformScale(0.01);
    const anchored = buildMockLidarPoints().map(
      (p) =>
        [p[0] + offsetM.x, p[1] + offsetM.y, p[2] + offsetM.z] as [
          number,
          number,
          number,
        ],
    );
    this.renderPointCloud(anchored);
  }

  /** Rebuild obstacle mesh always; rebuild full mesh only when full LiDAR is visible. */
  public renderPointCloud(points: [number, number, number][]): void {
    this._rebuildObstacleLidarMesh(points);
    if (this._fullLidarVisible) {
      this._rebuildFullLidarMesh(points);
    }
  }

  public setRobotWorldPosition(position: vec3): void {
    this._robotWorldPosition = position;
  }

  public setRobotFloorWorldY(floorYCm: number | null): void {
    this._robotFloorWorldY = floorYCm;
  }

  public setLidarVerticalBand(
    minAboveFloorCm: number,
    maxAboveFloorCm: number,
  ): void {
    this._minAboveFloorCm = minAboveFloorCm;
    this._maxAboveFloorCm = Math.max(maxAboveFloorCm, minAboveFloorCm + 1);
  }

  public setFullLidarVisible(enabled: boolean): void {
    this._fullLidarVisible = enabled;
    if (this.fullLidarVisual) {
      this.fullLidarVisual.getSceneObject().enabled = enabled;
    }
  }

  public clearFullLidar(): void {
    this._clearMesh(this._fullLidarBuilder, this.fullLidarVisual);
    if (this.fullLidarVisual) {
      this.fullLidarVisual.getSceneObject().enabled = false;
    }
  }

  public clearAll(): void {
    this._robotWorldPosition = null;
    this._robotFloorWorldY = null;
    this.clearFullLidar();
    this._clearMesh(this._obstacleLidarBuilder, this.obstacleVisual);
    if (this.obstacleVisual) {
      this.obstacleVisual.getSceneObject().enabled = false;
    }
  }

  private _invertWorldTransform(visual: RenderMeshVisual): mat4 {
    return visual.getSceneObject().getTransform().getInvertedWorldTransform();
  }

  /** Protocol points are world metres; mesh vertices must be in the visual's local cm space. */
  private _protocolPointToVisualLocalCm(
    point: [number, number, number],
    invertMat: mat4,
  ): vec3 {
    return invertMat.multiplyPoint(protocolMetersToLensCentimeters(point));
  }

  private _robotLocalCm(robot: vec3 | null, invertMat: mat4): vec3 | null {
    if (!robot) {
      return null;
    }
    return invertMat.multiplyPoint(robot);
  }

  /** Height above robot floor in world cm; falls back to robot-base-relative height. */
  private _heightAboveFloorWorldCm(point: [number, number, number]): number | null {
    const pointWorldCm = protocolMetersToLensCentimeters(point);
    const floorWorldY = this._robotFloorWorldY;
    if (floorWorldY !== null) {
      return pointWorldCm.y - floorWorldY;
    }
    const robot = this._robotWorldPosition;
    if (robot !== null) {
      return pointWorldCm.y - robot.y;
    }
    return pointWorldCm.y;
  }

  private _passesVerticalBand(heightAboveFloor: number | null): boolean {
    if (heightAboveFloor === null) {
      return false;
    }
    return (
      heightAboveFloor >= this._minAboveFloorCm &&
      heightAboveFloor <= this._maxAboveFloorCm
    );
  }

  private _maybeLogFilterDebug(
    layer: "full" | "obstacle",
    incomingCount: number,
    renderedCount: number,
  ): void {
    if (incomingCount === 0 || renderedCount > 0) {
      return;
    }
    const now = getTime();
    if (now - this._lastFilterDebugLogTime < LIDAR_FILTER_DEBUG_INTERVAL_S) {
      return;
    }
    this._lastFilterDebugLogTime = now;
    const floorY = this._robotFloorWorldY;
    print(
      `PointCloudRenderer: ${layer} filtered all ${incomingCount} points (floorWorldY=${
        floorY !== null ? floorY.toFixed(1) : "unknown"
      }, band=${this._minAboveFloorCm.toFixed(1)}..${this._maxAboveFloorCm.toFixed(1)}cm)`,
    );
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

  private _rebuildFullLidarMesh(points: [number, number, number][]): void {
    const builder = this._fullLidarBuilder;
    const visual = this.fullLidarVisual;
    if (!builder || !visual) {
      return;
    }

    const invertMat = this._invertWorldTransform(visual);
    const colorRangeCm = this._maxAboveFloorCm - this._minAboveFloorCm;
    const half = POINT_SIZE_CM * 0.5;
    let vertOffset = 0;
    let pointCount = 0;

    for (let i = 0; i < points.length && pointCount < MAX_POINTS; i++) {
      const heightAboveFloor = this._heightAboveFloorWorldCm(points[i]);
      if (!this._passesVerticalBand(heightAboveFloor)) {
        continue;
      }

      const world = this._protocolPointToVisualLocalCm(points[i], invertMat);
      const t = clamp(
        (heightAboveFloor! - this._minAboveFloorCm) / colorRangeCm,
        0,
        1,
      );
      const r = t;
      const g = t;
      const b = 1.0;
      const a = FULL_LIDAR_POINT_ALPHA;

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

    this._maybeLogFilterDebug("full", points.length, pointCount);
    this._uploadMesh(builder, visual, pointCount);
  }

  private _rebuildObstacleLidarMesh(points: [number, number, number][]): void {
    const builder = this._obstacleLidarBuilder;
    const visual = this.obstacleVisual;
    if (!builder || !visual) {
      return;
    }

    const invertMat = this._invertWorldTransform(visual);
    const robot = this._robotLocalCm(this._robotWorldPosition, invertMat);
    const half = POINT_SIZE_CM * 0.5;
    let vertOffset = 0;
    let pointCount = 0;

    for (let i = 0; i < points.length && pointCount < MAX_POINTS; i++) {
      const heightAboveFloor = this._heightAboveFloorWorldCm(points[i]);
      if (!this._passesVerticalBand(heightAboveFloor)) {
        continue;
      }

      const world = this._protocolPointToVisualLocalCm(points[i], invertMat);
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

    this._maybeLogFilterDebug("obstacle", points.length, pointCount);
    visual.getSceneObject().enabled = pointCount > 0;
    this._uploadMesh(builder, visual, pointCount);
  }

  private _uploadMesh(
    builder: MeshBuilder,
    visual: RenderMeshVisual,
    pointCount: number,
  ): void {
    const existingVerts = builder.getVerticesCount();
    const existingIndices = builder.getIndicesCount();

    if (pointCount === 0) {
      if (existingVerts === 0 && existingIndices === 0) {
        return;
      }
      if (existingVerts > 0) {
        builder.eraseVertices(0, existingVerts);
      }
      if (existingIndices > 0) {
        builder.eraseIndices(0, existingIndices);
      }
      if (builder.isValid()) {
        builder.updateMesh();
        visual.mesh = builder.getMesh();
      }
      return;
    }

    const vertCount = pointCount * VERTS_PER_POINT;
    const indexCount = pointCount * INDICES_PER_POINT;
    const vertFloatCount = vertCount * FLOATS_PER_VERTEX;

    if (existingVerts > 0) {
      builder.eraseVertices(0, existingVerts);
    }
    if (existingIndices > 0) {
      builder.eraseIndices(0, existingIndices);
    }

    builder.appendVerticesInterleaved(
      _vertBuffer.slice(0, vertFloatCount),
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
