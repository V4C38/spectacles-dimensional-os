import type { ClientTrackingOrigin } from "../core/localization/clientTrackingOrigin";
import { odomToClientTrackingPoint } from "../core/localization/clientTrackingTransforms";
import type { Vec3 } from "../core/websocket/protocolTypes";
import { clientTrackingToSpecsPoint } from "../SpecsCoordinates";

const POINT_SIZE_CM = 3.0;
const POINT_ALPHA = 0.8;
const FLOATS_PER_VERTEX = 7;
const VERTS_PER_POINT = 8;
const INDICES_PER_POINT = 36;

const CUBE_INDICES = [
  0, 2, 1, 0, 3, 2,
  4, 5, 6, 4, 6, 7,
  0, 1, 5, 0, 5, 4,
  2, 3, 7, 2, 7, 6,
  1, 2, 6, 1, 6, 5,
  0, 4, 7, 0, 7, 3,
];

export function composeLidarPoint(point: Vec3, origin: ClientTrackingOrigin): Vec3 {
  return clientTrackingToSpecsPoint(odomToClientTrackingPoint(point, origin));
}

@component
export class PointCloudRenderer extends BaseScriptComponent {
  @input("int", "1500")
  maxPoints: number = 1500;

  private visual: RenderMeshVisual | null = null;
  private builder: MeshBuilder | null = null;
  private vertBuffer: number[] = [];
  private indexBuffer: number[] = [];
  private cap = 0;

  onAwake(): void {
    this.cap = requireMaxPoints(this.maxPoints);
    this.vertBuffer = new Array(this.cap * VERTS_PER_POINT * FLOATS_PER_VERTEX);
    this.indexBuffer = new Array(this.cap * INDICES_PER_POINT);
    const visual = this.getSceneObject().getComponent(
      "Component.RenderMeshVisual",
    ) as RenderMeshVisual;
    if (!visual) {
      throw new Error("RenderMeshVisual is required");
    }
    const material = visual.mainMaterial;
    if (!material || !material.mainPass) {
      throw new Error("RenderMeshVisual material pass is required");
    }
    this.visual = visual;
    this.builder = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "color", components: 4, normalized: true },
    ]);
    this.builder.topology = MeshTopology.Triangles;
    this.builder.indexType = MeshIndexType.UInt16;
    visual.meshShadowMode = MeshShadowMode.None;
    const pass = material.mainPass as Pass & {
      blendMode: BlendMode;
      twoSided: boolean;
      depthWrite: boolean;
      baseColor: vec4;
      Port_Default_N204: number;
      vertexColorMode?: number;
    };
    pass.blendMode = BlendMode.Normal;
    pass.twoSided = false;
    pass.depthWrite = false;
    pass.baseColor = new vec4(1, 1, 1, 1);
    pass.Port_Default_N204 = 1;
    if (typeof pass.vertexColorMode !== "undefined") {
      pass.vertexColorMode = 1;
    }
    this.hide();
  }

  apply(input: { points: Vec3[] | null; origin: ClientTrackingOrigin | null }): void {
    if (!input.origin || !input.points || input.points.length === 0) {
      this.clear();
      return;
    }
    const visual = this.requireVisual();
    const invert = visual.getSceneObject().getTransform().getInvertedWorldTransform();
    const half = POINT_SIZE_CM * 0.5;
    let vertOffset = 0;
    let pointCount = 0;
    for (let i = 0; i < input.points.length && pointCount < this.cap; i++) {
      const specs = composeLidarPoint(input.points[i], input.origin);
      const local = invert.multiplyPoint(new vec3(specs[0], specs[1], specs[2]));
      const t = clamp((local.y + 50) / 200, 0, 1);
      const fade = 1 - t;
      appendCube(this.vertBuffer, vertOffset, local.x, local.y, local.z, half, fade, fade, 1, POINT_ALPHA);
      vertOffset += VERTS_PER_POINT * FLOATS_PER_VERTEX;
      pointCount++;
    }
    this.upload(pointCount);
    visual.enabled = pointCount > 0;
  }

  hide(): void {
    this.clear();
  }

  clear(): void {
    this.upload(0);
    if (this.visual) {
      this.visual.enabled = false;
    }
  }

  private requireVisual(): RenderMeshVisual {
    if (!this.visual || !this.builder || this.cap < 1) {
      throw new Error("RenderMeshVisual is required");
    }
    return this.visual;
  }

  private upload(pointCount: number): void {
    const builder = this.builder;
    const visual = this.visual;
    if (!builder || !visual) {
      throw new Error("RenderMeshVisual is required");
    }
    const existingVerts = builder.getVerticesCount();
    const existingIndices = builder.getIndicesCount();
    if (existingVerts > 0) {
      builder.eraseVertices(0, existingVerts);
    }
    if (existingIndices > 0) {
      builder.eraseIndices(0, existingIndices);
    }
    if (pointCount === 0) {
      if (builder.isValid()) {
        builder.updateMesh();
        visual.mesh = builder.getMesh();
      }
      return;
    }
    const vertCount = pointCount * VERTS_PER_POINT;
    const indexCount = pointCount * INDICES_PER_POINT;
    builder.appendVerticesInterleaved(this.vertBuffer.slice(0, vertCount * FLOATS_PER_VERTEX));
    for (let i = 0; i < pointCount; i++) {
      const base = i * VERTS_PER_POINT;
      const idxBase = i * INDICES_PER_POINT;
      for (let j = 0; j < INDICES_PER_POINT; j++) {
        this.indexBuffer[idxBase + j] = base + CUBE_INDICES[j];
      }
    }
    builder.appendIndices(this.indexBuffer.slice(0, indexCount));
    if (!builder.isValid()) {
      throw new Error("lidar mesh is invalid");
    }
    builder.updateMesh();
    visual.mesh = builder.getMesh();
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function requireMaxPoints(value: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error("maxPoints must be an integer >= 1");
  }
  return value;
}
