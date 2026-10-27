export const GROUND_NORMAL_MIN_Y = Math.cos((65 * Math.PI) / 180);
export const DEADZONE_EXIT_MARGIN_CM = 12;
export const PINCH_RAY_LENGTH_CM = 2000;

export type RobotGroundDeadzone = {
  radiusCm: number;
  getRobotWorldPosition: () => vec3 | null;
  getRobotFloorWorldY: () => number | null;
};

export type MeshBlockReason = "none" | "wall" | "unscanned";

export type MeshHit = { position: vec3; normal: vec3 };

export type MeshPlacementResult = {
  status: "ok" | "blocked";
  blockReason: MeshBlockReason;
  probePosition: vec3;
  goalPosition: vec3 | null;
  wasInsideDeadzone: boolean;
};

export type SolveMeshPlacementArgs = {
  rayFrom: vec3;
  rayTo: vec3;
  hits: MeshHit[];
  deadzone: RobotGroundDeadzone | null;
  wasInsideDeadzone: boolean;
  fallbackY: number;
};

export const FOLLOW_FLOOR_POSITION_EPSILON_CM = 0.25;
export const FOLLOW_FLOOR_ROTATION_EPSILON_RAD = 0.01;

export function shouldSyncFollowFloorPose(
  current: { position: vec3; rotation: quat },
  next: { position: vec3; rotation: quat },
): boolean {
  return (
    poseDistanceCm(current.position, next.position) > FOLLOW_FLOOR_POSITION_EPSILON_CM ||
    quat.angleBetween(current.rotation, next.rotation) > FOLLOW_FLOOR_ROTATION_EPSILON_RAD
  );
}

export function isGroundNormal(normal: vec3): boolean {
  const length = Math.sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z);
  if (length <= 0.0001) {
    return false;
  }
  return normal.y / length >= GROUND_NORMAL_MIN_Y;
}

export function isInsideRobotDeadzone(
  point: vec3,
  deadzone: RobotGroundDeadzone | null,
  wasInside: boolean,
  exitMarginCm: number = DEADZONE_EXIT_MARGIN_CM,
): boolean {
  if (!deadzone || !(deadzone.radiusCm > 0)) {
    return false;
  }
  const robotPosition = deadzone.getRobotWorldPosition();
  if (!robotPosition) {
    return false;
  }
  const threshold = wasInside ? deadzone.radiusCm + exitMarginCm : deadzone.radiusCm;
  return horizontalDistanceXZ(point, robotPosition) < threshold;
}

export function solveMeshPlacement(args: SolveMeshPlacementArgs): MeshPlacementResult {
  const planarPoint = pinchPlanarPoint(args.rayFrom, args.rayTo, args.fallbackY);
  const fallback = buildPinchFallbackPoint(args.rayFrom, args.rayTo, args.fallbackY);
  const insideDeadzone = isInsideRobotDeadzone(planarPoint, args.deadzone, args.wasInsideDeadzone);
  const meshHit = args.hits.length > 0 ? args.hits[0] : null;
  const meshGroundGoal =
    meshHit && isGroundNormal(meshHit.normal)
      ? new vec3(meshHit.position.x, meshHit.position.y, meshHit.position.z)
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
            meshGroundGoal.y,
          )
        : robotGoalY;
    const position = new vec3(planarPoint.x, goalY, planarPoint.z);
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
    let goalY = firstHit.position.y;
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
    const goal = new vec3(firstHit.position.x, goalY, firstHit.position.z);
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
    probePosition: new vec3(firstHit.position.x, firstHit.position.y, firstHit.position.z),
    goalPosition: null,
    wasInsideDeadzone: false,
  };
}

