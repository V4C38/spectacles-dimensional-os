import type { Vec3 } from "@dimos-ar-client/websocket/protocolTypes";

export const CORNER_FILLET_MAX_M = 0.1;
export const CORNER_FILLET_ANGLE_DEG = 40;
export const CORNER_FILLET_SEGMENTS = 2;

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

export type RouteCircle = { center: Vec3; radius: number };

/** Trim along the actual polyline, including short segments inside either footprint. */
export function clipPathToCircles(points: Vec3[], start?: RouteCircle, end?: RouteCircle): Vec3[] {
  const trim = (path: Vec3[], circle: RouteCircle): Vec3[] => {
    const radius2 = circle.radius * circle.radius;
    if (path.length < 2) return [];
    if ((path[0][0] - circle.center[0]) ** 2 + (path[0][2] - circle.center[2]) ** 2 >= radius2) return path;
    for (let i = 1; i < path.length; i++) {
      const b = path[i];
      if ((b[0] - circle.center[0]) ** 2 + (b[2] - circle.center[2]) ** 2 <= radius2) continue;
      const a = path[i - 1], dx = b[0] - a[0], dz = b[2] - a[2];
      const x = a[0] - circle.center[0], z = a[2] - circle.center[2];
      const aa = dx * dx + dz * dz;
      if (aa < 1e-12) continue;
      const bb = 2 * (x * dx + z * dz), cc = x * x + z * z - radius2;
      const t = Math.max(0, Math.min(1, (-bb + Math.sqrt(Math.max(0, bb * bb - 4 * aa * cc))) / (2 * aa)));
      return [lerpPoint(a, b, t), ...path.slice(i)];
    }
    return [];
  };
  let result = start ? trim(points, start) : points;
  if (end) result = trim([...result].reverse(), end).reverse();
  return result;
}

/** Start the displayed remainder at the robot, without drawing back toward an old path origin. */
export function anchorPathStart(points: Vec3[], center: Vec3): Vec3[] {
  if (points.length < 2) return points.map(point => [...point] as Vec3);
  let bestDistance = Infinity, bestIndex = 0, nearest: Vec3 = points[0];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], dx = b[0] - a[0], dz = b[2] - a[2];
    const length2 = dx * dx + dz * dz;
    const t = length2 > 1e-12 ? Math.max(0, Math.min(1, ((center[0] - a[0]) * dx + (center[2] - a[2]) * dz) / length2)) : 0;
    const point = lerpPoint(a, b, t), distance = (point[0] - center[0]) ** 2 + (point[2] - center[2]) ** 2;
    if (distance <= bestDistance) { bestDistance = distance; bestIndex = i; nearest = point; }
  }
  const result: Vec3[] = [[...center]];
  if (bestDistance > 1e-10) result.push(nearest);
  return [...result, ...points.slice(bestIndex + 1)];
}
