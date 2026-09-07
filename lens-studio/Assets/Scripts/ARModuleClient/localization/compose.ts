import {
  clientToOdomOrientation,
  clientToOdomPosition,
  clientToOdomYawPose,
  odomToClientOrientation,
  odomToClientPosition,
  odomToClientYawPose,
  type CoordinateBasis,
} from "../coordinates/coordinates";
import type { Quat, Vec3, YawPose } from "../websocket/types";
import type { TOdomClient } from "./alignment";

export interface TrackingPose {
  position: Vec3;
  orientation: Quat;
}

export function odomPointToTracking(
  point: Vec3,
  T_odom_client: TOdomClient,
  basis: CoordinateBasis,
): Vec3 {
  return odomToClientPosition(relativePointInOdom(point, T_odom_client), basis);
}

export function trackingPointToOdom(
  point: Vec3,
  T_odom_client: TOdomClient,
  basis: CoordinateBasis,
): Vec3 {
  return applyTOdomClientPoint(clientToOdomPosition(point, basis), T_odom_client);
}

export function odomPoseToTracking(
  pose: TrackingPose,
  T_odom_client: TOdomClient,
  basis: CoordinateBasis,
): TrackingPose {
  const relative = relativePoseInOdom(pose, T_odom_client);
  return {
    position: odomToClientPosition(relative.position, basis),
    orientation: odomToClientOrientation(relative.orientation, basis),
  };
}

export function trackingPoseToOdom(
  pose: TrackingPose,
  T_odom_client: TOdomClient,
  basis: CoordinateBasis,
): TrackingPose {
  return applyTOdomClientPose(
    {
      position: clientToOdomPosition(pose.position, basis),
      orientation: clientToOdomOrientation(pose.orientation, basis),
    },
    T_odom_client,
  );
}

export function odomYawPoseToTracking(
  pose: YawPose,
  T_odom_client: TOdomClient,
  basis: CoordinateBasis,
): YawPose {
  const relative = relativePoseInOdom(poseFromYaw(pose), T_odom_client);
  return odomToClientYawPose(
    [relative.position[0], relative.position[1], relative.position[2], quatYaw(relative.orientation)],
    basis,
  );
}

export function trackingYawPoseToOdom(
  pose: YawPose,
  T_odom_client: TOdomClient,
  basis: CoordinateBasis,
): YawPose {
  const applied = applyTOdomClientPose(poseFromYaw(clientToOdomYawPose(pose, basis)), T_odom_client);
  return [
    applied.position[0],
    applied.position[1],
    applied.position[2],
    quatYaw(applied.orientation),
  ];
}

function relativePoseInOdom(pose: TrackingPose, T_odom_client: TOdomClient): TrackingPose {
  const qInv = quatConjugate(requireTOdomClient(T_odom_client));
  return {
    position: rotateVecByQuat(qInv, sub(requireVec3(pose.position, "position"), T_odom_client.position)),
    orientation: quatMultiply(qInv, normalizeQuat(pose.orientation)),
  };
}

function applyTOdomClientPose(pose: TrackingPose, T_odom_client: TOdomClient): TrackingPose {
  const q = requireTOdomClient(T_odom_client);
  return {
    position: applyTOdomClientPoint(requireVec3(pose.position, "position"), T_odom_client),
    orientation: quatMultiply(q, normalizeQuat(pose.orientation)),
  };
}

function relativePointInOdom(point: Vec3, T_odom_client: TOdomClient): Vec3 {
  const qInv = quatConjugate(requireTOdomClient(T_odom_client));
  return rotateVecByQuat(qInv, sub(requireVec3(point, "position"), T_odom_client.position));
}

function applyTOdomClientPoint(point: Vec3, T_odom_client: TOdomClient): Vec3 {
  const rotated = rotateVecByQuat(requireTOdomClient(T_odom_client), requireVec3(point, "position"));
  return [
    rotated[0] + T_odom_client.position[0],
    rotated[1] + T_odom_client.position[1],
    rotated[2] + T_odom_client.position[2],
  ];
}

function poseFromYaw(pose: YawPose): TrackingPose {
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

function requireTOdomClient(T_odom_client: TOdomClient): Quat {
  requireVec3(T_odom_client.position, "T_odom_client.position");
  return normalizeQuat(T_odom_client.orientation);
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

function normalizeQuat(q: Quat): Quat {
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

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
