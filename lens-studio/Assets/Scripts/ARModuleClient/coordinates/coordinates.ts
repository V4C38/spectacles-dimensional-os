import type { Quat, Vec3, YawPose } from "../websocket/types";

export type Matrix3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

export interface CoordinateBasis {
  readonly name: string;
  readonly odomToClient: Matrix3;
}

export const SPECTACLES_BASIS: CoordinateBasis = {
  name: "spectacles",
  odomToClient: [
    [0, -1, 0],
    [0, 0, 1],
    [1, 0, 0],
  ],
};

const ORTHONORMAL_EPS = 1e-6;

export function odomToClientPosition(position: Vec3, basis: CoordinateBasis): Vec3 {
  return convertPosition(position, basis.odomToClient);
}

export function clientToOdomPosition(position: Vec3, basis: CoordinateBasis): Vec3 {
  return convertPosition(position, transpose(basis.odomToClient));
}

export function odomToClientOrientation(orientation: Quat, basis: CoordinateBasis): Quat {
  return convertOrientation(orientation, basis.odomToClient);
}

export function clientToOdomOrientation(orientation: Quat, basis: CoordinateBasis): Quat {
  return convertOrientation(orientation, transpose(basis.odomToClient));
}

export function odomToClientYaw(yaw: number, basis: CoordinateBasis): number {
  return convertYaw(yaw, basis.odomToClient);
}

export function clientToOdomYaw(yaw: number, basis: CoordinateBasis): number {
  const matrix = validatedMatrix(basis.odomToClient);
  const forward0 = applyMatrix(matrix, [1, 0, 0]);
  const left0 = applyMatrix(matrix, [0, 1, 0]);
  const qClient = quatFromAxisAngle(cross(forward0, left0), requireFiniteNumber(yaw, "yaw"));
  const qOdom = convertOrientation(qClient, transpose(matrix));
  return extractYaw(qOdom, [1, 0, 0], [0, 1, 0], [0, 0, 1]);
}

export function odomToClientYawPose(pose: YawPose, basis: CoordinateBasis): YawPose {
  return convertYawPose(pose, basis.odomToClient);
}

export function clientToOdomYawPose(pose: YawPose, basis: CoordinateBasis): YawPose {
  const values = requireFiniteYawPose(pose);
  const position = convertPosition([values[0], values[1], values[2]], transpose(basis.odomToClient));
  return [position[0], position[1], position[2], clientToOdomYaw(values[3], basis)];
}

export function convertPosition(position: Vec3, matrix: Matrix3): Vec3 {
  return applyMatrix(validatedMatrix(matrix), requireFiniteVec3(position, "position"));
}

export function convertOrientation(orientation: Quat, matrix: Matrix3): Quat {
  const rotation = quatToMatrix(normalizeQuat(requireFiniteQuat(orientation)));
  const valid = validatedMatrix(matrix);
  const converted = multiplyMatrix(valid, multiplyMatrix(rotation, transpose(valid)));
  return quatFromMatrix(converted);
}

export function convertYaw(yaw: number, matrix: Matrix3): number {
  const valid = validatedMatrix(matrix);
  const qDest = convertOrientation(quatFromAxisAngle([0, 0, 1], requireFiniteNumber(yaw, "yaw")), valid);
  return extractYaw(qDest, applyMatrix(valid, [1, 0, 0]), applyMatrix(valid, [0, 1, 0]), applyMatrix(valid, [0, 0, 1]));
}

export function convertYawPose(pose: YawPose, matrix: Matrix3): YawPose {
  const values = requireFiniteYawPose(pose);
  const position = convertPosition([values[0], values[1], values[2]], matrix);
  return [position[0], position[1], position[2], convertYaw(values[3], matrix)];
}

function applyMatrix(matrix: Matrix3, position: Vec3): Vec3 {
  return [
    matrix[0][0] * position[0] + matrix[0][1] * position[1] + matrix[0][2] * position[2],
    matrix[1][0] * position[0] + matrix[1][1] * position[1] + matrix[1][2] * position[2],
    matrix[2][0] * position[0] + matrix[2][1] * position[1] + matrix[2][2] * position[2],
  ];
}

function validatedMatrix(matrix: Matrix3): Matrix3 {
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (!Number.isFinite(matrix[i][j])) {
        throw new Error("coordinate basis must be finite");
      }
    }
  }
  for (let i = 0; i < 3; i++) {
    const length = Math.hypot(matrix[i][0], matrix[i][1], matrix[i][2]);
    if (Math.abs(length - 1) > ORTHONORMAL_EPS) {
      throw new Error("coordinate basis must be orthonormal");
    }
  }
  if (
    Math.abs(dot(matrix[0], matrix[1])) > ORTHONORMAL_EPS ||
    Math.abs(dot(matrix[0], matrix[2])) > ORTHONORMAL_EPS ||
    Math.abs(dot(matrix[1], matrix[2])) > ORTHONORMAL_EPS
  ) {
    throw new Error("coordinate basis must be orthonormal");
  }
  return matrix;
}

function transpose(matrix: Matrix3): Matrix3 {
  return [
    [matrix[0][0], matrix[1][0], matrix[2][0]],
    [matrix[0][1], matrix[1][1], matrix[2][1]],
    [matrix[0][2], matrix[1][2], matrix[2][2]],
  ];
}

