// Pure presentation geometry in metres with world Y up; both hosts adapt their coordinates at the boundary.
import type { ReadonlyFacts, Vec3 } from "../ClientContracts";

export const CORNER_FILLET_MAX_M = 0.1;
export const CORNER_FILLET_ANGLE_DEG = 40;
export const CORNER_FILLET_SEGMENTS = 2;

export function filletPathCorners(points: readonly Readonly<Vec3>[]): Vec3[] {
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

export function rangePathY(points: readonly Readonly<Vec3>[], floorY: number | null, goalY: number | null): Vec3[] {
  if (floorY === null || goalY === null || points.length === 0) {
    return points.map(point => [...point] as Vec3);
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

function cornerTurnAngleDeg(prev: Readonly<Vec3>, corner: Readonly<Vec3>, next: Readonly<Vec3>): number {
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

function lerpPoint(from: Readonly<Vec3>, toward: Readonly<Vec3>, t: number): Vec3 {
  return [
    from[0] + (toward[0] - from[0]) * t,
    from[1] + (toward[1] - from[1]) * t,
    from[2] + (toward[2] - from[2]) * t,
  ];
}

export type RouteCircle = { center: Vec3; radius: number };

/** Trim along the actual polyline, including short segments inside either footprint. */
export function clipPathToCircles(
  points: readonly Readonly<Vec3>[],
  start?: ReadonlyFacts<RouteCircle>,
  end?: ReadonlyFacts<RouteCircle>,
): Vec3[] {
  const copied = points.map(point => [...point] as Vec3);
  let result = start ? trimPathStart(copied, start) : copied;
  if (end) result = trimPathStart([...result].reverse(), end).reverse();
  return result;
}

function trimPathStart(path: Vec3[], circle: ReadonlyFacts<RouteCircle>): Vec3[] {
  const radiusSquared = circle.radius * circle.radius;
  if (path.length < 2) return [];
  const distanceSquared = (point: Readonly<Vec3>) =>
    (point[0] - circle.center[0]) ** 2 + (point[2] - circle.center[2]) ** 2;
  if (distanceSquared(path[0]) >= radiusSquared) return path;
  for (let index = 1; index < path.length; index++) {
    const end = path[index];
    if (distanceSquared(end) <= radiusSquared) continue;
    const start = path[index - 1];
    const dx = end[0] - start[0], dz = end[2] - start[2];
    const x = start[0] - circle.center[0], z = start[2] - circle.center[2];
    const a = dx * dx + dz * dz;
    if (a < 1e-12) continue;
    const b = 2 * (x * dx + z * dz), c = x * x + z * z - radiusSquared;
    const intersection = (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a);
    const progress = Math.max(0, Math.min(1, intersection));
    return [lerpPoint(start, end, progress), ...path.slice(index)];
  }
  return [];
}

/** Start the displayed remainder at the robot, without drawing back toward an old path origin. */
export function anchorPathStart(points: readonly Readonly<Vec3>[], center: Readonly<Vec3>): Vec3[] {
  if (points.length < 2) return points.map(point => [...point] as Vec3);
  let bestDistance = Infinity;
  let bestIndex = 0;
  let nearest: Readonly<Vec3> = points[0];
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index], end = points[index + 1];
    const dx = end[0] - start[0], dz = end[2] - start[2];
    const lengthSquared = dx * dx + dz * dz;
    const projection = ((center[0] - start[0]) * dx + (center[2] - start[2]) * dz) / lengthSquared;
    const progress = lengthSquared > 1e-12 ? Math.max(0, Math.min(1, projection)) : 0;
    const point = lerpPoint(start, end, progress);
    const distance = (point[0] - center[0]) ** 2 + (point[2] - center[2]) ** 2;
    if (distance <= bestDistance) {
      bestDistance = distance;
      bestIndex = index;
      nearest = point;
    }
  }
  const result: Vec3[] = [[...center]];
  if (bestDistance > 1e-10) result.push([...nearest]);
  return [...result, ...points.slice(bestIndex + 1).map(point => [...point] as Vec3)];
}

/** A shared-vertex ribbon: adjacent route segments cannot accumulate alpha at their joins. */
export function routeRibbon(
  points: readonly Readonly<Vec3>[],
  width: number,
): { positions: number[]; indices: number[] } {
  const path = points.filter((point, index) => index === 0 ||
    Math.hypot(point[0] - points[index - 1][0], point[2] - points[index - 1][2]) > 1e-6);
  if (path.length < 2) return { positions: [], indices: [] };
  const positions: number[] = [], indices: number[] = [];
  const normal = (start: Readonly<Vec3>, end: Readonly<Vec3>): [number, number] => {
    const length = Math.hypot(end[0] - start[0], end[2] - start[2]);
    return [-(end[2] - start[2]) / length, (end[0] - start[0]) / length];
  };
  for (let index = 0; index < path.length; index++) {
    const incoming = normal(path[Math.max(0, index - 1)], path[Math.max(1, index)]);
    const outgoing = normal(path[Math.min(index, path.length - 2)], path[Math.min(index + 1, path.length - 1)]);
    let nx = incoming[0] + outgoing[0], nz = incoming[1] + outgoing[1];
    const length = Math.hypot(nx, nz);
    if (length < 1e-6) {
      nx = outgoing[0];
      nz = outgoing[1];
    } else {
      nx /= length;
      nz /= length;
    }
    const miter = width / 2 / Math.max(0.5, nx * outgoing[0] + nz * outgoing[1]);
    const point = path[index];
    positions.push(
      point[0] + nx * miter, point[1], point[2] + nz * miter,
      point[0] - nx * miter, point[1], point[2] - nz * miter,
    );
    if (index > 0) {
      const vertex = index * 2;
      indices.push(vertex - 2, vertex - 1, vertex, vertex - 1, vertex + 1, vertex);
    }
  }
  // End-cap fans occupy only the outer half-disc, sharing the ribbon's boundary.
  for (const end of [false, true]) {
    const index = end ? path.length - 1 : 0;
    const point = path[index];
    const direction = normal(path[end ? index - 1 : 0], path[end ? index : 1]);
    const angle = Math.atan2(direction[1], direction[0]);
    const center = positions.length / 3;
    positions.push(...point);
    for (let segment = 0; segment <= 12; segment++) {
      const theta = angle + (end ? -1 : 1) * Math.PI * segment / 12;
      positions.push(
        point[0] + Math.cos(theta) * width / 2, point[1],
        point[2] + Math.sin(theta) * width / 2,
      );
      if (segment > 0) indices.push(center, center + segment, center + segment + 1);
    }
  }
  return { positions, indices };
}


export interface RoutePathOptions {
  readonly floorY: number | null;
  readonly goalY: number | null;
  readonly startCircle?: ReadonlyFacts<RouteCircle>;
  readonly endCircle?: ReadonlyFacts<RouteCircle>;
  readonly solid?: boolean;
  readonly widthM: number;
}

/** Shared route policy after the host converts points and footprints to Y-up metres. */
export function prepareRoutePath(
  points: readonly Readonly<Vec3>[],
  options: RoutePathOptions,
): { readonly points: readonly Readonly<Vec3>[]; readonly lengthM: number } {
  let path = points.map(point => [...point] as Vec3);
  if (options.startCircle) path = anchorPathStart(path, options.startCircle.center);
  if (options.endCircle && path.length) path[path.length - 1] = [...options.endCircle.center];
  const clearance = (circle?: ReadonlyFacts<RouteCircle>): ReadonlyFacts<RouteCircle> | undefined =>
    circle && { ...circle, radius: circle.radius + (options.solid ? options.widthM / 2 : 0) };
  path = rangePathY(
    clipPathToCircles(filletPathCorners(path), clearance(options.startCircle), clearance(options.endCircle)),
    options.startCircle?.center[1] ?? options.floorY,
    options.endCircle?.center[1] ?? options.goalY,
  );
  let lengthM = 0;
  for (let index = 1; index < path.length; index++) {
    const previous = path[index - 1], point = path[index];
    lengthM += Math.hypot(point[0] - previous[0], point[1] - previous[1], point[2] - previous[2]);
  }
  return { points: path, lengthM };
}
