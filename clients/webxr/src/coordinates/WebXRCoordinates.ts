import type { Quat, Vec3, YawPose } from "@dimos-ar-client/websocket/protocolTypes";
import { normalizeQuat, rotateVecByQuat } from "@dimos-ar-client/localization/clientTrackingTransforms";

type Mat3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

type PositionOrientation = {
  position: Vec3;
  orientation: Quat;
};

// Three.js / WebXR: right-handed Y-up, X right, -Z forward.
// Protocol client tracking / odom: right-handed Z-up, X forward, Y left.
export const WEBXR_BASIS = {
  P: [
    [0, 0, -1],
    [-1, 0, 0],
    [0, 1, 0],
  ] as Mat3,
};

// Three.js camera (+X right, +Y up, +Z back) → optical (+X right, +Y down, +Z forward).
const OPTICAL_FROM_THREE: Quat = [1, 0, 0, 0];

export function webxrToClientTrackingPoint(point: Vec3): Vec3 {
  return apply(WEBXR_BASIS.P, requireVec3(point, "position"));
}

export function clientTrackingToWebxrPoint(point: Vec3): Vec3 {
  return apply(transpose(WEBXR_BASIS.P), requireVec3(point, "position"));
}

export function webxrToClientTrackingQuat(orientation: Quat): Quat {
  return remapPoseQuat(normalizeQuat(orientation), WEBXR_BASIS.P);
}

export function clientTrackingToWebxrQuat(orientation: Quat): Quat {
  return remapPoseQuat(normalizeQuat(orientation), transpose(WEBXR_BASIS.P));
}

export function webxrToClientTrackingPose(pose: PositionOrientation): PositionOrientation {
  return {
    position: webxrToClientTrackingPoint(pose.position),
    orientation: webxrToClientTrackingQuat(pose.orientation),
  };
}

export function clientTrackingToWebxrPose(pose: PositionOrientation): PositionOrientation {
  return {
    position: clientTrackingToWebxrPoint(pose.position),
    orientation: clientTrackingToWebxrQuat(pose.orientation),
  };
}

export function webxrCameraToOpticalPose(pose: PositionOrientation): PositionOrientation {
  return webxrToClientTrackingPose({
    position: pose.position,
    orientation: quatMultiply(normalizeQuat(pose.orientation), OPTICAL_FROM_THREE),
  });
}

export function clientTrackingToWebxrYawPose(pose: YawPose): YawPose {
  const converted = clientTrackingToWebxrPose(poseFromTrackingYaw(pose));
  return [
    converted.position[0],
    converted.position[1],
    converted.position[2],
    webxrYaw(converted.orientation),
  ];
}

export function webxrToClientTrackingYawPose(pose: YawPose): YawPose {
  const converted = webxrToClientTrackingPose(poseFromWebxrYaw(pose));
  return [
    converted.position[0],
    converted.position[1],
    converted.position[2],
    trackingYaw(converted.orientation),
  ];
}

function poseFromTrackingYaw(pose: YawPose): PositionOrientation {
  const yawPose = requireYawPose(pose);
  return {
    position: [yawPose[0], yawPose[1], yawPose[2]],
    orientation: [0, 0, Math.sin(yawPose[3] * 0.5), Math.cos(yawPose[3] * 0.5)],
  };
}

function poseFromWebxrYaw(pose: YawPose): PositionOrientation {
  const yawPose = requireYawPose(pose);
  return {
    position: [yawPose[0], yawPose[1], yawPose[2]],
    orientation: [0, Math.sin(yawPose[3] * 0.5), 0, Math.cos(yawPose[3] * 0.5)],
  };
}

function trackingYaw(orientation: Quat): number {
  const forward = rotateVecByQuat(normalizeQuat(orientation), [1, 0, 0]);
  const length = Math.hypot(forward[0], forward[1]);
  if (length < 1e-6) {
    throw new Error("degenerate yaw geometry");
  }
  return Math.atan2(forward[1], forward[0]);
}

function webxrYaw(orientation: Quat): number {
  const forward = rotateVecByQuat(normalizeQuat(orientation), [0, 0, -1]);
  const length = Math.hypot(forward[0], forward[2]);
  if (length < 1e-6) {
    throw new Error("degenerate yaw geometry");
  }
  return Math.atan2(forward[0], -forward[2]);
}

function remapPoseQuat(orientation: Quat, forward: Mat3): Quat {
  const x = apply(forward, rotateVecByQuat(orientation, [1, 0, 0]));
  const y = apply(forward, rotateVecByQuat(orientation, [0, 1, 0]));
  const z = apply(forward, rotateVecByQuat(orientation, [0, 0, 1]));
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

function quatMultiply(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function apply(matrix: Mat3, point: Vec3): Vec3 {
  return [
    matrix[0][0] * point[0] + matrix[0][1] * point[1] + matrix[0][2] * point[2],
    matrix[1][0] * point[0] + matrix[1][1] * point[1] + matrix[1][2] * point[2],
    matrix[2][0] * point[0] + matrix[2][1] * point[1] + matrix[2][2] * point[2],
  ];
}

function transpose(matrix: Mat3): Mat3 {
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

function requireYawPose(value: YawPose): YawPose {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error("yaw pose must be a 4-element [x, y, z, yaw]");
  }
  return [
    requireFinite(value[0], "position[0]"),
    requireFinite(value[1], "position[1]"),
    requireFinite(value[2], "position[2]"),
    requireFinite(value[3], "yaw"),
  ];
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
