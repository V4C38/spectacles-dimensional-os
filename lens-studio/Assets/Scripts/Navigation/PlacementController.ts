import { NavigationMarkerView } from "./NavigationMarkerView";
import { yawRotationFromPlanarDirection } from "./HeadingRotation";
import { SurfacePlacementStabilizer } from "./SurfacePlacementStabilizer";

// ================================================================
/** Ground-ray drag placement for navigation goals with robot deadzone and marker anchoring. */
// ================================================================

const DRAG_THRESHOLD_CM = 11;
const INTERPOLATION_SPEED = 10;
const IDLE_FOLLOW_INTERPOLATION_SPEED = 8;
const IDLE_FOLLOW_POSITION_EPSILON_CM = 0.25;
const IDLE_FOLLOW_ROTATION_EPSILON_RAD = 0.01;
const GROUND_NORMAL_MIN_Y = 0.95;
const SURFACE_RAY_START_Y_OFFSET_CM = 120;
const SURFACE_RAY_END_Y_OFFSET_CM = 220;
const DRAG_HIT_TEST_INTERVAL = 2;
const GROUND_Y_OFFSET_CM = 5;
const DIRECTION_SMOOTHING_RATE = 7.0;
const MIN_DRAG_DELTA_CM = 1.25;
const MAX_ROTATION_SPEED_RAD_PER_SEC = 24.0;
const ROTATION_INTERPOLATION_SPEED = 22;
const PLACEMENT_ANCHOR_REBASE_DISTANCE_CM = 300;
const ROBOT_GROUND_DEADZONE_RADIUS_CM = 75;
const ROBOT_GROUND_DEADZONE_EXIT_MARGIN_CM = 12;
const OUTCOME_RESET_DURATION_S = 2.0;

type PlacementMarkerState =
  | "idleFollowingRobot"
  | "dragged"
  | "executing"
  | "resettingOutcome";

export type RobotGroundDeadzone = {
  radiusCm: number;
  getRobotWorldPosition: () => vec3 | null;
  getRobotFloorWorldY: () => number | null;
};

export class PlacementController {
  public onConfirmed: ((position: vec3, rotation: quat) => void) | null = null;
  public onCancelled: ((position: vec3, rotation: quat) => void) | null = null;
  public onPreviewTargetChanged: ((
    position: vec3,
    rotation: quat,
    placementActive: boolean,
    force: boolean,
  ) => void) | null = null;

  private readonly owner: BaseScriptComponent;
  private readonly worldQueryModule: any;
  private readonly renderer: NavigationMarkerView;
  private readonly _surfaceStabilizer = new SurfacePlacementStabilizer();

  private active = false;
  private _state: PlacementMarkerState = "idleFollowingRobot";
  private hitTestSession: any = null;
  private updateEvent: SceneEvent | null = null;
  private activeInteractor: any = null;
  private desiredPosition = vec3.zero();
  private desiredRotation = quat.quatIdentity();
  private touchStartPosition = vec3.zero();
  private isDragging = false;
  private lastGroundHeight = 0;
  private _cachedResolvedGroundY: number | null = null;
  private _wasDragInsideDeadzone = false;
  private _dragHitTestFrameCount = 0;
  private _processingButtonPress = false;
  private _previousDragPosition: vec3 | null = null;
  private _smoothedDragDirection = vec3.zero();
  private _placementAnchor: SceneObject | null = null;
  private _robotGroundDeadzone: RobotGroundDeadzone | null = null;
  private _placementActive = false;
  // BUG-2: cached confirm deferral event (created once, re-armed per press).
  private _confirmDeferralEvent: DelayedCallbackEvent | null = null;
  private _hitTestDeferralEvent: DelayedCallbackEvent | null = null;
  private _outcomeResetEvent: DelayedCallbackEvent | null = null;
  private _pendingResetPoseProvider: (() => { position: vec3; rotation: quat } | null) | null =
    null;
  private _pendingWasExecuting = false;
  private _pendingConfirmPosition = vec3.zero();
  private _pendingConfirmRotation = new quat(1, 0, 0, 0);

  constructor(
    owner: BaseScriptComponent,
    worldQueryModule: any,
    rayOrigin: SceneObject | null,
    renderer: NavigationMarkerView,
  ) {
    this.owner = owner;
    this.worldQueryModule = worldQueryModule;
    this.renderer = renderer;
    this._bindMarkerInteractions();
  }