function poseDistanceCm(a: vec3, b: vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function horizontalDistanceXZ(a: vec3, b: vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function normalizeVec3(value: vec3): vec3 | null {
  const length = Math.sqrt(value.x * value.x + value.y * value.y + value.z * value.z);
  if (length <= 0.0001) {
    return null;
  }
  return new vec3(value.x / length, value.y / length, value.z / length);
}

function subtractVec3(a: vec3, b: vec3): vec3 {
  return new vec3(a.x - b.x, a.y - b.y, a.z - b.z);
}

function buildPinchFallbackPoint(rayFrom: vec3, rayTo: vec3, fallbackY: number): vec3 {
  const direction = normalizeVec3(subtractVec3(rayTo, rayFrom));
  if (!direction) {
    return new vec3(rayFrom.x, fallbackY, rayFrom.z);
  }
  return new vec3(
    rayFrom.x + direction.x * PINCH_RAY_LENGTH_CM,
    fallbackY,
    rayFrom.z + direction.z * PINCH_RAY_LENGTH_CM,
  );
}

function pinchPlanarPoint(rayFrom: vec3, rayTo: vec3, planeY: number): vec3 {
  const delta = subtractVec3(rayTo, rayFrom);
  const direction = normalizeVec3(delta);
  if (!direction) {
    return new vec3(rayFrom.x, planeY, rayFrom.z);
  }
  if (Math.abs(direction.y) <= 0.0001) {
    const horizontalLength = Math.sqrt(delta.x * delta.x + delta.z * delta.z);
    if (horizontalLength <= 0.0001) {
      return new vec3(rayFrom.x, planeY, rayFrom.z);
    }
    const travel = Math.min(horizontalLength, PINCH_RAY_LENGTH_CM);
    return new vec3(
      rayFrom.x + direction.x * travel,
      planeY,
      rayFrom.z + direction.z * travel,
    );
  }
  const distanceAlongRay = (planeY - rayFrom.y) / direction.y;
  if (distanceAlongRay < 0) {
    return buildPinchFallbackPoint(rayFrom, rayTo, planeY);
  }
  return new vec3(
    rayFrom.x + direction.x * distanceAlongRay,
    planeY,
    rayFrom.z + direction.z * distanceAlongRay,
  );
}

function blendDeadzoneMeshGoalY(
  planarPoint: vec3,
  deadzone: RobotGroundDeadzone,
  wasInsideDeadzone: boolean,
  robotGoalY: number,
  meshGoalY: number,
): number {
  const robotPosition = deadzone.getRobotWorldPosition();
  if (!robotPosition || !(deadzone.radiusCm > 0)) {
    return meshGoalY;
  }
  const dist = horizontalDistanceXZ(planarPoint, robotPosition);
  const blendStart = deadzone.radiusCm * 0.65;
  const blendEnd = wasInsideDeadzone ? deadzone.radiusCm + DEADZONE_EXIT_MARGIN_CM : deadzone.radiusCm;
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

/** A gesture-local drag plane. Scan noise never drives ordinary planar motion. */
export class DragPlacementPlane {
  private height: number;
  private targetHeight: number;
  private adapting = false;

  constructor(position: vec3) {
    this.height = this.targetHeight = position.y;
  }

  solve(from: vec3, direction: vec3, hits: MeshHit[], deltaS: number): vec3 | null {
    const intersect = (): vec3 | null => {
      const denominator = direction.y;
      if (Math.abs(denominator) < 0.0001) return null;
      const t = (this.height - from.y) / denominator;
      return t >= 0 ? from.add(direction.uniformScale(t)) : null;
    };
    const planar = intersect();
    if (!planar) return null;
    // Only the first surface counts; never look through a wall for a floor.
    const hit = hits[0];
    const usable = hit && [hit.position.x, hit.position.y, hit.position.z, hit.normal.x, hit.normal.y, hit.normal.z].every(Number.isFinite) &&
      hit.normal.length > 0.0001 && hit.normal.y / hit.normal.length >= Math.cos(Math.PI / 9) && hit.position.sub(from).dot(direction) > 0;
    if (usable && (this.adapting || Math.abs(hit.position.y - planar.y) > 10)) {
      this.targetHeight = hit.position.y;
      this.adapting = true;
    }
    if (!this.adapting) return planar;
    // Only the plane height follows the surface; never return the raw mesh hit.
    const alpha = 1 - Math.exp(-Math.max(0, Math.min(deltaS, 0.1)) / 0.1);
    this.height += (this.targetHeight - this.height) * alpha;
    if (Math.abs(this.height - this.targetHeight) < 0.25) {
      this.height = this.targetHeight; this.adapting = false;
    }
    return intersect();
  }
}


/** Stable room floor: a short, spatially sampled consensus, never a raw hit. */
export class SpecsFloorReference {
  heightCm: number | null = null;
  private samples: { height: number; at: number }[] = [];
  private targetHeight: number | null = null;
  reset(height: number | null): void { this.heightCm = this.targetHeight = height; this.samples = []; }
  advance(dt: number): void {
    if (this.heightCm === null || this.targetHeight === null) return;
    this.heightCm += (this.targetHeight - this.heightCm) * (1 - Math.exp(-Math.max(0, Math.min(dt, 0.1)) / 0.1));
    if (Math.abs(this.heightCm - this.targetHeight) < 0.01) this.heightCm = this.targetHeight;
  }
  observe(hit: MeshHit | undefined, now: number): boolean {
    if (!hit || this.heightCm === null || ![hit.position.x, hit.position.y, hit.position.z, hit.normal.x, hit.normal.y, hit.normal.z].every(Number.isFinite) ||
      !(hit.normal.length > 0.0001 && hit.normal.y / hit.normal.length >= Math.cos(Math.PI / 9)) ||
      Math.abs(hit.position.y - this.heightCm) > 18) return false;
    if (this.samples.length && now - this.samples[this.samples.length - 1].at < 0.07) return false;
    this.samples.push({ height: hit.position.y, at: now });
    if (this.samples.length > 5) this.samples.shift();
    if (this.samples.length < 5 || now - this.samples[0].at < 0.3) return true;
    const heights = this.samples.map(sample => sample.height).sort((a, b) => a - b);
    if (heights[3] - heights[1] <= 3) this.targetHeight = heights[2];
    return true;
  }
}

/** Smooth the complete placement before it is displayed AND streamed to the robot. */
export class SpecsDragPosition {
  private value: vec3;
  constructor(position: vec3) { this.value = new vec3(position.x, position.y, position.z); }
  update(target: vec3, dt: number): vec3 {
    const alpha = 1 - Math.exp(-Math.max(0, Math.min(dt, 0.1)) / 0.1);
    this.value = this.value.add(target.sub(this.value).uniformScale(alpha));
    return new vec3(this.value.x, this.value.y, this.value.z);
  }
  position(): vec3 { return new vec3(this.value.x, this.value.y, this.value.z); }
}