function multiplyMatrix(a: Matrix3, b: Matrix3): Matrix3 {
  const row = (i: number): [number, number, number] => [
    a[i][0] * b[0][0] + a[i][1] * b[1][0] + a[i][2] * b[2][0],
    a[i][0] * b[0][1] + a[i][1] * b[1][1] + a[i][2] * b[2][1],
    a[i][0] * b[0][2] + a[i][1] * b[1][2] + a[i][2] * b[2][2],
  ];
  return [row(0), row(1), row(2)];
}

function quatToMatrix(q: Quat): Matrix3 {
  const [x, y, z, w] = q;
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;
  return [
    [1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy)],
    [2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx)],
    [2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy)],
  ];
}

function quatFromMatrix(m: Matrix3): Quat {
  const r00 = m[0][0];
  const r01 = m[0][1];
  const r02 = m[0][2];
  const r10 = m[1][0];
  const r11 = m[1][1];
  const r12 = m[1][2];
  const r20 = m[2][0];
  const r21 = m[2][1];
  const r22 = m[2][2];
  const trace = r00 + r11 + r22;
  let w: number;
  let x: number;
  let y: number;
  let z: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (r21 - r12) / s;
    y = (r02 - r20) / s;
    z = (r10 - r01) / s;
  } else if (r00 > r11 && r00 > r22) {
    const s = Math.sqrt(1 + r00 - r11 - r22) * 2;
    w = (r21 - r12) / s;
    x = 0.25 * s;
    y = (r01 + r10) / s;
    z = (r02 + r20) / s;
  } else if (r11 > r22) {
    const s = Math.sqrt(1 + r11 - r00 - r22) * 2;
    w = (r02 - r20) / s;
    x = (r01 + r10) / s;
    y = 0.25 * s;
    z = (r12 + r21) / s;
  } else {
    const s = Math.sqrt(1 + r22 - r00 - r11) * 2;
    w = (r10 - r01) / s;
    x = (r02 + r20) / s;
    y = (r12 + r21) / s;
    z = 0.25 * s;
  }
  return normalizeQuat([x, y, z, w]);
}

function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const length = Math.hypot(axis[0], axis[1], axis[2]);
  if (length < ORTHONORMAL_EPS) {
    throw new Error("yaw axis must be non-zero");
  }
  const half = angle * 0.5;
  const s = Math.sin(half) / length;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
}

function normalizeQuat(q: Quat): Quat {
  const length = Math.hypot(q[0], q[1], q[2], q[3]);
  if (length < ORTHONORMAL_EPS) {
    throw new Error("orientation must be a non-zero quaternion");
  }
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

function rotateVecByQuat(q: Quat, v: Vec3): Vec3 {
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

function extractYaw(q: Quat, forward0: Vec3, left0: Vec3, up: Vec3): number {
  const forward = reject(rotateVecByQuat(q, forward0), up);
  const refForward = reject(forward0, up);
  const refLeft = reject(left0, up);
  const forwardLen = Math.hypot(forward[0], forward[1], forward[2]);
  const refForwardLen = Math.hypot(refForward[0], refForward[1], refForward[2]);
  const refLeftLen = Math.hypot(refLeft[0], refLeft[1], refLeft[2]);
  if (forwardLen < ORTHONORMAL_EPS || refForwardLen < ORTHONORMAL_EPS || refLeftLen < ORTHONORMAL_EPS) {
    throw new Error("degenerate yaw geometry");
  }
  return Math.atan2(
    dot(forward, refLeft) / (forwardLen * refLeftLen),
    dot(forward, refForward) / (forwardLen * refForwardLen),
  );
}

function reject(v: Vec3, axis: Vec3): Vec3 {
  const axisLen = Math.hypot(axis[0], axis[1], axis[2]);
  if (axisLen < ORTHONORMAL_EPS) {
    throw new Error("yaw up axis must be non-zero");
  }
  const scale = dot(v, axis) / (axisLen * axisLen);
  return [v[0] - axis[0] * scale, v[1] - axis[1] * scale, v[2] - axis[2] * scale];
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be finite`);
  }
  return value;
}

function requireFiniteVec3(position: Vec3, label: string): Vec3 {
  if (!Array.isArray(position) || position.length !== 3) {
    throw new Error(`${label} must be a 3-element array`);
  }
  return [
    requireFiniteNumber(position[0], `${label}[0]`),
    requireFiniteNumber(position[1], `${label}[1]`),
    requireFiniteNumber(position[2], `${label}[2]`),
  ];
}

function requireFiniteQuat(orientation: Quat): Quat {
  if (!Array.isArray(orientation) || orientation.length !== 4) {
    throw new Error("orientation must be a 4-element quaternion [qx, qy, qz, qw]");
  }
  return [
    requireFiniteNumber(orientation[0], "orientation[0]"),
    requireFiniteNumber(orientation[1], "orientation[1]"),
    requireFiniteNumber(orientation[2], "orientation[2]"),
    requireFiniteNumber(orientation[3], "orientation[3]"),
  ];
}

function requireFiniteYawPose(pose: YawPose): YawPose {
  if (!Array.isArray(pose) || pose.length !== 4) {
    throw new Error("yaw pose must be a 4-element [x, y, z, yaw]");
  }
  return [
    requireFiniteNumber(pose[0], "position[0]"),
    requireFiniteNumber(pose[1], "position[1]"),
    requireFiniteNumber(pose[2], "position[2]"),
    requireFiniteNumber(pose[3], "yaw"),
  ];
}
