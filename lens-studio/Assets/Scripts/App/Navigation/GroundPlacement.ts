import { NavigationMarker } from "./NavigationMarker";
import { yawRotationFromPlanarDirection } from "../Utilities/Utilities";
import {
  maybeAdvanceDragHeadingTarget,
  slerpRotationToward,
} from "../Utilities/AnimationUtilities";
import {
  RobotGroundDeadzone,
  SurfaceGroundProbe,
} from "./SurfaceGroundProbe";
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider";

export type { RobotGroundDeadzone };

// ================================================================
/** Ground-ray drag placement: pose input only; nav policy lives in NavigationPlacement. */
// ================================================================

const DRAG_THRESHOLD_CM = 11;
const DRAG_HEADING_MIN_DELTA_CM = 3.0;
const DRAG_HEADING_SMOOTHING_RATE = 8.0;
const INTERPOLATION_SPEED = 10;
const IDLE_NAV_INTERPOLATION_SPEED = 8;
const IDLE_NAV_POSITION_EPSILON_CM = 0.25;
const IDLE_NAV_ROTATION_EPSILON_RAD = 0.01;
const PLACEMENT_ANCHOR_REBASE_DISTANCE_CM = 300;

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
  private readonly worldQueryModule: any;
  private readonly _groundProbe = new SurfaceGroundProbe();

  private _marker: NavigationMarker | null = null;
  private active = false;
  private _isDragging = false;
  private _hasActivatedPlacement = false;
  private _idleAnchor = false;
  private _dragEnabled = false;
  private hitTestSession: any = null;
  private updateEvent: SceneEvent | null = null;
  private activeInteractor: any = null;
  private desiredPosition = vec3.zero();
  private desiredRotation = quat.quatIdentity();
  private touchStartPosition = vec3.zero();
  private _processingButtonPress = false;
  private _previousDragPosition: vec3 | null = null;
  private _headingTarget = quat.quatIdentity();
  private _headingGateOrigin: { x: number; z: number } = { x: 0, z: 0 };
  private _placementAnchor: SceneObject | null = null;
  private _confirmDeferralEvent: DelayedCallbackEvent | null = null;
  private _hitTestDeferralEvent: DelayedCallbackEvent | null = null;
  private _pendingConfirmPosition = vec3.zero();
  private _pendingConfirmRotation = new quat(1, 0, 0, 0);

  constructor(owner: BaseScriptComponent, worldQueryModule: any) {
    this.owner = owner;
    this.worldQueryModule = worldQueryModule;
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
      print("GroundPlacement: start called without attached marker");
      return;
    }
    this.active = true;
    this._isDragging = false;
    this._hasActivatedPlacement = false;
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
    this._hasActivatedPlacement = false;
    this._idleAnchor = false;
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
    return this._hasActivatedPlacement;
  }

  public isActivelyDragging(): boolean {
    return this.activeInteractor !== null;
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
    this._groundProbe.floorY = position.y;
    this.touchStartPosition = this.desiredPosition;
    this._groundProbe.reset(position.y);
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
    this._groundProbe.floorY = position.y;
    this.touchStartPosition = this.desiredPosition;
    this._groundProbe.reset(position.y);
    this._resetHeadingState(this.desiredPosition, rotation);
    if (this._placementAnchor) {
      this._placementAnchor.getTransform().setWorldPosition(position);
    }
    this._marker.setPose(this.desiredPosition, rotation);
  }

  public setRobotGroundDeadzone(deadzone: RobotGroundDeadzone | null): void {
    this._groundProbe.setRobotGroundDeadzone(deadzone);
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
      this.onMarkerButtonPressed?.(this._pendingConfirmPosition, this._pendingConfirmRotation);
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
    this._resetHeadingState(this.desiredPosition, this.desiredRotation);
    if (this._hasActivatedPlacement) {
      this._isDragging = true;
    }
  }

  private _handleDragTriggerEnd(): void {
    this.activeInteractor = null;
    this._isDragging = false;
    this._previousDragPosition = null;
    this._syncDesiredPoseToRenderedPose();
    const resolved = this._groundProbe.resolveDragPoint(
      this.desiredPosition,
      getDeltaTime(),
      this._getCameraWorldPosition(),
    );
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
      const dt = getDeltaTime();
      this.desiredRotation = slerpRotationToward(
        this.desiredRotation,
        this._headingTarget,
        dt,
        DRAG_HEADING_SMOOTHING_RATE,
      );
      this._marker.interpolatePose(
        this.desiredPosition,
        this.desiredRotation,
        INTERPOLATION_SPEED,
        INTERPOLATION_SPEED,
        true,
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
      this._syncDesiredPoseToRenderedPose();
      this._groundProbe.setDragBaseline(this.desiredPosition.y);
      this._activatePlacement();
    }
    if (this._isDragging) {
      this._groundProbe.probeSurfaceY(pointPosition, this.hitTestSession);
      this.desiredPosition = this._groundProbe.resolveDragPoint(
        pointPosition,
        getDeltaTime(),
        this._getCameraWorldPosition(),
      );
      this._updateDragHeading(pointPosition);
    }
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
    this._groundProbe.floorY = this.desiredPosition.y;
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
    this._resetHeadingState(this.desiredPosition, rotation);
    this._groundProbe.reset(position.y);
    this.touchStartPosition = this.desiredPosition;
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
    }
  }

  private _getCameraWorldPosition(): vec3 | null {
    try {
      return WorldCameraFinderProvider.getInstance().getTransform().getWorldPosition();
    } catch {
      return null;
    }
  }
}
