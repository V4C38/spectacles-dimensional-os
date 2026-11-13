import type { Quat, Vec3, YawPose } from "DimOSARClient.lspkg/Scripts/DimOSARClient/websocket/protocolTypes";
import { normalizeQuat, requireVec3, requireFinite, applyBasis as apply, transposeBasis as transpose, changeBasisQuat, type Mat3 } from "DimOSARClient.lspkg/Scripts/DimOSARClient/localization/clientTrackingTransforms";

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
