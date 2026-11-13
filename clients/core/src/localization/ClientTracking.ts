import type { LocalizationResult, LocalizationMapTransform, MapAlignment, MapContext, Quat, Vec3, YawPose, CaptureGeometry, ReadonlyFacts } from "../ClientContracts";


/** `T_odom_client` — this client's tracking origin in `odom`. */
export interface ClientTrackingOrigin {
  position: Vec3;
  orientation: Quat;
  confidence: number;
  ts: number;
  mapAlignment?: MapAlignment;
  mapTransform?: LocalizationMapTransform;
}

export class ClientTrackingOriginStore {
  private current: ReadonlyFacts<ClientTrackingOrigin> | null = null;
  private alignment: ReadonlyFacts<MapAlignment> | null = null;
  private transform: ReadonlyFacts<LocalizationMapTransform> | null = null;
  private context: ReadonlyFacts<MapContext> | null = null;
  private trackingReference = "";

  get mapAlignment(): ReadonlyFacts<MapAlignment> | null { return this.alignment; }
  get mapContext(): ReadonlyFacts<MapContext> | null { return this.context; }
  beginTrackingReference(reference: string): void {
    if (this.trackingReference && this.trackingReference !== reference) { const context = this.context; this.clear(); this.context = context; }
    this.trackingReference = reference;
  }
  acceptsContext(context: ReadonlyFacts<MapContext>): boolean {
    return this.context !== null && this.context.map_code === context.map_code && this.context.odom_reference_id === context.odom_reference_id;
  }
  setMapContext(context: ReadonlyFacts<MapContext>, reset = false): void {
    if (reset || (this.context !== null && !this.acceptsContext(context)) ||
        (this.alignment !== null && (this.alignment.map_code !== context.map_code || this.alignment.odom_reference_id !== context.odom_reference_id))) this.clear();
    this.context = { ...context };
  }
  applyMapTransform(transform: ReadonlyFacts<LocalizationMapTransform>): void {
    if (!this.acceptsContext(transform) || (this.transform !== null && transform.revision <= this.transform.revision)) return;
    this.transform = { ...transform };
    this.recompose();
  }
  private recompose(): void {
    if (!this.alignment || !this.transform) return;
    const q = normalizeQuat(this.transform.orientation), b = normalizeQuat(this.alignment.orientation);
    const p = rotateVecByQuat(q, this.alignment.position), a = this.transform.position;
    this.current = {
      position: [a[0] + p[0], a[1] + p[1], a[2] + p[2]],
      orientation: normalizeQuat(multiplyRotation(q, b)),
      confidence: Math.min(this.alignment.confidence, this.transform.confidence), ts: this.alignment.ts,
      mapAlignment: this.alignment, mapTransform: this.transform,
    };
  }

  setFromLocalizationResult(result: ReadonlyFacts<LocalizationResult>): ReadonlyFacts<ClientTrackingOrigin> {
    const position = requireVec3(result.position, "position");
    const orientation = requireQuat(result.orientation);
    const confidence = result.confidence;
    const ts = result.ts;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new Error("Field 'confidence' must be in [0, 1]");
    }
    if (!Number.isFinite(ts)) {
      throw new Error("Field 'ts' must be finite");
    }
    if (result.map_alignment && result.map_transform) {
      if (!this.acceptsContext(result.map_alignment) || !this.acceptsContext(result.map_transform) ||
          result.map_alignment.tracking_reference_id !== this.trackingReference) throw new Error("Map alignment reference changed");
      this.alignment = result.map_alignment;
      if (!this.transform || result.map_transform.revision > this.transform.revision) this.transform = result.map_transform;
      this.recompose();
      return this.current!;
    }
    this.alignment = null;
    this.transform = null;
    this.current = {
      position: [position[0], position[1], position[2]],
      orientation: [orientation[0], orientation[1], orientation[2], orientation[3]],
      confidence,
      ts,
    };
    return this.current;
  }

  /** Restore a retained estimate without declaring it a newly observed localization result. */
  restore(origin: ReadonlyFacts<ClientTrackingOrigin>): void {
    if (origin.mapAlignment && origin.mapAlignment.tracking_reference_id !== this.trackingReference) { this.clear(); return; }
    this.alignment = origin.mapAlignment ?? null;
    this.transform = origin.mapTransform ?? null;
    if (this.alignment) this.context = { map_code: this.alignment.map_code, odom_reference_id: this.alignment.odom_reference_id };
    this.current = { ...origin, position: requireVec3(origin.position, "position"), orientation: requireQuat(origin.orientation) };
  }

  clear(): void {
    this.alignment = null;
    this.transform = null;
    this.context = null;
    this.current = null;
  }

  get T_odom_client(): ReadonlyFacts<ClientTrackingOrigin> | null {
    return this.current;
  }

  get hasTrackingOrigin(): boolean {
    return this.current !== null;
  }
}

