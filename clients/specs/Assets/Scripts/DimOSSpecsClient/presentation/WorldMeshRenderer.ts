import { strokeJoints2D, STROKE_JOIN_SEGMENTS, WORLD_DASH_STYLE } from "../../DimOSARClient/presentation/WorldVisualStyle";
import type { Vec3 } from "../../DimOSARClient/websocket/protocolTypes";

export const WORLD_COLOR_MATERIAL = requireAsset("../../../Materials/WorldVertexColor.mat") as Material;
export const WORLD_STROKE_MATERIAL = requireAsset("../../../Materials/AdaptiveStroke.mat") as Material;
/** Unlit native custom shaders consume display RGB directly; do not linearize these values. */
export type WorldColor = readonly [number, number, number, number];

/** One batched native mesh, with no physics or interaction components. Units are centimetres. */
export class WorldMeshRenderer {
  readonly object: SceneObject;
  readonly visual: RenderMeshVisual;
  readonly material: Material;
  private readonly builder: MeshBuilder;
  private lastVertices: readonly number[] = [];
  private lastIndices: readonly number[] = [];
  private triangleInput: { positions: readonly number[]; indices: readonly number[]; color: WorldColor; uvs?: readonly number[]; normals?: readonly number[] } | null = null;

  constructor(parent: SceneObject, name: string, material: Material = WORLD_COLOR_MATERIAL,
    readonly stroke = false) {
    this.object = global.scene.createSceneObject(name);
    this.object.setParent(parent);
    const transform = this.object.getTransform();
    transform.setLocalPosition(vec3.zero()); transform.setLocalRotation(quat.quatIdentity());
    this.material = material.clone();
    this.visual = this.object.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    this.visual.mainMaterial = this.material;
    this.visual.meshShadowMode = MeshShadowMode.None;
    const pass = this.material.mainPass as Pass & { blendMode: BlendMode; depthWrite: boolean; twoSided: boolean };
    pass.blendMode = BlendMode.Normal; pass.depthWrite = false; pass.twoSided = true;
    const attributes = [{ name: "position", components: 3 }, { name: "normal", components: 3 },
      { name: "color", components: 4 }, { name: "texture0", components: 2 }];
    if (stroke) for (let i = 1; i <= 5; i++) attributes.push({ name: `texture${i}`, components: 2 });
    this.builder = new MeshBuilder(attributes);
    this.builder.topology = MeshTopology.Triangles;
    this.builder.indexType = MeshIndexType.UInt16;
    this.hide();
  }

  upload(vertices: number[], indices: readonly number[]): void {
    if (!indices.length) { this.hide(); return; }
    if (sameNumbers(vertices, this.lastVertices) && sameNumbers(indices, this.lastIndices)) {
      this.object.enabled = true; return;
    }
    this.lastVertices = vertices.slice(); this.lastIndices = indices.slice();
    if (this.builder.getVerticesCount()) this.builder.eraseVertices(0, this.builder.getVerticesCount());
    if (this.builder.getIndicesCount()) this.builder.eraseIndices(0, this.builder.getIndicesCount());
    this.builder.appendVerticesInterleaved(vertices); this.builder.appendIndices([...indices]);
    if (!this.builder.isValid()) throw new Error(`${this.object.name}: invalid world mesh`);
    this.builder.updateMesh(); this.visual.mesh = this.builder.getMesh(); this.object.enabled = true;
  }

  triangles(positions: readonly number[], indices: readonly number[], color: WorldColor,
    uvs?: readonly number[], normals?: readonly number[]): void {
    const previous = this.triangleInput;
    if (previous && cachedCirclePositions.has(positions) && previous.positions === positions && previous.indices === indices && previous.uvs === uvs &&
      previous.normals === normals && sameNumbers(previous.color, color)) { this.object.enabled = indices.length > 0; return; }
    this.triangleInput = { positions, indices, color: [...color], uvs, normals };
    const vertices: number[] = [];
    for (let i = 0; i < positions.length / 3; i++) {
      vertices.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2],
        normals?.[i * 3] ?? 0, normals?.[i * 3 + 1] ?? 1, normals?.[i * 3 + 2] ?? 0,
        ...color, uvs?.[i * 2] ?? 0, uvs?.[i * 2 + 1] ?? 0);
    }
    this.upload(vertices, indices);
  }

  setViewportHeight(height: number): void {
    (this.material.mainPass as Pass & { viewportHeightPx: number }).viewportHeightPx = Math.max(1, height);
  }
  hide(): void { this.object.enabled = false; }
  destroy(): void { this.object.destroy(); }
}

const cachedCirclePositions = new WeakSet<readonly number[]>();
export type CircleGeometry = Readonly<{ positions: readonly number[]; indices: readonly number[] }>;
const circleCache = new Map<string, CircleGeometry>();

