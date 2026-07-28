import { NavigationMarker } from "./NavigationMarker";
import { yawRotationFromPlanarDirection } from "../Utilities/Utilities";
import {
  maybeAdvanceDragHeadingTarget,
  slerpRotationToward,
  smoothScalar,
} from "../Utilities/AnimationUtilities";

export const GROUND_NORMAL_MIN_Y = Math.cos((65 * Math.PI) / 180);
export const DEADZONE_EXIT_MARGIN_CM = 12;
export const ROBOT_GROUND_DEADZONE_RADIUS_CM = 75;
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

function horizontalDistanceXZ(a: vec3, b: vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function normalizeVec3(v: vec3): vec3 | null {
  const length = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (length <= 0.0001) {
    return null;
  }
  return new vec3(v.x / length, v.y / length, v.z / length);
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

export function isGroundNormal(normal: vec3): boolean {
  const length = Math.sqrt(
    normal.x * normal.x + normal.y * normal.y + normal.z * normal.z,
  );
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
  if (!deadzone) {
    return false;
  }
  const robotPosition = deadzone.getRobotWorldPosition();
  if (!robotPosition) {
    return false;
  }
  const radius =
    deadzone.radiusCm > 0 ? deadzone.radiusCm : ROBOT_GROUND_DEADZONE_RADIUS_CM;
  const threshold = wasInside ? radius + exitMarginCm : radius;
  return horizontalDistanceXZ(point, robotPosition) < threshold;
}

function smoothstep01(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

/** Blend robot-floor Y with mesh-ground Y near the deadzone edge to avoid a hard pop. */
function blendDeadzoneMeshGoalY(
  planarPoint: vec3,
  deadzone: RobotGroundDeadzone,
  wasInsideDeadzone: boolean,
  robotGoalY: number,
  meshGoalY: number,
): number {
  const robotPosition = deadzone.getRobotWorldPosition();
  if (!robotPosition) {
    return meshGoalY;
  }
  const radius =
    deadzone.radiusCm > 0 ? deadzone.radiusCm : ROBOT_GROUND_DEADZONE_RADIUS_CM;
  const dist = horizontalDistanceXZ(planarPoint, robotPosition);
  const blendStart = radius * 0.65;
  const blendEnd = wasInsideDeadzone
    ? radius + DEADZONE_EXIT_MARGIN_CM
    : radius;
  if (dist <= blendStart) {
    return robotGoalY;
  }
  if (dist >= blendEnd) {
    return meshGoalY;
  }
  const t = smoothstep01((dist - blendStart) / (blendEnd - blendStart));
  return robotGoalY + (meshGoalY - robotGoalY) * t;
}

export function solveMeshPlacement(args: SolveMeshPlacementArgs): MeshPlacementResult {
  const planarPoint = pinchPlanarPoint(args.rayFrom, args.rayTo, args.fallbackY);
  const fallback = buildPinchFallbackPoint(args.rayFrom, args.rayTo, args.fallbackY);
  const insideDeadzone = isInsideRobotDeadzone(
    planarPoint,
    args.deadzone,
    args.wasInsideDeadzone,
  );

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
    probePosition: new vec3(
      firstHit.position.x,
      firstHit.position.y,
      firstHit.position.z,
    ),
    goalPosition: null,
    wasInsideDeadzone: false,
  };
}

// ================================================================
/** World-mesh drag placement: pose input only; nav policy lives in NavigationController. */
// ================================================================

const DRAG_THRESHOLD_CM = 11;
const DRAG_HEADING_MIN_DELTA_CM = 3.0;
const DRAG_HEADING_SMOOTHING_RATE = 8.0;
const INTERPOLATION_SPEED = 10;
const DRAG_INTERPOLATION_SPEED = 14;
const IDLE_NAV_INTERPOLATION_SPEED = 8;
const IDLE_NAV_POSITION_EPSILON_CM = 0.25;
const IDLE_NAV_ROTATION_EPSILON_RAD = 0.01;
const PLACEMENT_ANCHOR_REBASE_DISTANCE_CM = 300;
const Y_SMOOTHING_RATE = 10;
const DRAG_Y_SMOOTHING_RATE = 16;
const DEADZONE_TRANSITION_Y_SMOOTHING_RATE = 9;
const WORLD_MESH_TRACKING_RELEASE_LATCH_S = 1.0;

export class GroundPlacement {
  public onMarkerButtonPressed: ((position: vec3, rotation: quat) => void) | null = null;
  public onPreviewTargetChanged: ((
    position: vec3,
    rotation: quat,
    placementActive: boolean,
    force: boolean,
  ) => void) | null = null;
  public onDragActivated: (() => void) | null = null;
  public onPresentationSync: (() => void) | null = null;

  private readonly owner: BaseScriptComponent;
  private readonly _deviceTracking: DeviceTracking;

  private _marker: NavigationMarker | null = null;
  private active = false;
  private _isDragging = false;
  private _hasActivatedPlacement = false;
  private _idleAnchor = false;
  private _dragEnabled = false;
  private updateEvent: SceneEvent | null = null;
  private activeInteractor: any = null;
  private desiredPosition = vec3.zero();
  private desiredRotation = quat.quatIdentity();
  private touchStartPosition = vec3.zero();
  private _processingButtonPress = false;
  private _headingTarget = quat.quatIdentity();
  private _headingGateOrigin: { x: number; z: number } = { x: 0, z: 0 };
  private _placementAnchor: SceneObject | null = null;
  private _confirmDeferralEvent: DelayedCallbackEvent | null = null;
  private _pendingConfirmPosition = vec3.zero();
  private _pendingConfirmRotation = new quat(1, 0, 0, 0);
  private _dragProbePosition = vec3.zero();
  private _blockReason: MeshBlockReason = "none";
  private _wasInsideDeadzone = false;
  private _goalSmoothedY = 0;
  private _goalSmoothedX = 0;
  private _goalSmoothedZ = 0;
  private _robotGroundDeadzone: RobotGroundDeadzone | null = null;
  private _worldMeshLatchEvent: DelayedCallbackEvent | null = null;
  private _worldMeshLatchToken = 0;
  private _worldMeshDisableToken = 0;

  constructor(owner: BaseScriptComponent, deviceTracking: DeviceTracking) {
    this.owner = owner;
    this._deviceTracking = deviceTracking;
    this._initDeferredEvents();
  }

  public attach(marker: NavigationMarker): void {
    this.detach();
    this._marker = marker;
    marker.bindEvents({
      onDragTriggerStart: (interactor) => this._handleDragTriggerStart(interactor),
      onDragTriggerEnd: () => this._handleDragTriggerEnd(),
      onDragTriggerCanceled: () => {
        this.activeInteractor = null;
        this._releaseWorldMeshTracking();
        this._emitPreviewTargetChanged(true);
      },
      onConfirmTriggerUp: () => this._handleConfirmTriggerUp(),
    });
  }

  public detach(): void {
    if (!this._marker) {
      return;
    }
    this._marker.unbindEvents();
    this._marker = null;
  }

  public start(position: vec3, rotation: quat): void {
    if (!this._marker) {
      print("GroundPlacement: start called without attached marker");
      return;
    }
    this.active = true;
    this._isDragging = false;
    this._hasActivatedPlacement = false;
    this._beginPlacingAtPose(position, rotation, true);
    this._ensureUpdateLoop();
  }

  public stop(): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    this._isDragging = false;
    this._hasActivatedPlacement = false;
    this._idleAnchor = false;
    this._processingButtonPress = false;
    this.activeInteractor = null;
    this._blockReason = "none";
    this._setDragEnabled(false);
    this._worldMeshLatchToken++;
    this._deviceTracking.worldOptions.enableWorldMeshesTracking = false;
    if (this.updateEvent) {
      this.owner.removeEvent(this.updateEvent);
      this.updateEvent = null;
    }
    this._marker?.releasePlacementAnchor();
    if (this._placementAnchor) {
      this._placementAnchor.destroy();
      this._placementAnchor = null;
    }
  }

  public isActive(): boolean {
    return this.active;
  }

  public isPlacementActive(): boolean {
    return this._hasActivatedPlacement;
  }

  public isActivelyDragging(): boolean {
    return this.activeInteractor !== null;
  }

  public getPlacementBlockReason(): MeshBlockReason {
    return this._blockReason;
  }

  public getDragProbePosition(): vec3 {
    return this._dragProbePosition;
  }

  public setIdleAnchor(enabled: boolean): void {
    this._idleAnchor = enabled;
  }

  public setDragEnabled(enabled: boolean): void {
    this._setDragEnabled(enabled);
  }

  public getCurrentPose(): { position: vec3; rotation: quat } | null {
    return {
      position: new vec3(
        this.desiredPosition.x,
        this.desiredPosition.y,
        this.desiredPosition.z,
      ),
      rotation: this.desiredRotation,
    };
  }

  public getRenderedPosition(): vec3 {
    return this._marker?.worldPosition ?? this.desiredPosition;
  }

  public resetToIdleAnchoring(): void {
    this._hasActivatedPlacement = false;
    this._isDragging = false;
    this.activeInteractor = null;
    this._releaseWorldMeshTracking();
  }

  public isIdleNavigation(): boolean {
    return (
      this.active &&
      this._idleAnchor &&
      !this._isDragging &&
      this.activeInteractor === null
    );
  }

  public syncIdlePose(position: vec3, rotation: quat): void {
    if (!this.isIdleNavigation() || !this._marker) {
      return;
    }
    const positionChanged =
      this.desiredPosition.distance(position) > IDLE_NAV_POSITION_EPSILON_CM;
    const rotationChanged =
      quat.angleBetween(this.desiredRotation, rotation) > IDLE_NAV_ROTATION_EPSILON_RAD;
    if (!positionChanged && !rotationChanged) {
      return;
    }
    this.desiredPosition = new vec3(position.x, position.y, position.z);
    this.desiredRotation = rotation;
    this._syncSmoothedGoal(this.desiredPosition);
    this.touchStartPosition = this.desiredPosition;
    this._wasInsideDeadzone = false;
    if (this._placementAnchor) {
      this._placementAnchor.getTransform().setWorldPosition(position);
      this._marker.setPose(position, rotation);
      return;
    }
    this._marker.interpolatePose(
      this.desiredPosition,
      this.desiredRotation,
      IDLE_NAV_INTERPOLATION_SPEED,
    );
  }

  /** Immediate idle-navigation snap (e.g. after world-frame pose correction). */
  public snapIdlePose(position: vec3, rotation: quat): void {
    if (!this.isIdleNavigation() || !this._marker) {
      return;
    }
    this.desiredPosition = new vec3(position.x, position.y, position.z);
    this.desiredRotation = rotation;
    this._syncSmoothedGoal(this.desiredPosition);
    this.touchStartPosition = this.desiredPosition;
    this._wasInsideDeadzone = false;
    this._resetHeadingState(this.desiredPosition, rotation);
    if (this._placementAnchor) {
      this._placementAnchor.getTransform().setWorldPosition(position);
    }
    this._marker.setPose(this.desiredPosition, rotation);
  }

  /** Place the marker at a bridge-authoritative goal while the user is not dragging. */
  public applyAuthoritativePose(position: vec3, rotation: quat): void {
    if (!this.active || !this._marker || this._isDragging) {
      return;
    }
    this.desiredPosition = new vec3(position.x, position.y, position.z);
    this.desiredRotation = rotation;
    this._syncSmoothedGoal(this.desiredPosition);
    this.touchStartPosition = this.desiredPosition;
    this._wasInsideDeadzone = false;
    this._resetHeadingState(this.desiredPosition, rotation);
    if (this._placementAnchor) {
      this._placementAnchor.getTransform().setWorldPosition(position);
    }
    this._marker.setPose(this.desiredPosition, rotation);
  }

  public setRobotGroundDeadzone(deadzone: RobotGroundDeadzone | null): void {
    this._robotGroundDeadzone = deadzone;
  }

  private _initDeferredEvents(): void {
    const confirmDeferral = this.owner.createEvent(
      "DelayedCallbackEvent",
    ) as DelayedCallbackEvent;
    confirmDeferral.bind(() => {
      this._processingButtonPress = false;
      this.onMarkerButtonPressed?.(this._pendingConfirmPosition, this._pendingConfirmRotation);
    });
    this._confirmDeferralEvent = confirmDeferral;

    const worldMeshLatch = this.owner.createEvent(
      "DelayedCallbackEvent",
    ) as DelayedCallbackEvent;
    worldMeshLatch.bind(() => {
      if (this._worldMeshLatchToken !== this._worldMeshDisableToken) {
        return;
      }
      this._deviceTracking.worldOptions.enableWorldMeshesTracking = false;
    });
    this._worldMeshLatchEvent = worldMeshLatch;
  }

  private _handleDragTriggerStart(interactor: any): void {
    if (!this.active || !this._dragEnabled) {
      return;
    }
    this._worldMeshLatchToken++;
    this._deviceTracking.worldOptions.enableWorldMeshesTracking = true;
    this.activeInteractor = interactor ?? null;
    this.touchStartPosition = this.desiredPosition;
    this._resetHeadingState(this.desiredPosition, this.desiredRotation);
    if (this._hasActivatedPlacement) {
      this._isDragging = true;
    }
  }

  private _handleDragTriggerEnd(): void {
    this.activeInteractor = null;
    this._releaseWorldMeshTracking();
    this._isDragging = false;
    this._syncDesiredPoseToRenderedPose();
    this._dragProbePosition = new vec3(
      this.desiredPosition.x,
      this.desiredPosition.y,
      this.desiredPosition.z,
    );
    this._marker?.setDragProbeWorldPosition(this._dragProbePosition);
    this._marker?.setPose(this.desiredPosition, this.desiredRotation);
    this._blockReason = "none";
    this._emitPreviewTargetChanged(true);
  }

  private _handleConfirmTriggerUp(): void {
    if (!this.active || this._processingButtonPress) {
      return;
    }
    this._processingButtonPress = true;
    this._syncDesiredPoseToRenderedPose();
    this._pendingConfirmPosition = this.desiredPosition;
    this._pendingConfirmRotation = this.desiredRotation;
    this._confirmDeferralEvent!.reset(0.0);
  }

  private _ensureUpdateLoop(): void {
    if (this.updateEvent) {
      return;
    }
    this.updateEvent = this.owner.createEvent("UpdateEvent");
    this.updateEvent.bind(() => this._tick());
  }

  private _tick(): void {
    if (!this.active || !this._marker) {
      return;
    }
    const dt = getDeltaTime();
    if (this.activeInteractor) {
      this._runPlacementProbe(dt);
    }
    if (this._isDragging && this.activeInteractor) {
      this._maybeRebasePlacementAnchor();
      this._marker.setDragProbeWorldPosition(this._dragProbePosition);
      this.desiredRotation = slerpRotationToward(
        this.desiredRotation,
        this._headingTarget,
        dt,
        DRAG_HEADING_SMOOTHING_RATE,
      );
      if (this._blockReason === "none") {
        this._marker.interpolatePose(
          this.desiredPosition,
          this.desiredRotation,
          DRAG_INTERPOLATION_SPEED,
          DRAG_INTERPOLATION_SPEED,
          true,
        );
      } else {
        this._marker.interpolatePose(
          this.desiredPosition,
          this.desiredRotation,
          INTERPOLATION_SPEED,
          INTERPOLATION_SPEED,
          true,
        );
      }
      this._emitPreviewTargetChanged(false);
    }
  }

  private _runPlacementProbe(dt: number): void {
    const interactor = this.activeInteractor;
    const direction = interactor?.endPoint
      ?.sub(interactor?.startPoint)
      ?.normalize?.();
    if (!direction) {
      return;
    }

    const rayFrom = interactor.startPoint as vec3;
    const rayTo = rayFrom.add(direction.uniformScale(PINCH_RAY_LENGTH_CM));
    const rawHits = this._deviceTracking.raycastWorldMesh(rayFrom, rayTo);
    const hits = rawHits.map((hit) => ({
      position: hit.position,
      normal: hit.normal,
    }));
    const result = solveMeshPlacement({
      rayFrom,
      rayTo,
      hits,
      deadzone: this._robotGroundDeadzone,
      wasInsideDeadzone: this._wasInsideDeadzone,
      fallbackY: this.desiredPosition.y,
    });

    this._dragProbePosition = result.probePosition;
    const wasInsideDeadzoneBefore = this._wasInsideDeadzone;
    this._wasInsideDeadzone = result.wasInsideDeadzone;

    const dragDistance = this._horizontalDistance(this._dragProbePosition, this.touchStartPosition);
    if (dragDistance > DRAG_THRESHOLD_CM && !this._isDragging) {
      this._syncDesiredPoseToRenderedPose();
      this._activatePlacement();
    }

    if (result.status === "ok" && result.goalPosition) {
      const dragging = this._isDragging && this.activeInteractor;
      const deadzoneTransition =
        wasInsideDeadzoneBefore !== result.wasInsideDeadzone;
      const ySmoothingRate = dragging
        ? deadzoneTransition
          ? DEADZONE_TRANSITION_Y_SMOOTHING_RATE
          : DRAG_Y_SMOOTHING_RATE
        : Y_SMOOTHING_RATE;
      const xzSmoothingRate = dragging ? DRAG_Y_SMOOTHING_RATE : Y_SMOOTHING_RATE;
      this._goalSmoothedY = smoothScalar(
        this._goalSmoothedY,
        result.goalPosition.y,
        dt,
        ySmoothingRate,
      );
      this._goalSmoothedX = smoothScalar(
        this._goalSmoothedX,
        result.goalPosition.x,
        dt,
        xzSmoothingRate,
      );
      this._goalSmoothedZ = smoothScalar(
        this._goalSmoothedZ,
        result.goalPosition.z,
        dt,
        xzSmoothingRate,
      );
      this.desiredPosition = new vec3(
        this._goalSmoothedX,
        this._goalSmoothedY,
        this._goalSmoothedZ,
      );
      this._blockReason = "none";
      if (this._isDragging) {
        this._updateDragHeading(this.desiredPosition);
      }
      return;
    }

    this._blockReason = result.blockReason;
  }

  private _bindPlacementAnchor(worldPosition: vec3): void {
    if (!this._marker) {
      return;
    }
    if (!this._placementAnchor) {
      this._placementAnchor = global.scene.createSceneObject(
        "NavigationPlacementAnchor",
      );
    }
    this._marker.bindPlacementAnchor(this._placementAnchor, worldPosition);
  }

  private _maybeRebasePlacementAnchor(): void {
    if (!this._marker) {
      return;
    }
    const local = this._marker.localPosition;
    const horizontalDistance = Math.sqrt(local.x * local.x + local.z * local.z);
    if (horizontalDistance < PLACEMENT_ANCHOR_REBASE_DISTANCE_CM) {
      return;
    }
    this._marker.rebasePlacementAnchor();
  }

  private _updateDragHeading(planarPoint: vec3): void {
    const result = maybeAdvanceDragHeadingTarget(
      this._headingGateOrigin,
      { x: planarPoint.x, z: planarPoint.z },
      DRAG_HEADING_MIN_DELTA_CM,
    );
    this._headingGateOrigin = result.gateOrigin;
    if (result.headingDirection) {
      this._headingTarget = yawRotationFromPlanarDirection(
        result.headingDirection.x,
        result.headingDirection.z,
      );
    }
  }

  private _resetHeadingState(position: vec3, rotation: quat): void {
    this._headingTarget = rotation;
    this._headingGateOrigin = { x: position.x, z: position.z };
  }

  private _syncDesiredPoseToRenderedPose(): void {
    if (!this._marker) {
      return;
    }
    this.desiredPosition = this._marker.worldPosition;
    this.desiredRotation = this._marker.getRotation();
    this._syncSmoothedGoal(this.desiredPosition);
  }

  private _syncSmoothedGoal(position: vec3): void {
    this._goalSmoothedX = position.x;
    this._goalSmoothedY = position.y;
    this._goalSmoothedZ = position.z;
  }

  private _beginPlacingAtPose(
    position: vec3,
    rotation: quat,
    resetPlacementActive: boolean,
  ): void {
    if (!this._marker) {
      return;
    }
    this._resetGestureState();
    if (resetPlacementActive) {
      this._isDragging = false;
      this._hasActivatedPlacement = false;
    }
    this.desiredPosition = new vec3(position.x, position.y, position.z);
    this.desiredRotation = rotation;
    this._syncSmoothedGoal(this.desiredPosition);
    this._dragProbePosition = new vec3(position.x, position.y, position.z);
    this._blockReason = "none";
    this._wasInsideDeadzone = false;
    this._resetHeadingState(this.desiredPosition, rotation);
    this.touchStartPosition = this.desiredPosition;
    this._bindPlacementAnchor(position);
    this._marker.setPose(this.desiredPosition, rotation);
    this._marker.setDragProbeWorldPosition(this._dragProbePosition);
    this.onPresentationSync?.();
    this._emitPreviewTargetChanged(true);
  }

  private _resetGestureState(): void {
    this.activeInteractor = null;
  }

  private _activatePlacement(): void {
    if (this._isDragging) {
      return;
    }
    this._isDragging = true;
    this._hasActivatedPlacement = true;
    this.onDragActivated?.();
    this.onPresentationSync?.();
  }

  private _emitPreviewTargetChanged(force: boolean): void {
    this.onPreviewTargetChanged?.(
      this.desiredPosition,
      this.desiredRotation,
      this.isPlacementActive(),
      force,
    );
  }

  private _setDragEnabled(enabled: boolean): void {
    this._dragEnabled = enabled;
    this._marker?.setDragEnabled(enabled);
    if (!enabled) {
      this.activeInteractor = null;
      this._releaseWorldMeshTracking();
    }
  }

  private _releaseWorldMeshTracking(): void {
    this._worldMeshDisableToken = this._worldMeshLatchToken;
    this._worldMeshLatchEvent?.reset(WORLD_MESH_TRACKING_RELEASE_LATCH_S);
  }

  private _horizontalDistance(a: vec3, b: vec3): number {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
  }
}
