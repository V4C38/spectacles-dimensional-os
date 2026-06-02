import { NavigationMarkerView } from "./NavigationMarkerView";

const DRAG_THRESHOLD_CM = 11;
const INTERPOLATION_SPEED = 8;
const GROUND_NORMAL_MIN_Y = 0.95;
const SURFACE_RAY_START_Y_OFFSET_CM = 120;
const SURFACE_RAY_END_Y_OFFSET_CM = 220;
const DRAG_HIT_TEST_INTERVAL = 6;
const Y_UPDATE_THRESHOLD_CM = 5;
const GROUND_Y_OFFSET_CM = 5;
const DIRECTION_SMOOTHING_RATE = 4.0;
const MIN_DRAG_DELTA_CM = 0.5;
const MAX_ROTATION_SPEED_RAD_PER_SEC = 15.0;
const PLACEMENT_ANCHOR_REBASE_DISTANCE_CM = 300;
const ROBOT_GROUND_DEADZONE_RADIUS_CM = 75;

type PlacementVisualState = "placing" | "executing";

export type RobotGroundDeadzone = {
  radiusCm: number;
  getRobotWorldPosition: () => vec3 | null;
};

export class PlacementController {
  public onConfirmed: ((position: vec3, rotation: quat) => void) | null = null;
  public onCancelled: ((position: vec3, rotation: quat) => void) | null = null;

  private readonly owner: BaseScriptComponent;
  private readonly worldQueryModule: any;
  private readonly renderer: NavigationMarkerView;