export function circleMesh(radiusCm: number, strokeCm: number, progress = 1, segments = 128, startAngle = Math.PI / 2): CircleGeometry {
  const count = Math.max(0, Math.min(segments, Math.floor(segments * progress)));
  const key = `${radiusCm}:${strokeCm}:${count}:${segments}:${startAngle}`;
  const cached = circleCache.get(key);
  if (cached) { circleCache.delete(key); circleCache.set(key, cached); return cached; }
  const positions: number[] = [], indices: number[] = [];
  for (let i = 0; i <= count; i++) {
    const angle = startAngle - i / segments * Math.PI * 2;
    for (const r of [radiusCm - strokeCm, radiusCm]) positions.push(Math.cos(angle) * r, 0, Math.sin(angle) * r);
    if (i) { const v = i * 2; indices.push(v - 2, v - 1, v, v - 1, v + 1, v); }
  }
  const geometry = Object.freeze({ positions: Object.freeze(positions), indices: Object.freeze(indices) });
  if (circleCache.size >= 64) circleCache.delete(circleCache.keys().next().value!);
  circleCache.set(key, geometry);
  cachedCirclePositions.add(positions);
  return geometry;
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Adaptive stroke quads encode the same segment metric used by the WebXR shader. */
export class AdaptiveStrokeRenderer extends WorldMeshRenderer {
  constructor(parent: SceneObject, name: string) { super(parent, name, WORLD_STROKE_MATERIAL, true); }
  segments(points: readonly Vec3[], widthCm: number, opacity: number,
    dashCm: number = WORLD_DASH_STYLE.dashM * 100, gapCm: number = WORLD_DASH_STYLE.gapM * 100,
    continuous = false): void {
    const vertices: number[] = [], indices: number[] = [];
    let distance = 0;
    for (let i = 0; i + 1 < points.length; i += 2) {
      const a = points[i], b = points[i + 1], start = vertices.length / 22;
      for (const [side, t] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) {
        vertices.push(...a, 0, 1, 0, 1, 1, 1, opacity, side, t,
          b[0], b[1], b[2], continuous ? distance : 0, widthCm, dashCm, gapCm, a[0], a[1], a[2]);
      }
      indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
      distance += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    }
    this.upload(vertices, indices);
  }
}

/** Screen-space stroke quads in centimetres, with the same trace interpolation as WebXR. */
export function strokeMesh2D(segments: readonly (readonly number[])[], progresses: readonly number[],
  widthCm: number, plane: "xy" | "xz" = "xy", scale = 1) {
  const positions: number[] = [], indices: number[] = [];
  segments.forEach(([x1, y1, x2, y2], index) => {
    const t = Math.max(0, Math.min(1, progresses[index] ?? 0));
    const eased = t * t * (3 - 2 * t);
    const dx = (x2 - x1) * eased, dy = (y2 - y1) * eased, length = Math.hypot(dx, dy);
    if (length < 0.000001) return;
    const nx = -dy / length * widthCm / 2, ny = dx / length * widthCm / 2, start = positions.length / 3;
    for (const [x, y] of [[x1 + nx, y1 + ny], [x1 - nx, y1 - ny],
      [x1 + dx + nx, y1 + dy + ny], [x1 + dx - nx, y1 + dy - ny]]) {
      if (plane === "xy") positions.push(x * scale, y * scale, 0);
      else positions.push(x * scale, 0, -y * scale);
    }
    indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
  });
  for (const [x, y] of strokeJoints2D(segments, progresses)) {
    const start = positions.length / 3;
    const vertex = (px: number, py: number) => {
      if (plane === "xy") positions.push(px * scale, py * scale, 0);
      else positions.push(px * scale, 0, -py * scale);
    };
    vertex(x, y);
    for (let i = 0; i <= STROKE_JOIN_SEGMENTS; i++) {
      const angle = i / STROKE_JOIN_SEGMENTS * Math.PI * 2;
      vertex(x + Math.cos(angle) * widthCm / 2, y + Math.sin(angle) * widthCm / 2);
      if (i) indices.push(start, start + i, start + i + 1);
    }
  }
  return { positions, indices };
}

export function sphereMesh(radiusCm: number, longitude = 24, latitude = 16) {
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  for (let y = 0; y <= latitude; y++) for (let x = 0; x <= longitude; x++) {
    const theta = y / latitude * Math.PI, phi = x / longitude * Math.PI * 2;
    const normal = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
    positions.push(...normal.map(v => v * radiusCm)); normals.push(...normal);
    if (y && x) { const b = y * (longitude + 1) + x, a = b - longitude - 1; indices.push(a - 1, b - 1, a, a, b - 1, b); }
  }
  return { positions, normals, indices };
}
