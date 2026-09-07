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

export function clientTrackingToOdomYawPose(
  pose: YawPose,
  origin: ClientTrackingOrigin,
): YawPose {
  const applied = applyOriginPose(poseFromYaw(pose), origin);
  return [
    applied.position[0],
    applied.position[1],
    applied.position[2],
    quatYaw(applied.orientation),
  ];
}

function relativePoseInOdom(
  pose: PositionOrientation,
  origin: ClientTrackingOrigin,
): PositionOrientation {
  const qInv = quatConjugate(requireOrigin(origin));
  return {
    position: rotateVecByQuat(qInv, sub(requireVec3(pose.position, "position"), origin.position)),
    orientation: quatMultiply(qInv, normalizeQuat(pose.orientation)),
  };
}

function applyOriginPose(
  pose: PositionOrientation,
  origin: ClientTrackingOrigin,
): PositionOrientation {
  const q = requireOrigin(origin);
  return {
    position: applyOriginPoint(requireVec3(pose.position, "position"), origin),
    orientation: quatMultiply(q, normalizeQuat(pose.orientation)),
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

function requireVec3(value: Vec3, key: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`${key} must be a 3-element array`);
  }
  return [
    requireFinite(value[0], `${key}[0]`),
    requireFinite(value[1], `${key}[1]`),
    requireFinite(value[2], `${key}[2]`),
  ];
}

function requireFinite(value: unknown, key: string): number {
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

export function normalizeQuat(q: Quat): Quat {
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
  return [orientation[0] / length, orientation[1] / length, orientation[2] / length, orientation[3] / length];
}

function quatConjugate(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

function quatMultiply(a: Quat, b: Quat): Quat {
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
