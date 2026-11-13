import type { Quat, Vec3, YawPose } from "DimOSARClient.lspkg/Scripts/DimOSARClient/ClientContracts";
import { normalizeQuat, requireVec3, requireFinite, applyBasis as apply, transposeBasis as transpose, changeBasisQuat, type Mat3 } from "DimOSARClient.lspkg/Scripts/DimOSARClient/localization/ClientTracking";

// Lens is right-handed Y-up, with the camera looking along -Z.
// Tracking +X forward, +Y left, +Z up → Lens -Z, -X, +Y (metres → centimetres).
export const SPECS_BASIS = {
  metresToCentimetres: 100,
  P: [
    [0, -1, 0],
    [0, 0, 1],
    [-1, 0, 0],
  ] as Mat3,
};

type PositionOrientation = {
  position: Vec3;
  orientation: Quat;
};

export function clientTrackingToSpecsPoint(point: Vec3): Vec3 {
  return scale(apply(SPECS_BASIS.P, requireVec3(point, "position")), SPECS_BASIS.metresToCentimetres);
}

export function specsToClientTrackingPoint(point: Vec3): Vec3 {
  return apply(
    transpose(SPECS_BASIS.P),
    scale(requireVec3(point, "position"), 1 / SPECS_BASIS.metresToCentimetres),
  );
}

export function clientTrackingToSpecsQuat(orientation: Quat): Quat {
  return changeBasisQuat(normalizeQuat(orientation), SPECS_BASIS.P);
}

export function specsToClientTrackingQuat(orientation: Quat): Quat {
  return changeBasisQuat(normalizeQuat(orientation), transpose(SPECS_BASIS.P));
}

export function clientTrackingToSpecsPose(pose: PositionOrientation): PositionOrientation {
  return {
    position: clientTrackingToSpecsPoint(pose.position),
    orientation: clientTrackingToSpecsQuat(pose.orientation),
  };
}

export function specsToClientTrackingPose(pose: PositionOrientation): PositionOrientation {
  return {
    position: specsToClientTrackingPoint(pose.position),
    orientation: specsToClientTrackingQuat(pose.orientation),
  };
}

export function clientTrackingToSpecsYawPose(pose: YawPose): YawPose {
  const value = requireYawPose(pose);
  const position = clientTrackingToSpecsPoint([value[0], value[1], value[2]]);
  const forward = apply(SPECS_BASIS.P, [Math.cos(value[3]), Math.sin(value[3]), 0]);
  // A marker's arrow points along local +X. Tracking yaw zero points along
  // Lens -Z, so marker yaw zero and tracking yaw zero differ by 90 degrees.
  return [
    position[0], position[1], position[2], Math.atan2(-forward[2], forward[0]),
  ];
}

export function specsToClientTrackingYawPose(pose: YawPose): YawPose {
  const value = requireYawPose(pose);
  const position = specsToClientTrackingPoint([value[0], value[1], value[2]]);
  const forward = apply(transpose(SPECS_BASIS.P), [Math.cos(value[3]), 0, -Math.sin(value[3])]);
  return [
    position[0], position[1], position[2], Math.atan2(forward[1], forward[0]),
  ];
}

function scale(point: Vec3, factor: number): Vec3 {
  return [point[0] * factor, point[1] * factor, point[2] * factor];
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

/**
 * Rotation quaternion from the upper-left 3x3 of a mat4 (columns are basis
 * vectors). Basis is normalized defensively. Shepperd's method.
 * Note: Lens quat constructor is (w, x, y, z).
 */
export function quatFromMat4Rotation(m: mat4): quat {
  const c0 = new vec3(m.column0.x, m.column0.y, m.column0.z).normalize();
  const c1 = new vec3(m.column1.x, m.column1.y, m.column1.z).normalize();
  const c2 = new vec3(m.column2.x, m.column2.y, m.column2.z).normalize();
  // r[row][col]
  const r00 = c0.x, r01 = c1.x, r02 = c2.x;
  const r10 = c0.y, r11 = c1.y, r12 = c2.y;
  const r20 = c0.z, r21 = c1.z, r22 = c2.z;
  const trace = r00 + r11 + r22;
  let w: number, x: number, y: number, z: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1.0) * 2;
    w = 0.25 * s; x = (r21 - r12) / s; y = (r02 - r20) / s; z = (r10 - r01) / s;
  } else if (r00 > r11 && r00 > r22) {
    const s = Math.sqrt(1.0 + r00 - r11 - r22) * 2;
    w = (r21 - r12) / s; x = 0.25 * s; y = (r01 + r10) / s; z = (r02 + r20) / s;
  } else if (r11 > r22) {
    const s = Math.sqrt(1.0 + r11 - r00 - r22) * 2;
    w = (r02 - r20) / s; x = (r01 + r10) / s; y = 0.25 * s; z = (r12 + r21) / s;
  } else {
    const s = Math.sqrt(1.0 + r22 - r00 - r11) * 2;
    w = (r10 - r01) / s; x = (r02 + r20) / s; y = (r12 + r21) / s; z = 0.25 * s;
  }
  const result = new quat(w, x, y, z);
  result.normalize();
  return result;
}

/** Yaw-only heading from planar direction (shared by nav marker and placement drag). */
export function yawRotationFromPlanarDirection(x: number, z: number): quat {
  const yaw = Math.atan2(-z, x);
  const halfYaw = yaw * 0.5;
  // Lens Studio quat constructor is (w, x, y, z); Y-axis yaw = (cos, 0, sin, 0)
  return new quat(Math.cos(halfYaw), 0, Math.sin(halfYaw), 0);
}

/** Extract ground yaw from semantic +X forward, matching drag and ARModule conventions. */
export function yawRotationFromWorldRotation(rotation: quat): quat {
  const forward = rotation.multiplyVec3(new vec3(1, 0, 0));
  const planarLength = Math.sqrt(forward.x * forward.x + forward.z * forward.z);
  if (planarLength <= 1e-6) {
    return quat.quatIdentity();
  }
  return yawRotationFromPlanarDirection(forward.x, forward.z);
}
