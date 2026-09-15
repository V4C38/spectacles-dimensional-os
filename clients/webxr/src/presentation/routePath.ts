import type { Vec3 } from "@dimos-ar-client/websocket/protocolTypes";

export const CORNER_FILLET_MAX_M = 0.1;
export const CORNER_FILLET_ANGLE_DEG = 40;
export const CORNER_FILLET_SEGMENTS = 2;
export const MAX_LIDAR_POINTS = 4000;

export function filletPathCorners(points: Vec3[]): Vec3[] {
  if (points.length < 3) {
    return points.map((point) => [point[0], point[1], point[2]] as Vec3);
  }
  const filleted: Vec3[] = [[points[0][0], points[0][1], points[0][2]]];
  for (let index = 1; index < points.length - 1; index++) {
    const prev = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    if (cornerTurnAngleDeg(prev, corner, next) < CORNER_FILLET_ANGLE_DEG) {
      filleted.push([corner[0], corner[1], corner[2]]);
      continue;
    }
    const incomingLength = Math.hypot(corner[0] - prev[0], corner[2] - prev[2]);
    const outgoingLength = Math.hypot(next[0] - corner[0], next[2] - corner[2]);
    const filletDistance = Math.min(CORNER_FILLET_MAX_M, incomingLength * 0.45, outgoingLength * 0.45);
    if (filletDistance <= 0.005) {
      filleted.push([corner[0], corner[1], corner[2]]);
      continue;
    }
    const incomingT = filletDistance / incomingLength;
    const outgoingT = filletDistance / outgoingLength;
    const incomingFillet = lerpPoint(corner, prev, incomingT);
    const outgoingFillet = lerpPoint(corner, next, outgoingT);
    filleted.push(incomingFillet);
    for (let segment = 1; segment <= CORNER_FILLET_SEGMENTS; segment++) {
      filleted.push(lerpPoint(incomingFillet, outgoingFillet, segment / (CORNER_FILLET_SEGMENTS + 1)));
    }
    filleted.push(outgoingFillet);
  }
  const last = points[points.length - 1];
  filleted.push([last[0], last[1], last[2]]);
  return filleted;
}

export function rangePathY(points: Vec3[], floorY: number | null, goalY: number | null): Vec3[] {
  if (floorY === null || goalY === null || points.length === 0) {
    return points;
  }
  if (points.length === 1) {
    return [[points[0][0], floorY, points[0][2]]];
  }
  const distances = [0];
  for (let index = 1; index < points.length; index++) {
    const prev = points[index - 1];
    const current = points[index];
    distances.push(
      distances[index - 1] +
        Math.hypot(current[0] - prev[0], current[1] - prev[1], current[2] - prev[2]),
    );
  }
  const total = distances[distances.length - 1];
  if (total <= 0.0001) {
    return points.map((point) => [point[0], floorY, point[2]] as Vec3);
  }
  return points.map((point, index) => {
    const progress = distances[index] / total;
    return [point[0], floorY + (goalY - floorY) * progress, point[2]] as Vec3;
  });
}

function cornerTurnAngleDeg(prev: Vec3, corner: Vec3, next: Vec3): number {
  const inX = prev[0] - corner[0];
  const inZ = prev[2] - corner[2];
  const outX = next[0] - corner[0];
  const outZ = next[2] - corner[2];
  const inLen = Math.hypot(inX, inZ);
  const outLen = Math.hypot(outX, outZ);
  if (inLen < 1e-6 || outLen < 1e-6) {
    return 0;
  }
  const cos = Math.max(-1, Math.min(1, (inX * outX + inZ * outZ) / (inLen * outLen)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function lerpPoint(from: Vec3, toward: Vec3, t: number): Vec3 {
  return [
    from[0] + (toward[0] - from[0]) * t,
    from[1] + (toward[1] - from[1]) * t,
    from[2] + (toward[2] - from[2]) * t,
  ];
}
