import { NavigationTargetMarker } from "./NavigationTargetMarker";
import type { NavGoalConfig, PlacementInteractionPolicy } from "./NavigationModel";
import { yawRotationFromPlanarDirection } from "../Core/Utilities";

// ================================================================
/** Ground-ray drag placement: pose input only; nav policy lives in NavigationController. */
// ================================================================

const DRAG_THRESHOLD_CM = 11;
const INTERPOLATION_SPEED = 10;
const IDLE_FOLLOW_INTERPOLATION_SPEED = 8;
const IDLE_FOLLOW_POSITION_EPSILON_CM = 0.25;
const IDLE_FOLLOW_ROTATION_EPSILON_RAD = 0.01;
const GROUND_NORMAL_MIN_Y = 0.95;
const SURFACE_RAY_START_Y_OFFSET_CM = 120;
const SURFACE_RAY_END_Y_OFFSET_CM = 220;
const GROUND_Y_OFFSET_CM = 5;
const Y_SMOOTHING_RATE = 10.0;
const PLACEMENT_ANCHOR_REBASE_DISTANCE_CM = 300;
const ROBOT_GROUND_DEADZONE_RADIUS_CM = 75;
const ROBOT_GROUND_DEADZONE_EXIT_MARGIN_CM = 12;

const Y_SAMPLE_WINDOW_S = 0.35;
const Y_MAX_SAMPLES = 24;
const Y_MIN_SAMPLES_FOR_MEDIAN = 3;

export type RobotGroundDeadzone = {
  radiusCm: number;
  getRobotWorldPosition: () => vec3 | null;
  getRobotFloorWorldY: () => number | null;
};

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  let sum = 0;
  for (let index = 0; index < values.length; index++) {
    sum += values[index];
  }
  return sum / values.length;
}

class SurfaceYFilter {
  private _samples: { y: number; time: number }[] = [];
  private _smoothedY = 0;

  public reset(y: number): void {
    this._samples = [];
    this._smoothedY = y;
  }

  public push(rawY: number, now: number = getTime()): void {
    this._prune(now);
    this._samples.push({ y: rawY, time: now });
    if (this._samples.length > Y_MAX_SAMPLES) {
      this._samples.shift();
    }
  }

  public filteredY(): number {
    if (this._samples.length === 0) {
      return this._smoothedY;
    }
    const ys = this._samples.map((sample) => sample.y);
    return ys.length >= Y_MIN_SAMPLES_FOR_MEDIAN ? median(ys) : average(ys);
  }

  public smoothTo(targetY: number, dt: number): number {
    if (dt <= 0) {
      this._smoothedY = targetY;
      return this._smoothedY;
    }
    const alpha = 1.0 - Math.exp(-Y_SMOOTHING_RATE * dt);
    this._smoothedY = this._smoothedY + (targetY - this._smoothedY) * alpha;
    return this._smoothedY;
  }

  private _prune(now: number): void {
    while (this._samples.length > 0) {
      if (now - this._samples[0].time <= Y_SAMPLE_WINDOW_S) {
        break;
      }
      this._samples.shift();
    }
  }
}

export class SurfacePlacementController {
  public onConfirmed: ((position: vec3, rotation: quat) => void) | null = null;
  public onCancelled: ((position: vec3, rotation: quat) => void) | null = null;
  public onPreviewTargetChanged: ((
    position: vec3,
    rotation: quat,
    placementActive: boolean,
    force: boolean,
  ) => void) | null = null;
  public onDragActivated: (() => void) | null = null;
  public onPresentationSync: (() => void) | null = null;
  public isGoalCommitted: (() => boolean) | null = null;
  public getConfig: (() => NavGoalConfig | null) | null = null;

  private readonly owner: BaseScriptComponent;
  private readonly worldQueryModule: any;
  private readonly _yFilter = new SurfaceYFilter();

  private _marker: NavigationTargetMarker | null = null;
  private active = false;
  private _isDragging = false;
  private _followRobot = false;
  private _dragEnabled = false;
  private hitTestSession: any = null;
  private updateEvent: SceneEvent | null = null;
  private activeInteractor: any = null;
  private desiredPosition = vec3.zero();
  private desiredRotation = quat.quatIdentity();
  private touchStartPosition = vec3.zero();
  private _floorY = 0;
  private _wasDragInsideDeadzone = false;
  private _processingButtonPress = false;
  private _previousDragPosition: vec3 | null = null;
  private _placementAnchor: SceneObject | null = null;
  private _robotGroundDeadzone: RobotGroundDeadzone | null = null;
  private _confirmDeferralEvent: DelayedCallbackEvent | null = null;
  private _hitTestDeferralEvent: DelayedCallbackEvent | null = null;
  private _pendingConfirmPosition = vec3.zero();
  private _pendingConfirmRotation = new quat(1, 0, 0, 0);

