import { NavGoalMarker } from "./NavGoalMarker";

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

const DRAG_THRESHOLD_CM = 11;
const DRAG_HEADING_MIN_DELTA_CM = 3.0;
const DRAG_HEADING_SMOOTHING_RATE = 8.0;
const DRAG_INTERPOLATION_SPEED = 14;
const FOLLOW_FLOOR_INTERPOLATION_SPEED = 8;
export const FOLLOW_FLOOR_POSITION_EPSILON_CM = 0.25;
export const FOLLOW_FLOOR_ROTATION_EPSILON_RAD = 0.01;
const Y_SMOOTHING_RATE = 10;
const DRAG_Y_SMOOTHING_RATE = 16;
const DEADZONE_TRANSITION_Y_SMOOTHING_RATE = 9;
const WORLD_MESH_TRACKING_RELEASE_LATCH_S = 1.0;

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

export class GroundPlacement {
  onPose: ((position: vec3, rotation: quat, force: boolean) => void) | null = null;
  onCancel: (() => void) | null = null;
  onDragChange: ((dragging: boolean) => void) | null = null;

  private readonly owner: BaseScriptComponent;
  private readonly deviceTracking: DeviceTracking;
  private marker: NavGoalMarker | null = null;
  private active = false;
  private followFloor = false;
  private dragging = false;
  private activated = false;
  private updateEvent: SceneEvent | null = null;
  private activeInteractor: { startPoint?: vec3; endPoint?: vec3 } | null = null;
  private desiredPosition = vec3.zero();
  private desiredRotation = quat.quatIdentity();
  private touchStartPosition = vec3.zero();
  private headingTarget = quat.quatIdentity();
  private headingGateOrigin = { x: 0, z: 0 };
  private dragProbePosition = vec3.zero();
  private blockReason: MeshBlockReason = "none";
  private wasInsideDeadzone = false;
  private goalSmoothedX = 0;
  private goalSmoothedY = 0;
  private goalSmoothedZ = 0;
  private deadzone: RobotGroundDeadzone | null = null;
  private worldMeshLatchEvent: DelayedCallbackEvent | null = null;
  private worldMeshLatchToken = 0;
  private worldMeshDisableToken = 0;

  constructor(owner: BaseScriptComponent, deviceTracking: DeviceTracking) {
    if (!deviceTracking) {
      throw new Error("DeviceTracking is required");
    }
    this.owner = owner;
    this.deviceTracking = deviceTracking;
    const worldMeshLatch = owner.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
    worldMeshLatch.bind(() => {
      if (this.worldMeshLatchToken !== this.worldMeshDisableToken) {
        return;
      }
      this.deviceTracking.worldOptions.enableWorldMeshesTracking = false;
    });
    this.worldMeshLatchEvent = worldMeshLatch;
  }

  attach(marker: NavGoalMarker): void {
    this.detach();
    this.marker = marker;
    marker.bindEvents({
      onDragTriggerStart: (interactor) => this.handleDragStart(interactor),
      onDragTriggerEnd: () => this.handleDragEnd(),
      onDragTriggerCanceled: () => {
        this.activeInteractor = null;
        this.releaseWorldMeshTracking();
        this.emitPose(true);
        this.onDragChange?.(false);
      },
      onCancel: () => this.onCancel?.(),
    });
  }

  detach(): void {
    this.marker?.unbindEvents();
    this.marker = null;
  }

  start(position: vec3, rotation: quat): void {
    if (!this.marker) {
      throw new Error("NavGoalMarker is required");
    }
    this.active = true;
    this.followFloor = false;
    this.dragging = false;
    this.activated = false;
    this.desiredPosition = new vec3(position.x, position.y, position.z);
    this.desiredRotation = rotation;
    this.syncSmoothedGoal(this.desiredPosition);
    this.dragProbePosition = new vec3(position.x, position.y, position.z);
    this.blockReason = "none";
    this.wasInsideDeadzone = false;
    this.resetHeading(this.desiredPosition, rotation);
    this.touchStartPosition = this.desiredPosition;
    this.marker.setPose(this.desiredPosition, rotation);
    this.marker.setDragProbeWorldPosition(this.dragProbePosition);
    this.marker.setDragEnabled(true);
    this.marker.show();
    this.ensureUpdateLoop();
  }

