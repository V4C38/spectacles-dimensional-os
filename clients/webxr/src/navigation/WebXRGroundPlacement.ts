import type { Vec3 } from "@dimos-ar-client/websocket/protocolTypes";

export const GROUND_NORMAL_MIN_Y = Math.cos((65 * Math.PI) / 180);
export const DEADZONE_EXIT_MARGIN_M = 0.12;
export const RAY_LENGTH_M = 20;

export type RobotGroundDeadzone = {
  radiusM: number;
  getRobotWorldPosition: () => Vec3 | null;
  getRobotFloorWorldY: () => number | null;
};

export type MeshBlockReason = "none" | "wall" | "unscanned";

export type MeshHit = { position: Vec3; normal: Vec3 };

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
  const planarPoint = pinchPlanarPoint(args.rayFrom, args.rayTo, args.fallbackY);
  const fallback = buildRayFallbackPoint(args.rayFrom, args.rayTo, args.fallbackY);
  const insideDeadzone = isInsideRobotDeadzone(planarPoint, args.deadzone, args.wasInsideDeadzone);
  const meshHit = args.hits.length > 0 ? args.hits[0] : null;
  const meshGroundGoal =
    meshHit && isGroundNormal(meshHit.normal)
      ? ([meshHit.position[0], meshHit.position[1], meshHit.position[2]] as Vec3)
      : null;

  if (insideDeadzone && args.deadzone) {
    const robotGoalY = args.deadzone.getRobotFloorWorldY() ?? args.fallbackY;
    const goalY =
      meshGroundGoal !== null
        ? blendDeadzoneMeshGoalY(
            planarPoint,
            args.deadzone,
            args.wasInsideDeadzone,
            robotGoalY,
            meshGroundGoal[1],
          )
        : robotGoalY;
    const position: Vec3 = [planarPoint[0], goalY, planarPoint[2]];
    return {
      status: "ok",
      blockReason: "none",
      probePosition: position,
      goalPosition: position,
      wasInsideDeadzone: true,
    };
  }

  if (args.hits.length === 0) {
    return {
      status: "blocked",
      blockReason: "unscanned",
      probePosition: fallback,
      goalPosition: null,
      wasInsideDeadzone: false,
    };
  }

  const firstHit = args.hits[0];
  if (isGroundNormal(firstHit.normal)) {
    let goalY = firstHit.position[1];
    if (args.deadzone?.getRobotWorldPosition()) {
      const robotGoalY = args.deadzone.getRobotFloorWorldY() ?? args.fallbackY;
      goalY = blendDeadzoneMeshGoalY(
        planarPoint,
        args.deadzone,
        args.wasInsideDeadzone,
        robotGoalY,
        goalY,
      );
    }
    const goal: Vec3 = [firstHit.position[0], goalY, firstHit.position[2]];
    return {
      status: "ok",
      blockReason: "none",
      probePosition: goal,
      goalPosition: goal,
      wasInsideDeadzone: false,
    };
  }

  return {
    status: "blocked",
    blockReason: "wall",
    probePosition: [firstHit.position[0], firstHit.position[1], firstHit.position[2]],
    goalPosition: null,
    wasInsideDeadzone: false,
  };
}

export type FloorPlane = { position: Vec3; normal: Vec3 };

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
    bestT = t;
    best = {
      position: [rayFrom[0] + dir[0] * t, rayFrom[1] + dir[1] * t, rayFrom[2] + dir[2] * t],
      normal,
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

function buildRayFallbackPoint(rayFrom: Vec3, rayTo: Vec3, fallbackY: number): Vec3 {
  const direction = normalizeVec3([rayTo[0] - rayFrom[0], rayTo[1] - rayFrom[1], rayTo[2] - rayFrom[2]]);
  if (!direction) {
    return [rayFrom[0], fallbackY, rayFrom[2]];
  }
  return [rayFrom[0] + direction[0] * RAY_LENGTH_M, fallbackY, rayFrom[2] + direction[2] * RAY_LENGTH_M];
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
    return buildRayFallbackPoint(rayFrom, rayTo, planeY);
  }
  return [
    rayFrom[0] + direction[0] * distanceAlongRay,
    planeY,
    rayFrom[2] + direction[2] * distanceAlongRay,
  ];
}

function blendDeadzoneMeshGoalY(
  planarPoint: Vec3,
  deadzone: RobotGroundDeadzone,
  wasInsideDeadzone: boolean,
  robotGoalY: number,
  meshGoalY: number,
): number {
  const robotPosition = deadzone.getRobotWorldPosition();
  if (!robotPosition || !(deadzone.radiusM > 0)) {
    return meshGoalY;
  }
  const dist = horizontalDistanceXZ(planarPoint, robotPosition);
  const blendStart = deadzone.radiusM * 0.65;
  const blendEnd = wasInsideDeadzone ? deadzone.radiusM + DEADZONE_EXIT_MARGIN_M : deadzone.radiusM;
  if (dist <= blendStart) {
    return robotGoalY;
  }
  if (dist >= blendEnd) {
    return meshGoalY;
  }
  const t = smoothstep01((dist - blendStart) / (blendEnd - blendStart));
  return robotGoalY + (meshGoalY - robotGoalY) * t;
}

function smoothstep01(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}
