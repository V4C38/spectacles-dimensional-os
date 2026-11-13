import type { Quat, Vec3, YawPose } from "../websocket/protocolTypes";
import type { ClientTrackingOrigin } from "./clientTrackingOrigin";

type PositionOrientation = {
  position: Vec3;
  orientation: Quat;
};

export function odomToClientTrackingPoint(
  point: Vec3,
  origin: ClientTrackingOrigin,
): Vec3 {
  return relativePointInOdom(point, origin);
}

export function clientTrackingToOdomPoint(
  point: Vec3,
  origin: ClientTrackingOrigin,
): Vec3 {
  return applyOriginPoint(point, origin);
}

export function odomToClientTrackingPose(
  pose: PositionOrientation,
  origin: ClientTrackingOrigin,
): PositionOrientation {
  return relativePoseInOdom(pose, origin);
}

export function clientTrackingToOdomPose(
  pose: PositionOrientation,
  origin: ClientTrackingOrigin,
): PositionOrientation {
  return applyOriginPose(pose, origin);
}

export function odomToClientTrackingYawPose(
  pose: YawPose,
  origin: ClientTrackingOrigin,
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
  pose: PositionOrientation,
  origin: ClientTrackingOrigin,
): PositionOrientation {
  const qInv = quatConjugate(requireOrigin(origin));
  return {
    position: rotateVecByQuat(qInv, sub(requireVec3(pose.position, "position"), origin.position)),
    orientation: multiplyRotation(qInv, normalizeQuat(pose.orientation)),
  };
}

function applyOriginPose(
  pose: PositionOrientation,
  origin: ClientTrackingOrigin,
): PositionOrientation {
  const q = requireOrigin(origin);
  return {
    position: applyOriginPoint(requireVec3(pose.position, "position"), origin),
    orientation: multiplyRotation(q, normalizeQuat(pose.orientation)),
  };
}

function relativePointInOdom(point: Vec3, origin: ClientTrackingOrigin): Vec3 {
  const qInv = quatConjugate(requireOrigin(origin));
  return rotateVecByQuat(qInv, sub(requireVec3(point, "position"), origin.position));
}

function applyOriginPoint(point: Vec3, origin: ClientTrackingOrigin): Vec3 {
  const rotated = rotateVecByQuat(requireOrigin(origin), requireVec3(point, "position"));
  return [
    rotated[0] + origin.position[0],
    rotated[1] + origin.position[1],
    rotated[2] + origin.position[2],
  ];
}

function poseFromYaw(pose: YawPose): PositionOrientation {
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

function requireOrigin(origin: ClientTrackingOrigin): Quat {
  requireVec3(origin.position, "ClientTrackingOrigin.position");
  return normalizeQuat(origin.orientation);
}

export function requireVec3(value: Vec3, key: string): Vec3 {
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

function quatYaw(q: Quat): number {
  const forward = rotateVecByQuat(normalizeQuat(q), [1, 0, 0]);
  const length = Math.hypot(forward[0], forward[1]);
  if (length < 1e-6) {
    throw new Error("degenerate yaw geometry");
  }
  return Math.atan2(forward[1], forward[0]);
}

export function requireQuat(q: Quat): Quat {
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

export function normalizeQuat(q: Quat): Quat {
  const orientation = requireQuat(q), length = Math.hypot(...orientation);
  return orientation.map(value => value / length) as Quat;
}

function quatConjugate(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

export function multiplyRotation(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function rotateVecByQuat(q: Quat, v: Vec3): Vec3 {
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

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export type Mat3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

/** Change both world and local axes of a rotation. */
export function changeBasisQuat(orientation: Quat, basis: Mat3): Quat {
  const inverse = transposeBasis(basis);
  const columns = ([ [1, 0, 0], [0, 1, 0], [0, 0, 1] ] as Vec3[])
    .map(axis => applyBasis(basis, rotateVecByQuat(orientation, applyBasis(inverse, axis))));
  return quatFromBasis(columns[0], columns[1], columns[2]);
}

export function remapPoseQuat(orientation: Quat, forward: Mat3): Quat {
  const x = applyBasis(forward, rotateVecByQuat(orientation, [1, 0, 0]));
  const y = applyBasis(forward, rotateVecByQuat(orientation, [0, 1, 0]));
  const z = applyBasis(forward, rotateVecByQuat(orientation, [0, 0, 1]));
  return quatFromBasis(x, y, z);
}

function quatFromBasis(x: Vec3, y: Vec3, z: Vec3): Quat {
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

export function applyBasis(matrix: Mat3, point: Vec3): Vec3 {
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

function normalizeVec3(value: Vec3): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length < 1e-6) {
    throw new Error("orientation must be a non-zero quaternion");
  }
  return [value[0] / length, value[1] / length, value[2] / length];
}

