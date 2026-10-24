import type { Vec3 } from "@dimos-ar-client/websocket/protocolTypes";

export const GROUND_NORMAL_MIN_Y = Math.cos((20 * Math.PI) / 180);
export const DEADZONE_EXIT_MARGIN_M = 0.12;
export const RAY_LENGTH_M = 20;
export const FLOOR_AIM_RANGE_M = 5;

export type RobotGroundDeadzone = {
  radiusM: number;
  getRobotWorldPosition: () => Vec3 | null;
  getRobotFloorWorldY: () => number | null;
};

export type MeshBlockReason = "none" | "wall" | "unscanned";

export type MeshHit = { position: Vec3; normal: Vec3; label?: string };

export type MeshPlacementResult = {
  status: "ok" | "blocked";
  blockReason: MeshBlockReason;
  probePosition: Vec3;
  goalPosition: Vec3 | null;
  wasInsideDeadzone: boolean;
};

export type SolveMeshPlacementArgs = {
  rayFrom: Vec3;
  rayTo: Vec3;
  hits: MeshHit[];
  deadzone: RobotGroundDeadzone | null;
  wasInsideDeadzone: boolean;
  fallbackY: number;
};

export function isGroundNormal(normal: Vec3): boolean {
  const length = Math.hypot(normal[0], normal[1], normal[2]);
  if (length <= 0.0001) {
    return false;
  }
  return normal[1] / length >= GROUND_NORMAL_MIN_Y;
}

export function isInsideRobotDeadzone(
  point: Vec3,
  deadzone: RobotGroundDeadzone | null,
  wasInside: boolean,
  exitMarginM: number = DEADZONE_EXIT_MARGIN_M,
): boolean {
  if (!deadzone || !(deadzone.radiusM > 0)) {
    return false;
  }
  const robotPosition = deadzone.getRobotWorldPosition();
  if (!robotPosition) {
    return false;
  }
  const threshold = wasInside ? deadzone.radiusM + exitMarginM : deadzone.radiusM;
  return horizontalDistanceXZ(point, robotPosition) < threshold;
}

export function solveMeshPlacement(args: SolveMeshPlacementArgs): MeshPlacementResult {
  const point = pinchPlanarPoint(args.rayFrom, args.rayTo, args.fallbackY);
  const hit = args.hits[0];
  const floorY = args.deadzone?.getRobotFloorWorldY() ?? args.fallbackY;
  const valid = hit
    ? pointIsOnRay(hit.position, args.rayFrom, args.rayTo) && isGroundNormal(hit.normal) && (hit.label === "floor" ||
        (!hit.label && Math.abs(hit.position[1] - floorY) <= FLOOR_HEIGHT_TOLERANCE_M))
    : args.rayTo[1] < args.rayFrom[1] && pointIsOnRay(point, args.rayFrom, args.rayTo);
  const position = hit?.position ?? point;
  return {
    status: valid ? "ok" : "blocked",
    blockReason: valid ? "none" : hit?.label === "unscanned" ? "unscanned" : "wall",
    probePosition: position,
    goalPosition: valid ? position : null,
    wasInsideDeadzone: isInsideRobotDeadzone(position, args.deadzone, args.wasInsideDeadzone),
  };
}

export const FLOOR_HEIGHT_TOLERANCE_M = 0.18;

function pointIsOnRay(point: Vec3, from: Vec3, to: Vec3): boolean {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  return Math.hypot(point[0] - from[0], point[1] - from[1], point[2] - from[2]) <= length;
}

export type FloorPlane = { position: Vec3; normal: Vec3; polygon?: Vec3[]; label?: string };

export function isFloorSurface(plane: FloorPlane, floorY: number): boolean {
  return isGroundNormal(plane.normal) && (plane.label === "floor" ||
    (!plane.label && Math.abs(plane.position[1] - floorY) <= FLOOR_HEIGHT_TOLERANCE_M));
}