/** Corrections within one reference preserve interaction ownership. */
export function sameTrackingReference(a: ReadonlyFacts<ClientTrackingOrigin> | null, b: ReadonlyFacts<ClientTrackingOrigin> | null): boolean {
  return !!a && !!b && a.mapAlignment?.tracking_reference_id === b.mapAlignment?.tracking_reference_id &&
    a.mapAlignment?.odom_reference_id === b.mapAlignment?.odom_reference_id && a.mapAlignment?.map_code === b.mapAlignment?.map_code;
}

export type PositionOrientation = { position: Vec3; orientation: Quat };
export type ReadonlyPose = ReadonlyFacts<PositionOrientation>;

export function odomToClientTrackingPoint(
  point: Readonly<Vec3>,
  origin: ReadonlyFacts<ClientTrackingOrigin>,
): Vec3 {
  return relativePointInOdom(point, origin);
}

export function clientTrackingToOdomPoint(
  point: Readonly<Vec3>,
  origin: ReadonlyFacts<ClientTrackingOrigin>,
): Vec3 {
  return applyOriginPoint(point, origin);
}

export function odomToClientTrackingPose(
  pose: ReadonlyPose,
  origin: ReadonlyFacts<ClientTrackingOrigin>,
): PositionOrientation {
  return relativePoseInOdom(pose, origin);
}

export function clientTrackingToOdomPose(
  pose: ReadonlyPose,
  origin: ReadonlyFacts<ClientTrackingOrigin>,
): PositionOrientation {
  return applyOriginPose(pose, origin);
}

export function odomToClientTrackingYawPose(
  pose: Readonly<YawPose>,
  origin: ReadonlyFacts<ClientTrackingOrigin>,
): YawPose {
  const relative = relativePoseInOdom(poseFromYaw(pose), origin);
  return [
    relative.position[0],
    relative.position[1],
    relative.position[2],
    quatYaw(relative.orientation),
  ];
}

function relativePoseInOdom(
  pose: ReadonlyPose,
  origin: ReadonlyFacts<ClientTrackingOrigin>,
): PositionOrientation {
  const qInv = quatConjugate(requireOrigin(origin));
  return {
    position: rotateVecByQuat(qInv, sub(requireVec3(pose.position, "position"), origin.position)),
    orientation: multiplyRotation(qInv, normalizeQuat(pose.orientation)),
  };
}

function applyOriginPose(
  pose: ReadonlyPose,
  origin: ReadonlyFacts<ClientTrackingOrigin>,
): PositionOrientation {
  const q = requireOrigin(origin);
  return {
    position: applyOriginPoint(requireVec3(pose.position, "position"), origin),
    orientation: multiplyRotation(q, normalizeQuat(pose.orientation)),
  };
}

function relativePointInOdom(point: Readonly<Vec3>, origin: ReadonlyFacts<ClientTrackingOrigin>): Vec3 {
  const qInv = quatConjugate(requireOrigin(origin));
  return rotateVecByQuat(qInv, sub(requireVec3(point, "position"), origin.position));
}

function applyOriginPoint(point: Readonly<Vec3>, origin: ReadonlyFacts<ClientTrackingOrigin>): Vec3 {
  const rotated = rotateVecByQuat(requireOrigin(origin), requireVec3(point, "position"));
  return [
    rotated[0] + origin.position[0],
    rotated[1] + origin.position[1],
    rotated[2] + origin.position[2],
  ];
}

function poseFromYaw(pose: Readonly<YawPose>): PositionOrientation {
  if (!Array.isArray(pose) || pose.length !== 4) {
    throw new Error("yaw pose must be a 4-element [x, y, z, yaw]");
  }
  return {
    position: [
      requireFinite(pose[0], "position[0]"),
      requireFinite(pose[1], "position[1]"),
      requireFinite(pose[2], "position[2]"),
    ],
    orientation: quatFromYaw(requireFinite(pose[3], "yaw")),
  };
}

function requireOrigin(origin: ReadonlyFacts<ClientTrackingOrigin>): Quat {
  requireVec3(origin.position, "ClientTrackingOrigin.position");
  return normalizeQuat(origin.orientation);
}

export function requireVec3(value: Readonly<Vec3>, key: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`${key} must be a 3-element array`);
  }
  return [
    requireFinite(value[0], `${key}[0]`),
    requireFinite(value[1], `${key}[1]`),
    requireFinite(value[2], `${key}[2]`),
  ];
}