  constructor(owner: BaseScriptComponent, worldQueryModule: any) {
    this.owner = owner;
    this.worldQueryModule = worldQueryModule;
    this._initDeferredEvents();
  }

  public attach(marker: NavigationTargetMarker): void {
    this.detach();
    this._marker = marker;
    marker.bindEvents({
      onDragTriggerStart: (interactor) => this._handleDragTriggerStart(interactor),
      onDragTriggerEnd: () => this._handleDragTriggerEnd(),
      onDragTriggerCanceled: () => {
        this.activeInteractor = null;
        this._previousDragPosition = null;
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
      print("SurfacePlacementController: start called without attached marker");
      return;
    }
    this.active = true;
    this._isDragging = false;
    this._beginPlacingAtPose(position, rotation, true);
    this._hitTestDeferralEvent?.reset(0.0);
    this._ensureUpdateLoop();
  }

  public stop(): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    this._isDragging = false;
    this._followRobot = false;
    this._processingButtonPress = false;
    this.activeInteractor = null;
    this._setDragEnabled(false);
    if (this.updateEvent) {
      this.owner.removeEvent(this.updateEvent);
      this.updateEvent = null;
    }
    if (this.hitTestSession && typeof this.hitTestSession.stop === "function") {
      this.hitTestSession.stop();
    }
    this.hitTestSession = null;
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
    return this._isDragging;
  }

  public setInteractionPolicy(policy: PlacementInteractionPolicy): void {
    this._followRobot = policy.followRobot;
    this._setDragEnabled(policy.dragEnabled);
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

  public respawnPlacingAt(
    getPose: () => { position: vec3; rotation: quat } | null,
  ): void {
    if (!this.active || !this._marker) {
      return;
    }
    this._isDragging = false;
    this._setDragEnabled(false);
    this._resetGestureState();
    this._marker.hideAndThen(() => {
      if (!this.active) {
        return;
      }
      const pose = getPose();
      if (!pose) {
        return;
      }
      this._beginPlacingAtPose(pose.position, pose.rotation, true);
    });
  }

  public isIdleFollowingRobot(): boolean {
    return (
      this.active &&
      this._followRobot &&
      !this._isDragging &&
      this.activeInteractor === null
    );
  }

  public syncIdlePose(position: vec3, rotation: quat): void {
    if (!this.isIdleFollowingRobot() || !this._marker) {
      return;
    }
    const positionChanged =
      this.desiredPosition.distance(position) > IDLE_FOLLOW_POSITION_EPSILON_CM;
    const rotationChanged =
      quat.angleBetween(this.desiredRotation, rotation) > IDLE_FOLLOW_ROTATION_EPSILON_RAD;
    if (!positionChanged && !rotationChanged) {
      return;
    }
    this.desiredPosition = new vec3(position.x, position.y, position.z);
    this.desiredRotation = rotation;
    this._floorY = position.y;
    this.touchStartPosition = this.desiredPosition;
    this._yFilter.reset(position.y);
    this._marker.interpolatePose(
      this.desiredPosition,
      this.desiredRotation,
      IDLE_FOLLOW_INTERPOLATION_SPEED,
    );
  }

  public setRobotGroundDeadzone(deadzone: RobotGroundDeadzone | null): void {
    if (!deadzone) {
      this._robotGroundDeadzone = null;
      return;
    }
    this._robotGroundDeadzone = {
      radiusCm: deadzone.radiusCm > 0
        ? deadzone.radiusCm
        : ROBOT_GROUND_DEADZONE_RADIUS_CM,
      getRobotWorldPosition: deadzone.getRobotWorldPosition,
      getRobotFloorWorldY: deadzone.getRobotFloorWorldY,
    };
  }

  private _initDeferredEvents(): void {
    const hitTestDeferral = this.owner.createEvent(
      "DelayedCallbackEvent",
    ) as DelayedCallbackEvent;
    hitTestDeferral.bind(() => {
      if (!this.active) {
        return;
      }
      this._ensureHitTestSession();
    });
    this._hitTestDeferralEvent = hitTestDeferral;

    const confirmDeferral = this.owner.createEvent(
      "DelayedCallbackEvent",
    ) as DelayedCallbackEvent;
    confirmDeferral.bind(() => {
      this._processingButtonPress = false;
      if (this.isGoalCommitted?.()) {
        this.onCancelled?.(this._pendingConfirmPosition, this._pendingConfirmRotation);
      } else {
        this.onConfirmed?.(this._pendingConfirmPosition, this._pendingConfirmRotation);
      }
    });
    this._confirmDeferralEvent = confirmDeferral;
  }

  private _handleDragTriggerStart(interactor: any): void {
    if (!this.active || !this._dragEnabled) {
      return;
    }
    this.activeInteractor = interactor ?? null;
    this.touchStartPosition = this.desiredPosition;
    this._previousDragPosition = null;
  }

  private _handleDragTriggerEnd(): void {
    this.activeInteractor = null;
    this._previousDragPosition = null;
    this._syncDesiredPoseToRenderedPose();
    const resolved = this._resolveDragPoint(this.desiredPosition, getDeltaTime());
    this.desiredPosition = resolved;
    this._marker?.setPose(this.desiredPosition, this.desiredRotation);
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

  private _ensureHitTestSession(): void {
    if (this.hitTestSession || !this.worldQueryModule) {
      return;
    }

    const optionsFactory = (global as any).HitTestSessionOptions;
    const createWithOptions = this.worldQueryModule.createHitTestSessionWithOptions;
    if (
      optionsFactory &&
      typeof optionsFactory.create === "function" &&
      typeof createWithOptions === "function"
    ) {
      const options = optionsFactory.create();
      options.filter = true;
      this.hitTestSession = createWithOptions.call(this.worldQueryModule, options);
    } else if (typeof this.worldQueryModule.createHitTestSession === "function") {
      this.hitTestSession = this.worldQueryModule.createHitTestSession();
    }

    if (this.hitTestSession && typeof this.hitTestSession.start === "function") {
      this.hitTestSession.start();
    }
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
    if (this.activeInteractor) {
      this._adjustPositionOnSurface();
    }
    if (this._isDragging && this.activeInteractor) {
      this._maybeRebasePlacementAnchor();
      this._marker.interpolatePose(
        this.desiredPosition,
        this.desiredRotation,
        INTERPOLATION_SPEED,
      );
      this._emitPreviewTargetChanged(false);
    }
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

  private _offsetPointY(point: vec3, yOffsetCm: number): vec3 {
    return new vec3(point.x, point.y + yOffsetCm, point.z);
  }

  private _adjustPositionOnSurface(): void {
    const interactorDirection = this.activeInteractor?.endPoint
      ?.sub(this.activeInteractor?.startPoint)
      ?.normalize?.();
    if (!interactorDirection) {
      return;
    }
    const planeNormal = vec3.up().uniformScale(-1);
    const denominator = planeNormal.dot(interactorDirection);
    if (Math.abs(denominator) <= 0.0001) {
      return;
    }
    const planeOffset = new vec3(
      this.desiredPosition.x - this.activeInteractor.startPoint.x,
      this.desiredPosition.y - this.activeInteractor.startPoint.y,
      this.desiredPosition.z - this.activeInteractor.startPoint.z,
    );
    const distanceToPlane = planeNormal.dot(planeOffset) / denominator;
    const pointPosition = this.activeInteractor.startPoint.add(
      interactorDirection.uniformScale(distanceToPlane),
    );
    const dragDistance = pointPosition.distance(this.touchStartPosition);
    if (dragDistance > DRAG_THRESHOLD_CM && !this._isDragging) {
      this._activatePlacement();
      this._syncDesiredPoseToRenderedPose();
    }
    if (this._isDragging) {
      this._probeSurfaceY(pointPosition);
      this.desiredPosition = this._resolveDragPoint(pointPosition, getDeltaTime());
      this._updateDragHeading(pointPosition);
    }
  }

  private _resolveDragPoint(planarPoint: vec3, dt: number): vec3 {
    const insideDeadzone = this._isDragInsideDeadzone(planarPoint);

    if (insideDeadzone) {
      this._wasDragInsideDeadzone = true;
      const y =
        (this._robotGroundDeadzone?.getRobotFloorWorldY() ?? this._floorY) +
        GROUND_Y_OFFSET_CM;
      this._floorY = y;
      return new vec3(planarPoint.x, y, planarPoint.z);
    }

    if (this._wasDragInsideDeadzone) {
      this._yFilter.reset(this._floorY);
      this._wasDragInsideDeadzone = false;
    }

    const targetY = this._yFilter.filteredY();
    const smoothedY = this._yFilter.smoothTo(targetY, dt);
    this._floorY = smoothedY;
    return new vec3(planarPoint.x, smoothedY, planarPoint.z);
  }

  private _probeSurfaceY(planarPoint: vec3): void {
    if (this._isDragInsideDeadzone(planarPoint)) {
      return;
    }
    if (!this.hitTestSession) {
      return;
    }
    const rayStart = this._offsetPointY(planarPoint, SURFACE_RAY_START_Y_OFFSET_CM);
    const rayEnd = this._offsetPointY(planarPoint, -SURFACE_RAY_END_Y_OFFSET_CM);
    let consumed = false;
    const consumeOnce = (rawResults: any) => {
      if (consumed) {
        return;
      }
      consumed = true;
      const first = Array.isArray(rawResults) ? rawResults[0] : rawResults;
      const foundPosition = first?.position ?? first?.hit?.position ?? null;
      const foundNormal = first?.normal ?? first?.hit?.normal ?? null;
      if (!foundPosition || !foundNormal || !this._isGroundLikeHit(foundNormal)) {
        return;
      }
      this._yFilter.push(foundPosition.y + GROUND_Y_OFFSET_CM);
    };
    const maybeResults = this.hitTestSession.hitTest(
      rayStart,
      rayEnd,
      (result: any) => consumeOnce(result),
    );
    if (maybeResults !== undefined) {
      consumeOnce(maybeResults);
    }
  }

  private _isDragInsideDeadzone(point: vec3): boolean {
    if (!this._robotGroundDeadzone) {
      return false;
    }
    const robotPosition = this._robotGroundDeadzone.getRobotWorldPosition();
    if (!robotPosition) {
      return false;
    }
    const dx = point.x - robotPosition.x;
    const dz = point.z - robotPosition.z;
    const horizontalDistance = Math.sqrt(dx * dx + dz * dz);
    const threshold = this._wasDragInsideDeadzone
      ? this._robotGroundDeadzone.radiusCm + ROBOT_GROUND_DEADZONE_EXIT_MARGIN_CM
      : this._robotGroundDeadzone.radiusCm;
    return horizontalDistance < threshold;
  }

  private _isGroundLikeHit(normal: vec3): boolean {
    const length = Math.sqrt(
      normal.x * normal.x + normal.y * normal.y + normal.z * normal.z,
    );
    if (length <= 0.0001) {
      return false;
    }
    const normalizedY = normal.y / length;
    return normalizedY > GROUND_NORMAL_MIN_Y;
  }

  private _updateDragHeading(planarPoint: vec3): void {
    if (!this._previousDragPosition) {
      this._previousDragPosition = planarPoint;
      return;
    }
    const dx = planarPoint.x - this._previousDragPosition.x;
    const dz = planarPoint.z - this._previousDragPosition.z;
    const deltaMag = Math.sqrt(dx * dx + dz * dz);
    if (deltaMag > 0.001) {
      this.desiredRotation = yawRotationFromPlanarDirection(
        dx / deltaMag,
        dz / deltaMag,
      );
    }
    this._previousDragPosition = planarPoint;
  }

  private _syncDesiredPoseToRenderedPose(): void {
    if (!this._marker) {
      return;
    }
    this.desiredPosition = this._marker.worldPosition;
    this.desiredRotation = this._marker.getRotation();
    this._floorY = this.desiredPosition.y;
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
    }
    this.desiredPosition = new vec3(position.x, position.y, position.z);
    this.desiredRotation = rotation;
    this._floorY = position.y;
    this._wasDragInsideDeadzone = false;
    this.touchStartPosition = this.desiredPosition;
    this._yFilter.reset(position.y);
    this._bindPlacementAnchor(position);
    this._marker.setPose(this.desiredPosition, rotation);
    this.onPresentationSync?.();
    this._emitPreviewTargetChanged(true);
  }

  private _resetGestureState(): void {
    this.activeInteractor = null;
    this._previousDragPosition = null;
  }

  private _activatePlacement(): void {
    if (this._isDragging) {
      return;
    }
    this._isDragging = true;
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
    }
  }
}