/** Polygons are finite. Every detected non-floor surface still blocks a ray. */
export function navigationSurfaceHits(from: Vec3, dir: Vec3, planes: readonly FloorPlane[], floorY: number): MeshHit[] {
  const hasFloor = planes.some(plane => isFloorSurface(plane, floorY));
  const hit = intersectRayPlanes(from, dir, planes);
  const fallback = intersectRayPlanes(from, dir, [{ position: [0, floorY, 0], normal: [0, 1, 0] }]);
  if (hit && (!fallback || hasFloor || distanceSquared(from, hit.position) <= distanceSquared(from, fallback.position))) return [hit];
  if (!hasFloor) return fallback ? [fallback] : [];
  return [{ position: fallback?.position ?? from, normal: [0, 0, 0], label: "unscanned" }];
}

function distanceSquared(a: Vec3, b: Vec3): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

function insidePolygon(point: Vec3, polygon: Vec3[], normal: Vec3): boolean {
  // Project onto the dominant plane, so vertical walls work as well as floors.
  const drop = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
  const axes = [0, 1, 2].filter(axis => axis !== drop);
  const [u, v] = axes;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[v] > point[v]) !== (b[v] > point[v]) &&
        point[u] < (b[u] - a[u]) * (point[v] - a[v]) / (b[v] - a[v]) + a[u]) inside = !inside;
  }
  return inside;
}

export function intersectRayPlanes(
  rayFrom: Vec3,
  rayDir: Vec3,
  planes: readonly FloorPlane[],
): MeshHit | null {
  const dir = normalizeVec3(rayDir);
  if (!dir) {
    return null;
  }
  let bestT = Number.POSITIVE_INFINITY;
  let best: MeshHit | null = null;
  for (const plane of planes) {
    const normal = normalizeVec3(plane.normal);
    if (!normal) {
      continue;
    }
    const denom = normal[0] * dir[0] + normal[1] * dir[1] + normal[2] * dir[2];
    if (Math.abs(denom) <= 0.0001) {
      continue;
    }
    const t =
      (normal[0] * (plane.position[0] - rayFrom[0]) +
        normal[1] * (plane.position[1] - rayFrom[1]) +
        normal[2] * (plane.position[2] - rayFrom[2])) /
      denom;
    if (t < 0 || t > RAY_LENGTH_M || t >= bestT) {
      continue;
    }
    const position: Vec3 = [rayFrom[0] + dir[0] * t, rayFrom[1] + dir[1] * t, rayFrom[2] + dir[2] * t];
    if (plane.polygon && !insidePolygon(position, plane.polygon, normal)) continue;
    bestT = t;
    best = {
      position: [rayFrom[0] + dir[0] * t, rayFrom[1] + dir[1] * t, rayFrom[2] + dir[2] * t],
      normal,
      ...(plane.label ? { label: plane.label } : {}),
    };
  }
  return best;
}

export function planeNormalFromPose(orientation: [number, number, number, number]): Vec3 {
  const [x, y, z, w] = orientation;
  return [
    2 * (x * y - z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z + x * w),
  ];
}

function horizontalDistanceXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

function normalizeVec3(value: Vec3): Vec3 | null {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length <= 0.0001) {
    return null;
  }
  return [value[0] / length, value[1] / length, value[2] / length];
}

function pinchPlanarPoint(rayFrom: Vec3, rayTo: Vec3, planeY: number): Vec3 {
  const delta: Vec3 = [rayTo[0] - rayFrom[0], rayTo[1] - rayFrom[1], rayTo[2] - rayFrom[2]];
  const direction = normalizeVec3(delta);
  if (!direction) {
    return [rayFrom[0], planeY, rayFrom[2]];
  }
  if (Math.abs(direction[1]) <= 0.0001) {
    const horizontalLength = Math.hypot(delta[0], delta[2]);
    if (horizontalLength <= 0.0001) {
      return [rayFrom[0], planeY, rayFrom[2]];
    }
    const travel = Math.min(horizontalLength, RAY_LENGTH_M);
    return [rayFrom[0] + direction[0] * travel, planeY, rayFrom[2] + direction[2] * travel];
  }
  const distanceAlongRay = (planeY - rayFrom[1]) / direction[1];
  if (distanceAlongRay < 0) {
    return [rayTo[0], planeY, rayTo[2]];
  }
  return [
    rayFrom[0] + direction[0] * distanceAlongRay,
    planeY,
    rayFrom[2] + direction[2] * distanceAlongRay,
  ];
}
