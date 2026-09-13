import { normalizeQuat, rotateVecByQuat } from "./clientTrackingTransforms";
import type { CaptureGeometry } from "../websocket/hostPorts";
import type { Quat, Vec3 } from "../websocket/protocolTypes";

export function passesGeometricGate(
  cameraOptical: { position: Vec3; orientation: Quat },
  robotTrackingPosition: Vec3,
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
