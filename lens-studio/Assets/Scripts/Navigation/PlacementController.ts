import { NavigationMarkerView } from "./NavigationMarkerView";

const DRAG_THRESHOLD_CM = 11;
const INTERPOLATION_SPEED = 8;
const GROUND_NORMAL_MIN_Y = 0.95;
const SURFACE_RAY_START_Y_OFFSET_CM = 120;
const SURFACE_RAY_END_Y_OFFSET_CM = 220;
const GROUND_HEIGHT_SMOOTHING = 0.25;

type PlacementVisualState = "placing" | "executing";

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
  private _smoothedGroundHeight = 0;

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
    this._smoothedGroundHeight = position.y;
    this.desiredPosition = new vec3(position.x, position.y, position.z);
    this.desiredRotation = this._levelRotation(rotation);
    this.touchStartPosition = this.desiredPosition;
    this.renderer.setPose(this.desiredPosition, this.desiredRotation);
    this.renderer.showPlacing();
    this._setDragEnabled(true);
    this._ensureHitTestSession();
    this._ensureUpdateLoop();
  }

  public stop(): void {
    print("PlacementController: stop");
    this.active = false;
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
    this._setDragEnabled(true);
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
      });
    }
    if (dragInteractable?.onTriggerEnd?.add) {
      dragInteractable.onTriggerEnd.add(() => {
        this.activeInteractor = null;
      });
    }
    if (dragInteractable?.onTriggerCanceled?.add) {
      dragInteractable.onTriggerCanceled.add((args: any) => {
        args?.interactor?.clearCurrentInteractable?.();
        this.activeInteractor = null;
      });
    }
    this.renderer.confirmActionButton.onTriggerUp.add(() => {
      if (!this.active) {
        return;
      }
      this._syncDesiredPoseToRenderedPose();
      if (this.visualState === "executing") {
        this.onCancelled?.(this.desiredPosition, this.desiredRotation);
        return;
      }
      this.onConfirmed?.(this.desiredPosition, this.desiredRotation);
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
      this.renderer.interpolatePose(
        this.desiredPosition,
        this.desiredRotation,
        INTERPOLATION_SPEED,
      );
    }
  }

  private _snapCurrentPoseToSurface(): void {
    this._snapPointToSurface(this.desiredPosition);
  }

  private _snapPointToSurface(point: vec3): void {
    if (!this.hitTestSession) {
      return;
    }
    const rayStart = point.add(
      vec3.up().uniformScale(SURFACE_RAY_START_Y_OFFSET_CM),
    );
    const rayEnd = point.add(
      vec3.up().uniformScale(-SURFACE_RAY_END_Y_OFFSET_CM),
    );
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
    const distanceToPlane =
      planeNormal.dot(this.desiredPosition.sub(this.activeInteractor.startPoint)) /
      denominator;
    const pointPosition = this.activeInteractor.startPoint.add(
      interactorDirection.uniformScale(distanceToPlane),
    );
    const dragDistance = pointPosition.distance(this.touchStartPosition);
    if (dragDistance > DRAG_THRESHOLD_CM && !this.isDragging) {
      this.isDragging = true;
    }
    if (this.isDragging) {
      this._snapPointToSurface(pointPosition);
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
    this._smoothedGroundHeight =
      this._smoothedGroundHeight * (1 - GROUND_HEIGHT_SMOOTHING) +
      foundPosition.y * GROUND_HEIGHT_SMOOTHING;
    this.lastGroundHeight = this._smoothedGroundHeight;
    this.desiredPosition = new vec3(
      foundPosition.x,
      this._smoothedGroundHeight,
      foundPosition.z,
    );
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

  private _levelRotation(rotation: quat): quat {
    const forward = rotation.multiplyVec3(vec3.right()); // +X semantic forward
    const distance = Math.sqrt(forward.x * forward.x + forward.z * forward.z);
    if (distance < 0.001) {
      return quat.quatIdentity();
    }
    return this._yawRotation(forward.x / distance, forward.z / distance);
  }

  private _yawRotation(x: number, z: number): quat {
    const yaw = Math.atan2(z, x);
    const halfYaw = yaw * 0.5;
    return new quat(0, Math.sin(halfYaw), 0, Math.cos(halfYaw));
  }

  private _syncDesiredPoseToRenderedPose(): void {
    this.desiredPosition = this.renderer.worldPosition;
    this.lastGroundHeight = this.desiredPosition.y;
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