  public start(position: vec3, rotation: quat): void {
    print(
      `PlacementController: start at (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`,
    );
    this.active = true;
    this._state = "idleFollowingRobot";
    this._beginPlacingAtPose(position, rotation, true);
    // Defer WorldQuery hit-test session creation to the next frame so it does
    // not contend with LiDAR mesh and camera stream activating in the same frame.
    this._hitTestDeferralEvent?.reset(0.0);
    this._ensureUpdateLoop();
  }

  public stop(): void {
    if (!this.active) {
      return;
    }
    print("PlacementController: stop");
    this.active = false;
    this._state = "idleFollowingRobot";
    this._placementActive = false;
    this._processingButtonPress = false;
    this.activeInteractor = null;
    this._setDragEnabled(false);
    this.renderer.hide();
    if (this.updateEvent) {
      this.owner.removeEvent(this.updateEvent);
      this.updateEvent = null;
    }
    if (this.hitTestSession && typeof this.hitTestSession.stop === "function") {
      this.hitTestSession.stop();
    }
    this.hitTestSession = null;
    this.renderer.releasePlacementAnchor();
    this._placementAnchor = null;
  }

  public isActive(): boolean {
    return this.active;
  }

  public isPlacementActive(): boolean {
    return this._placementActive;
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
    return this.renderer.worldPosition;
  }

  public showExecuting(): void {
    if (!this.active) {
      return;
    }
    this._state = "executing";
    this._syncDesiredPoseToRenderedPose();
    this.renderer.showExecuting();
    this._setDragEnabled(false);
  }

  public resumePlacing(): void {
    if (!this.active) {
      return;
    }
    this._state = this._placementActive ? "dragged" : "idleFollowingRobot";
    this._syncDesiredPoseToRenderedPose();
    this.renderer.showPlacing(this._placementActive);
    this._emitPreviewTargetChanged(true);
    this._setDragEnabled(true);
  }

  public respawnPlacingAt(
    getPose: () => { position: vec3; rotation: quat } | null,
  ): void {
    if (!this.active) {
      return;
    }
    this._state = "idleFollowingRobot";
    this._setDragEnabled(false);
    this._resetGestureState();
    this.renderer.hideAndThen(() => {
      if (!this.active) {
        return;
      }
      const pose = getPose();
      if (!pose) {
        this.resumePlacing();
        return;
      }
      this._beginPlacingAtPose(pose.position, pose.rotation, true);
    });
  }

  public beginOutcomeReset(
    label: "Cancelled" | "Failed",
    getPose: () => { position: vec3; rotation: quat } | null,
  ): void {
    if (!this.active) {
      return;
    }
    this._state = "resettingOutcome";
    this._placementActive = false;
    this._processingButtonPress = false;
    this._pendingResetPoseProvider = getPose;
    this._setDragEnabled(false);
    this._resetGestureState();
    this.renderer.showOutcomeReset(label);
    this._outcomeResetEvent?.reset(OUTCOME_RESET_DURATION_S);
  }

  public isIdleFollowingRobot(): boolean {
    return (
      this.active &&
      this._state === "idleFollowingRobot" &&
      this.activeInteractor === null &&
      !this._placementActive
    );
  }

