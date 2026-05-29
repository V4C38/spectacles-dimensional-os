type PlacementMode = "manualAlignment" | "navGoal";

export class PlacementController {
  public onPreview: ((position: vec3, rotation: quat, mode: PlacementMode) => void) | null = null;
  public onConfirmed: ((position: vec3, rotation: quat, mode: PlacementMode) => void) | null = null;

  private readonly owner: BaseScriptComponent;
  private readonly worldQueryModule: any;
  private readonly gestureModule: any;
  private readonly rayOrigin: SceneObject | null;

  private active = false;
  private mode: PlacementMode = "navGoal";
  private hitTestSession: any = null;
  private updateEvent: SceneEvent | null = null;
  private currentPosition: vec3 | null = null;
  private currentRotation: quat | null = null;

  constructor(
    owner: BaseScriptComponent,
    worldQueryModule: any,
    gestureModule: any,
    rayOrigin: SceneObject | null,
  ) {
    this.owner = owner;
    this.worldQueryModule = worldQueryModule;
    this.gestureModule = gestureModule;
    this.rayOrigin = rayOrigin;
    this._bindPinchEvents();
  }

  public start(mode: PlacementMode): void {
    this.mode = mode;
    this.active = true;
    this._ensureHitTestSession();
    this._ensureUpdateLoop();
  }

  public stop(): void {
    this.active = false;
    this.currentPosition = null;
    this.currentRotation = null;
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

  private _bindPinchEvents(): void {
    if (!this.gestureModule || typeof this.gestureModule.getFilteredPinchDownEvent !== "function") {
      return;
    }
    const handTypeEnum = this.gestureModule.HandType ?? {};
    const leftHand = handTypeEnum.Left ?? 0;
    const rightHand = handTypeEnum.Right ?? 1;
    const bind = (handType: number) => {
      const event = this.gestureModule.getFilteredPinchDownEvent(handType as any);
      if (event && typeof event.add === "function") {
        event.add(() => this._confirmPlacement());
      }
    };
    bind(leftHand);
    bind(rightHand);
  }

  private _ensureHitTestSession(): void {
    if (this.hitTestSession || !this.worldQueryModule) {
      return;
    }
    if (typeof this.worldQueryModule.createHitTestSession === "function") {
      this.hitTestSession = this.worldQueryModule.createHitTestSession();
      if (this.hitTestSession && typeof this.hitTestSession.start === "function") {
        this.hitTestSession.start();
      }
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
    if (!this.active || !this.hitTestSession || !this.rayOrigin) {
      return;
    }
    const transform = this.rayOrigin.getTransform();
    const origin = transform.getWorldPosition();
    const forward = transform.forward;
    const rayEnd = new vec3(
      origin.x + forward.x * 200,
      origin.y + forward.y * 200,
      origin.z + forward.z * 200,
    );

    const maybeResults = this.hitTestSession.hitTest(
      origin,
      rayEnd,
      (results: any) => this._consumeHitResults(results, forward),
    );
    if (Array.isArray(maybeResults)) {
      this._consumeHitResults(maybeResults, forward);
    }
  }

  private _consumeHitResults(results: any, forward: vec3): void {
    if (!results || !results.length) {
      return;
    }
    const first = results[0];
    const position = first.position ?? first.hit?.position ?? null;
    if (!position) {
      return;
    }

    const planarForward = new vec3(forward.x, 0, forward.z);
    const planarLength = Math.sqrt(
      planarForward.x * planarForward.x + planarForward.z * planarForward.z,
    );
    const direction = planarLength > 0.001
      ? new vec3(planarForward.x / planarLength, 0, planarForward.z / planarLength)
      : new vec3(1, 0, 0);
    const yaw = Math.atan2(direction.z, direction.x);
    const halfYaw = yaw * 0.5;
    const rotation = new quat(0, Math.sin(halfYaw), 0, Math.cos(halfYaw));

    this.currentPosition = new vec3(position.x, position.y, position.z);
    this.currentRotation = rotation;
    this.onPreview?.(this.currentPosition, this.currentRotation, this.mode);
  }

  private _confirmPlacement(): void {
    if (!this.active || !this.currentPosition || !this.currentRotation) {
      return;
    }
    this.onConfirmed?.(this.currentPosition, this.currentRotation, this.mode);
    this.stop();
  }
}