export function requireFinite(value: unknown, key: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be finite`);
  }
  return value;
}

function quatFromYaw(yaw: number): Quat {
  const half = yaw * 0.5;
  return [0, 0, Math.sin(half), Math.cos(half)];
}

function quatYaw(q: Readonly<Quat>): number {
  const forward = rotateVecByQuat(normalizeQuat(q), [1, 0, 0]);
  const length = Math.hypot(forward[0], forward[1]);
  if (length < 1e-6) {
    throw new Error("degenerate yaw geometry");
  }
  return Math.atan2(forward[1], forward[0]);
}

export function requireQuat(q: Readonly<Quat>): Quat {
  if (!Array.isArray(q) || q.length !== 4) {
    throw new Error("orientation must be a 4-element quaternion [qx, qy, qz, qw]");
  }
  const orientation: Quat = [
    requireFinite(q[0], "orientation[0]"),
    requireFinite(q[1], "orientation[1]"),
    requireFinite(q[2], "orientation[2]"),
    requireFinite(q[3], "orientation[3]"),
  ];
  const length = Math.hypot(orientation[0], orientation[1], orientation[2], orientation[3]);
  if (length < 1e-6) {
    throw new Error("orientation must be a non-zero quaternion");
  }
  return orientation;
}

export function normalizeQuat(q: Readonly<Quat>): Quat {
  const orientation = requireQuat(q), length = Math.hypot(...orientation);
  return orientation.map(value => value / length) as Quat;
}

function quatConjugate(q: Readonly<Quat>): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

export function multiplyRotation(a: Readonly<Quat>, b: Readonly<Quat>): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Compose rigid poses in one basis. Input poses are observations, never mutation targets. */
export function composePose(a: ReadonlyPose, b: ReadonlyPose): PositionOrientation {
  const offset = rotateVecByQuat(a.orientation, b.position);
  return {
    position: [a.position[0] + offset[0], a.position[1] + offset[1], a.position[2] + offset[2]],
    orientation: multiplyRotation(a.orientation, b.orientation),
  };
}

/** Poses are rigid transforms with unit rotations, as validated at their input boundary. */
export function inversePose(pose: ReadonlyPose): PositionOrientation {
  const inverse = quatConjugate(pose.orientation);
  const translation: Vec3 = [-pose.position[0], -pose.position[1], -pose.position[2]];
  return { position: rotateVecByQuat(inverse, translation), orientation: inverse };
}

export function lerpVec3(a: Readonly<Vec3>, b: Readonly<Vec3>, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Shortest-arc interpolation; finite non-zero input rotations are normalized here. */
export function slerpQuat(a: Readonly<Quat>, input: Readonly<Quat>, t: number): Quat {
  requireFinite(t, "interpolation fraction");
  const left = normalizeQuat(a);
  let right = normalizeQuat(input);
  let dot = left.reduce((sum, value, i) => sum + value * right[i], 0);
  if (dot < 0) {
    right = [-right[0], -right[1], -right[2], -right[3]];
    dot = -dot;
  }
  if (dot > 0.9995) {
    return normalizeQuat([
      left[0] + (right[0] - left[0]) * t,
      left[1] + (right[1] - left[1]) * t,
      left[2] + (right[2] - left[2]) * t,
      left[3] + (right[3] - left[3]) * t,
    ]);
  }
  const angle = Math.acos(Math.min(1, dot));
  const denominator = Math.sin(angle);
  const l = Math.sin((1 - t) * angle) / denominator;
  const r = Math.sin(t * angle) / denominator;
  return normalizeQuat([
    left[0] * l + right[0] * r,
    left[1] * l + right[1] * r,
    left[2] * l + right[2] * r,
    left[3] * l + right[3] * r,
  ]);
}

/** Component identity for replicated samples; geometric rotation equivalence is a different policy. */
export function poseCoordinatesEqual(a: ReadonlyPose, b: ReadonlyPose, tolerance = 1e-8): boolean {
  return a.position.every((value, i) => (value === b.position[i] || Math.abs(value - b.position[i]) < tolerance)) &&
    a.orientation.every((value, i) => (value === b.orientation[i] || Math.abs(value - b.orientation[i]) < tolerance));
}

export function rotateVecByQuat(q: Readonly<Quat>, v: Readonly<Vec3>): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

function sub(a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export type Mat3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

/** Change both world and local axes of a rotation. */
export function changeBasisQuat(orientation: Readonly<Quat>, basis: Mat3): Quat {
  const inverse = transposeBasis(basis);
  const columns = ([ [1, 0, 0], [0, 1, 0], [0, 0, 1] ] as Vec3[])
    .map(axis => applyBasis(basis, rotateVecByQuat(orientation, applyBasis(inverse, axis))));
  return quatFromBasis(columns[0], columns[1], columns[2]);
}

export function remapPoseQuat(orientation: Readonly<Quat>, forward: Mat3): Quat {
  const x = applyBasis(forward, rotateVecByQuat(orientation, [1, 0, 0]));
  const y = applyBasis(forward, rotateVecByQuat(orientation, [0, 1, 0]));
  const z = applyBasis(forward, rotateVecByQuat(orientation, [0, 0, 1]));
  return quatFromBasis(x, y, z);
}

export function quatFromBasis(x: Readonly<Vec3>, y: Readonly<Vec3>, z: Readonly<Vec3>): Quat {
  const c0 = normalizeVec3(x);
  const c1 = normalizeVec3(y);
  const c2 = normalizeVec3(z);
  const r00 = c0[0];
  const r01 = c1[0];
  const r02 = c2[0];
  const r10 = c0[1];
  const r11 = c1[1];
  const r12 = c2[1];
  const r20 = c0[2];
  const r21 = c1[2];
  const r22 = c2[2];
  const trace = r00 + r11 + r22;
  let qx: number;
  let qy: number;
  let qz: number;
  let qw: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    qw = 0.25 * s;
    qx = (r21 - r12) / s;
    qy = (r02 - r20) / s;
    qz = (r10 - r01) / s;
  } else if (r00 > r11 && r00 > r22) {
    const s = Math.sqrt(1 + r00 - r11 - r22) * 2;
    qw = (r21 - r12) / s;
    qx = 0.25 * s;
    qy = (r01 + r10) / s;
    qz = (r02 + r20) / s;
  } else if (r11 > r22) {
    const s = Math.sqrt(1 + r11 - r00 - r22) * 2;
    qw = (r02 - r20) / s;
    qx = (r01 + r10) / s;
    qy = 0.25 * s;
    qz = (r12 + r21) / s;
  } else {
    const s = Math.sqrt(1 + r22 - r00 - r11) * 2;
    qw = (r10 - r01) / s;
    qx = (r02 + r20) / s;
    qy = (r12 + r21) / s;
    qz = 0.25 * s;
  }
  return normalizeQuat([qx, qy, qz, qw]);
}

export function applyBasis(matrix: Mat3, point: Readonly<Vec3>): Vec3 {
  return [
    matrix[0][0] * point[0] + matrix[0][1] * point[1] + matrix[0][2] * point[2],
    matrix[1][0] * point[0] + matrix[1][1] * point[1] + matrix[1][2] * point[2],
    matrix[2][0] * point[0] + matrix[2][1] * point[1] + matrix[2][2] * point[2],
  ];
}

export function transposeBasis(matrix: Mat3): Mat3 {
  return [
    [matrix[0][0], matrix[1][0], matrix[2][0]],
    [matrix[0][1], matrix[1][1], matrix[2][1]],
    [matrix[0][2], matrix[1][2], matrix[2][2]],
  ];
}

function normalizeVec3(value: Readonly<Vec3>): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length < 1e-6) {
    throw new Error("orientation must be a non-zero quaternion");
  }
  return [value[0] / length, value[1] / length, value[2] / length];
}

export function passesGeometricGate(
  cameraOptical: ReadonlyPose,
  robotTrackingPosition: Readonly<Vec3>,
  geometry: Pick<CaptureGeometry, "minDistanceM" | "maxDistanceM" | "lookAtMaxAngleDeg">,
): boolean {
  const camera = requireVec3(cameraOptical.position, "camera position");
  const robot = requireVec3(robotTrackingPosition, "robot position");
  const dx = robot[0] - camera[0];
  const dy = robot[1] - camera[1];
  const dz = robot[2] - camera[2];
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 1e-6) {
    return false;
  }
  if (distance < geometry.minDistanceM || distance > geometry.maxDistanceM) {
    return false;
  }
  const view = rotateVecByQuat(normalizeQuat(cameraOptical.orientation), [0, 0, 1]);
  const viewLen = Math.hypot(view[0], view[1], view[2]);
  if (viewLen < 1e-6) {
    return false;
  }
  const dot =
    (view[0] / viewLen) * (dx / distance) +
    (view[1] / viewLen) * (dy / distance) +
    (view[2] / viewLen) * (dz / distance);
  return dot >= Math.cos((geometry.lookAtMaxAngleDeg * Math.PI) / 180);
}
