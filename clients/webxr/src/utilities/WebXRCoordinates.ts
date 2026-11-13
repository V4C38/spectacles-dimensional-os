import type { Quat, Vec3 } from "@dimos-ar-client/websocket/protocolTypes";
import { normalizeQuat, rotateVecByQuat, requireVec3, applyBasis as apply, transposeBasis as transpose, changeBasisQuat, remapPoseQuat, type Mat3 } from "@dimos-ar-client/localization/clientTrackingTransforms";

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

export function webxrToClientTrackingPoint(point: Vec3): Vec3 {
  return apply(WEBXR_BASIS.P, requireVec3(point, "position"));
}

export function clientTrackingToWebxrPoint(point: Vec3): Vec3 {
  return apply(transpose(WEBXR_BASIS.P), requireVec3(point, "position"));
}

export function webxrToClientTrackingQuat(orientation: Quat): Quat {
  return changeBasisQuat(normalizeQuat(orientation), WEBXR_BASIS.P);
}

export function clientTrackingToWebxrQuat(orientation: Quat): Quat {
  return changeBasisQuat(normalizeQuat(orientation), transpose(WEBXR_BASIS.P));
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

// Optical local axes are fixed (+X right, +Y down, +Z forward).
// Only the world basis changes: P R, never P R P^-1.
export function webxrOpticalToClientTrackingPose(pose: PositionOrientation): PositionOrientation {
  return {
    position: webxrToClientTrackingPoint(pose.position),
    orientation: remapPoseQuat(normalizeQuat(pose.orientation), WEBXR_BASIS.P),
  };
}

export function webxrHeadingToClientTrackingPose(pose: PositionOrientation): PositionOrientation {
  const direction = webxrToClientTrackingPoint(rotateVecByQuat(pose.orientation, [0, 0, -1]));
  const yaw = Math.atan2(direction[1], direction[0]);
  return {
    position: webxrToClientTrackingPoint(pose.position),
    orientation: [0, 0, Math.sin(yaw / 2), Math.cos(yaw / 2)],
  };
}