  private active = false;
  private visualState: PlacementVisualState = "placing";
  private hitTestSession: any = null;
  private updateEvent: SceneEvent | null = null;
  private activeInteractor: any = null;
  private desiredPosition = vec3.zero();
  private desiredRotation = quat.quatIdentity();
  private touchStartPosition = vec3.zero();
  private isDragging = false;
  private lastGroundHeight = 0;
  private _dragHitTestFrameCount = 0;
  private _processingButtonPress = false;
  private _previousDragPosition: vec3 | null = null;
  private _smoothedDragDirection = vec3.zero();
  private _placementAnchor: SceneObject | null = null;
  private _robotGroundDeadzone: RobotGroundDeadzone | null = null;

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
    this.visualState = "placing";
    this.activeInteractor = null;
    this.isDragging = false;
    this.lastGroundHeight = position.y;
    this._dragHitTestFrameCount = 0;
    this._previousDragPosition = null;
    this._smoothedDragDirection = vec3.zero();
    this.desiredPosition = new vec3(position.x, position.y, position.z);
    this.desiredRotation = this._levelRotation(rotation);
    this.touchStartPosition = this.desiredPosition;
    this._bindPlacementAnchor(position);
    this.renderer.setPose(this.desiredPosition, this.desiredRotation);
    this.renderer.showPlacing();
    this._syncMoveDirectionPreview();
    this._setDragEnabled(true);
    this._ensureHitTestSession();
    this._ensureUpdateLoop();
  }

  public stop(): void {
    print("PlacementController: stop");
    this.active = false;
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

  public showExecuting(): void {
    if (!this.active) {
      return;
    }
    this.visualState = "executing";
    this._syncDesiredPoseToRenderedPose();
    this.renderer.showExecuting();
    this._setDragEnabled(false);
  }

  public showPlacing(): void {
    if (!this.active) {
      return;
    }
    this.visualState = "placing";
    this._syncDesiredPoseToRenderedPose();
    this.renderer.showPlacing();
    this._syncMoveDirectionPreview();
    this._setDragEnabled(true);
  }

  public showPlacingAtNewPose(position: vec3, rotation: quat): void {
    if (!this.active) {
      return;
    }
    this.visualState = "placing";
    this._setDragEnabled(false);
    this.isDragging = false;
    this.activeInteractor = null;
    this.renderer.hideAndThen(() => {
      if (!this.active) {
        return;
      }
      this.desiredPosition = new vec3(position.x, position.y, position.z);
      this.desiredRotation = this._levelRotation(rotation);
      this.lastGroundHeight = position.y;
      this.touchStartPosition = this.desiredPosition;
      this._previousDragPosition = null;
      this._smoothedDragDirection = vec3.zero();
      this._bindPlacementAnchor(position);
      this.renderer.setPose(this.desiredPosition, this.desiredRotation);
      this.renderer.showPlacing();
      this._syncMoveDirectionPreview();
      this._setDragEnabled(true);
    });
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
    };
  }

  private _bindMarkerInteractions(): void {
    const dragInteractable = this.renderer.dragInteractable as any;
    if (dragInteractable?.onTriggerStart?.add) {
      dragInteractable.onTriggerStart.add((args: any) => {
        if (!this.active || this.visualState !== "placing") {
          return;
        }
        this.activeInteractor = args?.interactor ?? null;
        this.touchStartPosition = this.desiredPosition;
        this.isDragging = false;
        this._previousDragPosition = null;
        this._smoothedDragDirection = vec3.zero();
      });
    }
    if (dragInteractable?.onTriggerEnd?.add) {
      dragInteractable.onTriggerEnd.add(() => {
        this.activeInteractor = null;
        this._previousDragPosition = null;
      });
    }
    if (dragInteractable?.onTriggerCanceled?.add) {
      dragInteractable.onTriggerCanceled.add((args: any) => {
        args?.interactor?.clearCurrentInteractable?.();
        this.activeInteractor = null;
        this._previousDragPosition = null;
      });
    }
    this.renderer.confirmActionButton.onTriggerUp.add(() => {
      if (!this.active || this._processingButtonPress) {
        return;
      }
      this._processingButtonPress = true;
      this._syncDesiredPoseToRenderedPose();
      const wasExecuting = this.visualState === "executing";
      const position = this.desiredPosition;
      const rotation = this.desiredRotation;
      
      const delayedEvent = this.owner.createEvent("DelayedCallbackEvent");
      delayedEvent.bind(() => {
        this._processingButtonPress = false;
        if (wasExecuting) {
          this.onCancelled?.(position, rotation);
        } else {
          this.onConfirmed?.(position, rotation);
        }
      });
      delayedEvent.reset(0.0);
    });
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
    if (this.visualState === "placing") {
      if (this.activeInteractor) {
        this._adjustPositionOnSurface();
      } else {
        this._snapCurrentPoseToSurface();
      }
      this._maybeRebasePlacementAnchor();
      this.renderer.interpolatePose(
        this.desiredPosition,
        this.desiredRotation,
        INTERPOLATION_SPEED,
      );
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
      return;
    }
    const rayStart = this._offsetPointY(point, SURFACE_RAY_START_Y_OFFSET_CM);
    const rayEnd = this._offsetPointY(point, -SURFACE_RAY_END_Y_OFFSET_CM);
    const maybeResults = this.hitTestSession.hitTest(
      rayStart,
      rayEnd,
      (result: any) => this._consumeSurfaceSnap(result, point),
    );
    if (maybeResults !== undefined) {
      this._consumeSurfaceSnap(maybeResults, point);
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
    }
    if (this.isDragging) {
      this._dragHitTestFrameCount++;
      if (this._dragHitTestFrameCount >= DRAG_HIT_TEST_INTERVAL) {
        this._dragHitTestFrameCount = 0;
        this._snapPointToSurface(pointPosition);
      } else {
        this.desiredPosition = new vec3(
          pointPosition.x,
          this.lastGroundHeight,
          pointPosition.z,
        );
      }
      this._updateDragDirection(pointPosition);
    }
  }

  private _consumeSurfaceSnap(rawResults: any, _fallbackPoint: vec3): void {
    const first = Array.isArray(rawResults) ? rawResults[0] : rawResults;
    const foundPosition = first?.position ?? first?.hit?.position ?? null;
    const foundNormal = first?.normal ?? first?.hit?.normal ?? null;
    if (!foundPosition || !foundNormal || !this._isGroundLikeHit(foundNormal)) {
      this.desiredPosition = new vec3(
        this.desiredPosition.x,
        this.lastGroundHeight,
        this.desiredPosition.z,
      );
      return;
    }
    const candidateY = foundPosition.y + GROUND_Y_OFFSET_CM;
    let effectiveY = candidateY;
    if (
      this._isInsideRobotGroundDeadzone(foundPosition) &&
      effectiveY > this.lastGroundHeight
    ) {
      effectiveY = this.lastGroundHeight;
    }
    const yDelta = Math.abs(effectiveY - this.lastGroundHeight);
    if (this.lastGroundHeight !== 0 && yDelta < Y_UPDATE_THRESHOLD_CM) {
      this.desiredPosition = new vec3(
        foundPosition.x,
        this.lastGroundHeight,
        foundPosition.z,
      );
      return;
    }
    this.lastGroundHeight = effectiveY;
    this.desiredPosition = new vec3(
      foundPosition.x,
      this.lastGroundHeight,
      foundPosition.z,
    );
  }

  private _isInsideRobotGroundDeadzone(point: vec3): boolean {
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
    return horizontalDistance < this._robotGroundDeadzone.radiusCm;
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
          const maxRotationStep =
            MAX_ROTATION_SPEED_RAD_PER_SEC * getDeltaTime();
          const angleToTarget = quat.angleBetween(
            this.desiredRotation,
            targetRotation,
          );
          const rotationAlpha =
            angleToTarget <= 0.0001
              ? 1
              : Math.min(1, maxRotationStep / angleToTarget);
          this.desiredRotation = quat.slerp(
            this.desiredRotation,
            targetRotation,
            rotationAlpha,
          );
          this._syncMoveDirectionPreview();
        }
      }
    }
    this._previousDragPosition = pointPosition;
  }

  private _levelRotation(rotation: quat): quat {
    const forward = rotation.multiplyVec3(vec3.right().uniformScale(-1)); // -X is actual forward
    const distance = Math.sqrt(forward.x * forward.x + forward.z * forward.z);
    if (distance < 0.001) {
      return quat.quatIdentity();
    }
    return this._yawRotation(forward.x / distance, forward.z / distance);
  }

  private _yawRotation(x: number, z: number): quat {
    const yaw = Math.atan2(z, x);
    const halfYaw = yaw * 0.5;
    // Lens Studio quat constructor is (w, x, y, z); Y-axis yaw = (cos, 0, sin, 0)
    return new quat(Math.cos(halfYaw), 0, Math.sin(halfYaw), 0);
  }

  private _syncDesiredPoseToRenderedPose(): void {
    this.desiredPosition = this.renderer.worldPosition;
    this.lastGroundHeight = this.desiredPosition.y;
  }

  private _syncMoveDirectionPreview(): void {
    this.renderer.setMoveDirectionFromRotation(this.desiredRotation);
  }

  private _setDragEnabled(enabled: boolean): void {
    const dragInteractable = this.renderer.dragInteractable as any;
    if (!dragInteractable) {
      return;
    }
    dragInteractable.enabled = enabled;
    if ("enableInstantDrag" in dragInteractable) {
      dragInteractable.enableInstantDrag = enabled;
    }
    if ("useFilteredPinch" in dragInteractable) {
      dragInteractable.useFilteredPinch = enabled;
    }
    if (!enabled) {
      this.activeInteractor = null;
    }
  }
}