  stop(): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.followFloor = false;
    this.dragging = false;
    this.activated = false;
    this.activeInteractor = null;
    this.blockReason = "none";
    this.marker?.setDragEnabled(false);
    this.marker?.hide();
    this.worldMeshLatchToken++;
    this.deviceTracking.worldOptions.enableWorldMeshesTracking = false;
    if (this.updateEvent) {
      this.owner.removeEvent(this.updateEvent);
      this.updateEvent = null;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  isActivelyDragging(): boolean {
    return this.activeInteractor !== null;
  }

  isActivated(): boolean {
    return this.activated;
  }

  resetActivated(): void {
    this.activated = false;
    this.dragging = false;
  }

  setFollowFloor(enabled: boolean): void {
    this.followFloor = enabled;
  }

  isFollowFloor(): boolean {
    return this.active && this.followFloor && !this.isActivelyDragging();
  }

  syncFollowFloorPose(position: vec3, rotation: quat): void {
    if (!this.isFollowFloor()) {
      return;
    }
    if (
      !shouldSyncFollowFloorPose(
        { position: this.desiredPosition, rotation: this.desiredRotation },
        { position, rotation },
      )
    ) {
      return;
    }
    this.desiredPosition = new vec3(position.x, position.y, position.z);
    this.desiredRotation = rotation;
    this.syncSmoothedGoal(this.desiredPosition);
    this.touchStartPosition = this.desiredPosition;
    this.wasInsideDeadzone = false;
    this.resetHeading(this.desiredPosition, rotation);
  }

  applyPose(position: vec3, rotation: quat): void {
    if (!this.active || this.dragging || this.activeInteractor) {
      return;
    }
    this.desiredPosition = new vec3(position.x, position.y, position.z);
    this.desiredRotation = rotation;
    this.syncSmoothedGoal(this.desiredPosition);
    this.dragProbePosition = new vec3(position.x, position.y, position.z);
    this.blockReason = "none";
    this.resetHeading(this.desiredPosition, rotation);
    this.touchStartPosition = this.desiredPosition;
    this.marker?.setPose(this.desiredPosition, rotation);
    this.marker?.setDragProbeWorldPosition(this.dragProbePosition);
  }

  currentPose(): { position: vec3; rotation: quat } {
    return {
      position: new vec3(this.desiredPosition.x, this.desiredPosition.y, this.desiredPosition.z),
      rotation: this.desiredRotation,
    };
  }

  setRobotGroundDeadzone(deadzone: RobotGroundDeadzone | null): void {
    this.deadzone = deadzone;
  }

  private handleDragStart(interactor: { startPoint?: vec3; endPoint?: vec3 } | null): void {
    if (!this.active) {
      return;
    }
    this.worldMeshLatchToken++;
    this.deviceTracking.worldOptions.enableWorldMeshesTracking = true;
    this.activeInteractor = interactor;
    this.touchStartPosition = this.desiredPosition;
    this.resetHeading(this.desiredPosition, this.desiredRotation);
    this.onDragChange?.(true);
  }

  private handleDragEnd(): void {
    this.activeInteractor = null;
    this.releaseWorldMeshTracking();
    this.dragging = false;
    this.syncDesiredFromMarker();
    this.dragProbePosition = new vec3(
      this.desiredPosition.x,
      this.desiredPosition.y,
      this.desiredPosition.z,
    );
    this.marker?.setDragProbeWorldPosition(this.dragProbePosition);
    this.marker?.setPose(this.desiredPosition, this.desiredRotation);
    this.blockReason = "none";
    this.emitPose(true);
    this.onDragChange?.(false);
  }

  private ensureUpdateLoop(): void {
    if (this.updateEvent) {
      return;
    }
    this.updateEvent = this.owner.createEvent("UpdateEvent");
    this.updateEvent.bind(() => this.tick());
  }

  private tick(): void {
    if (!this.active || !this.marker) {
      return;
    }
    const dt = getDeltaTime();
    if (this.isFollowFloor()) {
      this.marker.interpolatePose(this.desiredPosition, this.desiredRotation, FOLLOW_FLOOR_INTERPOLATION_SPEED);
      return;
    }
    const wasDragging = this.dragging;
    if (this.activeInteractor) {
      this.runPlacementProbe(dt);
    }
    if (this.dragging && this.activeInteractor) {
      this.marker.setDragProbeWorldPosition(this.dragProbePosition);
      this.desiredRotation = slerpRotationToward(
        this.desiredRotation,
        this.headingTarget,
        dt,
        DRAG_HEADING_SMOOTHING_RATE,
      );
      if (this.blockReason === "none") {
        this.marker.interpolatePose(this.desiredPosition, this.desiredRotation, DRAG_INTERPOLATION_SPEED);
      }
      this.emitPose(!wasDragging);
    }
  }

  private runPlacementProbe(dt: number): void {
    const interactor = this.activeInteractor;
    const start = interactor?.startPoint;
    const end = interactor?.endPoint;
    if (!start || !end) {
      return;
    }
    const direction = end.sub(start);
    const length = Math.sqrt(direction.x * direction.x + direction.y * direction.y + direction.z * direction.z);
    if (length <= 0.0001) {
      return;
    }
    const rayFrom = start;
    const rayTo = rayFrom.add(direction.uniformScale(PINCH_RAY_LENGTH_CM / length));
    const rawHits = this.deviceTracking.raycastWorldMesh(rayFrom, rayTo);
    const hits = rawHits.map((hit) => ({ position: hit.position, normal: hit.normal }));
    const result = solveMeshPlacement({
      rayFrom,
      rayTo,
      hits,
      deadzone: this.deadzone,
      wasInsideDeadzone: this.wasInsideDeadzone,
      fallbackY: this.desiredPosition.y,
    });
    this.dragProbePosition = result.probePosition;
    const wasInsideBefore = this.wasInsideDeadzone;
    this.wasInsideDeadzone = result.wasInsideDeadzone;
    const dragDistance = horizontalDistanceXZ(this.dragProbePosition, this.touchStartPosition);
    if (dragDistance > DRAG_THRESHOLD_CM && !this.dragging) {
      this.syncDesiredFromMarker();
      this.dragging = true;
      this.activated = true;
    }
    if (result.status === "ok" && result.goalPosition) {
      const yRate = this.dragging
        ? wasInsideBefore !== result.wasInsideDeadzone
          ? DEADZONE_TRANSITION_Y_SMOOTHING_RATE
          : DRAG_Y_SMOOTHING_RATE
        : Y_SMOOTHING_RATE;
      const xzRate = this.dragging ? DRAG_Y_SMOOTHING_RATE : Y_SMOOTHING_RATE;
      this.goalSmoothedY = smoothScalar(this.goalSmoothedY, result.goalPosition.y, dt, yRate);
      this.goalSmoothedX = smoothScalar(this.goalSmoothedX, result.goalPosition.x, dt, xzRate);
      this.goalSmoothedZ = smoothScalar(this.goalSmoothedZ, result.goalPosition.z, dt, xzRate);
      this.desiredPosition = new vec3(this.goalSmoothedX, this.goalSmoothedY, this.goalSmoothedZ);
      this.blockReason = "none";
      if (this.dragging) {
        this.updateDragHeading(this.desiredPosition);
      }
      return;
    }
    this.blockReason = result.blockReason;
  }

  private updateDragHeading(planarPoint: vec3): void {
    const result = maybeAdvanceDragHeadingTarget(
      this.headingGateOrigin,
      { x: planarPoint.x, z: planarPoint.z },
      DRAG_HEADING_MIN_DELTA_CM,
    );
    this.headingGateOrigin = result.gateOrigin;
    if (result.headingDirection) {
      this.headingTarget = yawRotationFromPlanarDirection(
        result.headingDirection.x,
        result.headingDirection.z,
      );
    }
  }

  private resetHeading(position: vec3, rotation: quat): void {
    this.headingTarget = rotation;
    this.headingGateOrigin = { x: position.x, z: position.z };
  }

  private syncDesiredFromMarker(): void {
    if (!this.marker) {
      return;
    }
    this.desiredPosition = this.marker.worldPosition;
    this.desiredRotation = this.marker.getRotation();
    this.syncSmoothedGoal(this.desiredPosition);
  }

  private syncSmoothedGoal(position: vec3): void {
    this.goalSmoothedX = position.x;
    this.goalSmoothedY = position.y;
    this.goalSmoothedZ = position.z;
  }

  private releaseWorldMeshTracking(): void {
    this.worldMeshDisableToken = this.worldMeshLatchToken;
    this.worldMeshLatchEvent?.reset(WORLD_MESH_TRACKING_RELEASE_LATCH_S);
  }

  private emitPose(force: boolean): void {
    if (!this.activated) {
      return;
    }
    this.onPose?.(
      new vec3(this.desiredPosition.x, this.desiredPosition.y, this.desiredPosition.z),
      this.desiredRotation,
      force,
    );
  }
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

function smoothScalar(current: number, target: number, dt: number, rate: number): number {
  if (dt <= 0) {
    return target;
  }
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

function slerpRotationToward(current: quat, target: quat, dt: number, rate: number): quat {
  return quat.slerp(current, target, dt > 0 ? 1 - Math.exp(-rate * dt) : 1);
}

function maybeAdvanceDragHeadingTarget(
  gateOrigin: { x: number; z: number },
  current: { x: number; z: number },
  minTravelCm: number,
): { gateOrigin: { x: number; z: number }; headingDirection: { x: number; z: number } | null } {
  const dx = current.x - gateOrigin.x;
  const dz = current.z - gateOrigin.z;
  const travel = Math.sqrt(dx * dx + dz * dz);
  if (travel < minTravelCm) {
    return { gateOrigin, headingDirection: null };
  }
  const inv = 1 / travel;
  return {
    gateOrigin: { x: current.x, z: current.z },
    headingDirection: { x: dx * inv, z: dz * inv },
  };
}

function yawRotationFromPlanarDirection(x: number, z: number): quat {
  const yaw = Math.atan2(-z, x);
  const halfYaw = yaw * 0.5;
  return new quat(Math.cos(halfYaw), 0, Math.sin(halfYaw), 0);
}