  public syncIdlePose(position: vec3, rotation: quat): void {
    if (!this.isIdleFollowingRobot()) {
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
    this.lastGroundHeight = position.y;
    this._cachedResolvedGroundY = position.y;
    this.touchStartPosition = this.desiredPosition;
    this._surfaceStabilizer.reset(position.y, this.desiredPosition);
    this.renderer.interpolatePose(
      this.desiredPosition,
      this.desiredRotation,
      IDLE_FOLLOW_INTERPOLATION_SPEED,
    );
  }

  public setRobotGroundDeadzone(
    deadzone: RobotGroundDeadzone | null,
  ): void {
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

  private _bindMarkerInteractions(): void {
    const dragInteractable = this.renderer.dragInteractable as any;
    if (dragInteractable?.onTriggerStart?.add) {
      dragInteractable.onTriggerStart.add((args: any) => {
        if (
          !this.active ||
          this._state === "executing" ||
          this._state === "resettingOutcome"
        ) {
          return;
        }
        this.activeInteractor = args?.interactor ?? null;
        this.touchStartPosition = this.desiredPosition;
        this.isDragging = false;
        this._previousDragPosition = null;
        const headingForward = this.desiredRotation.multiplyVec3(new vec3(1, 0, 0));
        this._smoothedDragDirection = new vec3(headingForward.x, 0, headingForward.z);
      });
    }
    if (dragInteractable?.onTriggerEnd?.add) {
      dragInteractable.onTriggerEnd.add(() => {
        this.activeInteractor = null;
        this.isDragging = false;
        this._previousDragPosition = null;
        this._syncDesiredPoseToRenderedPose();
        this._snapCurrentPoseToSurface();
        this.renderer.setPose(this.desiredPosition, this.desiredRotation);
        this._emitPreviewTargetChanged(true);
      });
    }
    if (dragInteractable?.onTriggerCanceled?.add) {
      dragInteractable.onTriggerCanceled.add((args: any) => {
        args?.interactor?.clearCurrentInteractable?.();
        this.activeInteractor = null;
        this._previousDragPosition = null;
        this._emitPreviewTargetChanged(true);
      });
    }
    // Deferred hit-test session init: created once, re-armed on each start().
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

    // BUG-2: create the confirm deferral event once; re-arm per press.
    const confirmDeferral = this.owner.createEvent(
      "DelayedCallbackEvent",
    ) as DelayedCallbackEvent;
    confirmDeferral.bind(() => {
      this._processingButtonPress = false;
      if (this._pendingWasExecuting) {
        this.onCancelled?.(this._pendingConfirmPosition, this._pendingConfirmRotation);
      } else {
        this.onConfirmed?.(this._pendingConfirmPosition, this._pendingConfirmRotation);
      }
    });
    this._confirmDeferralEvent = confirmDeferral;

    const outcomeReset = this.owner.createEvent(
      "DelayedCallbackEvent",
    ) as DelayedCallbackEvent;
    outcomeReset.bind(() => {
      const pose = this._pendingResetPoseProvider?.() ?? null;
      this._pendingResetPoseProvider = null;
      if (!this.active) {
        return;
      }
      if (!pose) {
        this.resumePlacing();
        return;
      }
      this._beginPlacingAtPose(pose.position, pose.rotation, true);
    });
    this._outcomeResetEvent = outcomeReset;

    const confirmButton = this.renderer.confirmActionButton as any;
    if (confirmButton?.onTriggerUp?.add) {
      confirmButton.onTriggerUp.add(() => {
        if (!this.active || this._processingButtonPress) {
          return;
        }
        this._processingButtonPress = true;
        this._syncDesiredPoseToRenderedPose();
        this._pendingWasExecuting = this._state === "executing";
        this._pendingConfirmPosition = this.desiredPosition;
        this._pendingConfirmRotation = this.desiredRotation;
        this._confirmDeferralEvent!.reset(0.0);
      });
    }
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
    if (!this.active) {
      return;
    }
    if (this._state === "idleFollowingRobot" || this._state === "dragged") {
      if (this.activeInteractor) {
        this._adjustPositionOnSurface();
      }
      if (this.isDragging && this.activeInteractor) {
        this._maybeRebasePlacementAnchor();
        this.renderer.interpolatePose(
          this.desiredPosition,
          this.desiredRotation,
          INTERPOLATION_SPEED,
          ROTATION_INTERPOLATION_SPEED,
        );
        this._emitPreviewTargetChanged(false);
      }
    }
  }

  private _bindPlacementAnchor(worldPosition: vec3): void {
    if (!this._placementAnchor) {
      this._placementAnchor = global.scene.createSceneObject(
        "NavigationPlacementAnchor",
      );
    }
    this.renderer.bindPlacementAnchor(this._placementAnchor, worldPosition);
  }

  private _maybeRebasePlacementAnchor(): void {
    const local = this.renderer.localPosition;
    const horizontalDistance = Math.sqrt(local.x * local.x + local.z * local.z);
    if (horizontalDistance < PLACEMENT_ANCHOR_REBASE_DISTANCE_CM) {
      return;
    }
    this.renderer.rebasePlacementAnchor();
  }

  private _offsetPointY(point: vec3, yOffsetCm: number): vec3 {
    return new vec3(point.x, point.y + yOffsetCm, point.z);
  }

  private _snapCurrentPoseToSurface(): void {
    this._snapPointToSurface(this.desiredPosition);
  }

  private _snapPointToSurface(point: vec3): void {
    if (!this.hitTestSession) {
      this._applyDragFallback(point);
      return;
    }
    const rayStart = this._offsetPointY(point, SURFACE_RAY_START_Y_OFFSET_CM);
    const rayEnd = this._offsetPointY(point, -SURFACE_RAY_END_Y_OFFSET_CM);
    let consumed = false;
    const consumeOnce = (rawResults: any) => {
      if (consumed) {
        return;
      }
      consumed = true;
      this._consumeSurfaceSnap(rawResults, point);
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
    if (dragDistance > DRAG_THRESHOLD_CM && !this.isDragging) {
      this.isDragging = true;
      this._activatePlacement();
      this._syncDesiredPoseToRenderedPose();
    }
    if (this.isDragging) {
      this._dragHitTestFrameCount++;
      if (this._dragHitTestFrameCount >= DRAG_HIT_TEST_INTERVAL) {
        this._dragHitTestFrameCount = 0;
        this._snapPointToSurface(pointPosition);
      } else {
        this._applyDragFallback(pointPosition);
      }
      this._updateDragDirection(pointPosition);
    }
  }

  private _applyDragFallback(fallbackPoint: vec3): void {
    const insideDeadzone = this._isDragInsideDeadzone(fallbackPoint);
    const floorY = this._resolveFallbackGroundY(insideDeadzone);
    const rawTarget = new vec3(fallbackPoint.x, floorY, fallbackPoint.z);
    this._commitResolvedPlacement(rawTarget, fallbackPoint, false);
    this._wasDragInsideDeadzone = insideDeadzone;
  }

  private _consumeSurfaceSnap(rawResults: any, fallbackPoint: vec3): void {
    const first = Array.isArray(rawResults) ? rawResults[0] : rawResults;
    const foundPosition = first?.position ?? first?.hit?.position ?? null;
    const foundNormal = first?.normal ?? first?.hit?.normal ?? null;
    if (!foundPosition || !foundNormal || !this._isGroundLikeHit(foundNormal)) {
      this._applyDragFallback(fallbackPoint);
      return;
    }

    const insideDeadzone = this._isDragInsideDeadzone(fallbackPoint);

    // Clear the surface buffer on deadzone boundary crossing so stale
    // in-deadzone (robot-mesh) hits don't corrupt the outside median.
    if (!insideDeadzone && this._wasDragInsideDeadzone) {
      this._surfaceStabilizer.clearSamples();
    }
    this._wasDragInsideDeadzone = insideDeadzone;

    if (insideDeadzone) {
      const effectiveY = this._resolveFallbackGroundY(true);
      const rawTarget = new vec3(fallbackPoint.x, effectiveY, fallbackPoint.z);
      this._commitResolvedPlacement(rawTarget, fallbackPoint, false);
      this._wasDragInsideDeadzone = true;
      return;
    }

    // Outside deadzone: standard surface snap with median outlier filter.
    const candidateY = foundPosition.y + GROUND_Y_OFFSET_CM;
    this._surfaceStabilizer.pushSample(foundPosition, candidateY);

    const bufferEstimate = this._surfaceStabilizer.estimateFromBuffer();
    const resolvedY = bufferEstimate?.y ?? candidateY;
    const rawTarget = new vec3(fallbackPoint.x, resolvedY, fallbackPoint.z);
    const snapImmediate = this._surfaceStabilizer.shouldSnapImmediate();
    this._commitResolvedPlacement(rawTarget, fallbackPoint, snapImmediate);
    this._wasDragInsideDeadzone = false;
  }

  private _commitResolvedPlacement(
    rawTarget: vec3,
    fallbackPoint: vec3,
    snapImmediate: boolean,
  ): void {
    let target = rawTarget;

    const dt = getDeltaTime();
    if (dt <= 0) {
      this.desiredPosition = target;
      this._cachedResolvedGroundY = target.y;
      this.lastGroundHeight = target.y;
      return;
    }

    const snapNow = snapImmediate;
    target = this._surfaceStabilizer.advanceTowardTarget(target, dt, snapNow);

    if (this.isDragging && this.activeInteractor) {
      // Drag XZ follows the hand immediately; only height is temporally smoothed.
      target = new vec3(fallbackPoint.x, target.y, fallbackPoint.z);
    }

    this.desiredPosition = target;
    this._cachedResolvedGroundY = target.y;
    this.lastGroundHeight = target.y;
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

  private _resolveFallbackGroundY(insideDeadzone: boolean): number {
    if (insideDeadzone) {
      const robotFloorY = this._robotGroundDeadzone?.getRobotFloorWorldY() ?? null;
      if (robotFloorY !== null) {
        return robotFloorY + GROUND_Y_OFFSET_CM;
      }
    }
    return this._cachedResolvedGroundY ?? this.lastGroundHeight;
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

  private _updateDragDirection(pointPosition: vec3): void {
    if (this._previousDragPosition) {
      const dx = pointPosition.x - this._previousDragPosition.x;
      const dz = pointPosition.z - this._previousDragPosition.z;
      const deltaMag = Math.sqrt(dx * dx + dz * dz);
      if (deltaMag > MIN_DRAG_DELTA_CM) {
        const nx = dx / deltaMag;
        const nz = dz / deltaMag;
        const alpha = 1.0 - Math.exp(-DIRECTION_SMOOTHING_RATE * getDeltaTime());
        this._smoothedDragDirection = new vec3(
          this._smoothedDragDirection.x + (nx - this._smoothedDragDirection.x) * alpha,
          0,
          this._smoothedDragDirection.z + (nz - this._smoothedDragDirection.z) * alpha,
        );
        const smoothedMag = Math.sqrt(
          this._smoothedDragDirection.x * this._smoothedDragDirection.x +
          this._smoothedDragDirection.z * this._smoothedDragDirection.z,
        );
        if (smoothedMag > 0.001) {
          const fx = this._smoothedDragDirection.x / smoothedMag;
          const fz = this._smoothedDragDirection.z / smoothedMag;
          const targetRotation = this._yawRotation(fx, fz);
          const currentRotation = this.desiredRotation;
          const maxRotationStep =
            MAX_ROTATION_SPEED_RAD_PER_SEC * getDeltaTime();
          const angleToTarget = quat.angleBetween(
            currentRotation,
            targetRotation,
          );
          const rotationAlpha =
            angleToTarget <= 0.0001
              ? 1
              : Math.min(1, maxRotationStep / angleToTarget);
          this.desiredRotation = quat.slerp(
            currentRotation,
            targetRotation,
            rotationAlpha,
          );
        }
      }
    }
    this._previousDragPosition = pointPosition;
  }

  private _yawRotation(x: number, z: number): quat {
    return yawRotationFromPlanarDirection(x, z);
  }

  private _syncDesiredPoseToRenderedPose(): void {
    this.desiredPosition = this.renderer.worldPosition;
    this.desiredRotation = this.renderer.getRotation();
    this.lastGroundHeight = this.desiredPosition.y;
    this._cachedResolvedGroundY = this.desiredPosition.y;
    this._surfaceStabilizer.advanceTowardTarget(
      this.desiredPosition,
      getDeltaTime(),
      true,
    );
  }

  private _beginPlacingAtPose(
    position: vec3,
    rotation: quat,
    resetPlacementActive: boolean,
  ): void {
    this._resetGestureState();
    if (resetPlacementActive) {
      this._placementActive = false;
    }
    this._state = this._placementActive ? "dragged" : "idleFollowingRobot";
    this.desiredPosition = new vec3(position.x, position.y, position.z);
    this.desiredRotation = rotation;
    this.lastGroundHeight = position.y;
    this._cachedResolvedGroundY = position.y;
    this._wasDragInsideDeadzone = false;
    this.touchStartPosition = this.desiredPosition;
    this._surfaceStabilizer.reset(position.y, this.desiredPosition);
    this._bindPlacementAnchor(position);
    this.renderer.setPose(this.desiredPosition, rotation);
    this.renderer.showPlacing(this._placementActive);
    this._emitPreviewTargetChanged(true);
    this._setDragEnabled(true);
  }

  private _resetGestureState(): void {
    this.activeInteractor = null;
    this.isDragging = false;
    this._dragHitTestFrameCount = 0;
    this._previousDragPosition = null;
    this._smoothedDragDirection = vec3.zero();
  }

  private _activatePlacement(): void {
    if (this._placementActive) {
      return;
    }
    this._state = "dragged";
    this._placementActive = true;
    this.renderer.setConfirmVisible(true);
  }

  private _emitPreviewTargetChanged(force: boolean): void {
    this.onPreviewTargetChanged?.(
      this.desiredPosition,
      this.desiredRotation,
      this._placementActive,
      force,
    );
  }

  private _setDragEnabled(enabled: boolean): void {
    const dragInteractable = this.renderer.dragInteractable as any;
    if (!dragInteractable) {
      return;
    }
    dragInteractable.enabled = enabled;
    if (!enabled) {
      this.activeInteractor = null;
    }
  }
}
