import type { Quat, Vec3, YawPose } from "DimOSARClient.lspkg/Scripts/DimOSARClient/ClientContracts";
import { normalizeQuat, requireVec3, requireFinite, applyBasis as apply, transposeBasis as transpose, changeBasisQuat, quatFromBasis, type Mat3 } from "DimOSARClient.lspkg/Scripts/DimOSARClient/localization/ClientTracking";

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
  readonly position: Readonly<Vec3>;
  readonly orientation: Readonly<Quat>;
};

export function clientTrackingToSpecsPoint(point: Readonly<Vec3>): Vec3 {
  return scale(apply(SPECS_BASIS.P, requireVec3(point, "position")), SPECS_BASIS.metresToCentimetres);
}

export function specsToClientTrackingPoint(point: Readonly<Vec3>): Vec3 {
  return apply(
    transpose(SPECS_BASIS.P),
    scale(requireVec3(point, "position"), 1 / SPECS_BASIS.metresToCentimetres),
  );
}

export function clientTrackingToSpecsQuat(orientation: Readonly<Quat>): Quat {
  return changeBasisQuat(normalizeQuat(orientation), SPECS_BASIS.P);
}

export function specsToClientTrackingQuat(orientation: Readonly<Quat>): Quat {
  return changeBasisQuat(normalizeQuat(orientation), transpose(SPECS_BASIS.P));
}

export function clientTrackingToSpecsPose(pose: PositionOrientation): { position: Vec3; orientation: Quat } {
  return {
    position: clientTrackingToSpecsPoint(pose.position),
    orientation: clientTrackingToSpecsQuat(pose.orientation),
  };
}

export function specsToClientTrackingPose(pose: PositionOrientation): { position: Vec3; orientation: Quat } {
  return {
    position: specsToClientTrackingPoint(pose.position),
    orientation: specsToClientTrackingQuat(pose.orientation),
  };
}

export function clientTrackingToSpecsYawPose(pose: Readonly<YawPose>): YawPose {
  const value = requireYawPose(pose);
  const position = clientTrackingToSpecsPoint([value[0], value[1], value[2]]);
  const forward = apply(SPECS_BASIS.P, [Math.cos(value[3]), Math.sin(value[3]), 0]);
  // A marker's arrow points along local +X. Tracking yaw zero points along
  // Lens -Z, so marker yaw zero and tracking yaw zero differ by 90 degrees.
  return [
    position[0], position[1], position[2], Math.atan2(-forward[2], forward[0]),
  ];
}

export function specsToClientTrackingYawPose(pose: Readonly<YawPose>): YawPose {
  const value = requireYawPose(pose);
  const position = specsToClientTrackingPoint([value[0], value[1], value[2]]);
  const forward = apply(transpose(SPECS_BASIS.P), [Math.cos(value[3]), 0, -Math.sin(value[3])]);
  return [
    position[0], position[1], position[2], Math.atan2(forward[1], forward[0]),
  ];
}

function scale(point: Readonly<Vec3>, factor: number): Vec3 {
  return [point[0] * factor, point[1] * factor, point[2] * factor];
}

function requireYawPose(value: Readonly<YawPose>): YawPose {
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
  const value = quatFromBasis(
    [m.column0.x, m.column0.y, m.column0.z],
    [m.column1.x, m.column1.y, m.column1.z],
    [m.column2.x, m.column2.y, m.column2.z],
  );
  return new quat(value[3], value[0], value[1], value[2]);
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
