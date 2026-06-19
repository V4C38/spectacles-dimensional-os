// Smaller dimension for the camera stream in pixels (Spectacles max supported).
const CAMERA_STREAM_SMALLER_DIM = 756;

export interface DeviceCameraStreamFrame {
  texture: Texture;
  timestampSeconds: number;
}

/**
 * Singleton accessor for the Spectacles colour camera stream.
 *
 * Usage:
 *   const cam = DeviceCameraStream.getInstance();
 *   cam.start();                         // idempotent — safe to call multiple times
 *   const frame = await cam.requestNextFrame();
 *   cam.deviceCamera                     // DeviceCamera intrinsics / extrinsics
 */
export class DeviceCameraStream {
  private static _instance: DeviceCameraStream | null = null;

  public static getInstance(): DeviceCameraStream {
    if (!DeviceCameraStream._instance) {
      DeviceCameraStream._instance = new DeviceCameraStream();
    }
    return DeviceCameraStream._instance;
  }

  private readonly _cameraModule: CameraModule =
    require("LensStudio:CameraModule") as CameraModule;
  private _deviceCamera: DeviceCamera | null = null;
  private _texture: Texture | null = null;
  private _provider: CameraTextureProvider | null = null;
  private _frameRegistration: EventRegistration | null = null;
  private _latestFrame: DeviceCameraStreamFrame | null = null;
  private _pendingResolvers: ((frame: DeviceCameraStreamFrame) => void)[] = [];
  private _running = false;
  private _loggedFirstFrameSize = false;

  private constructor() {}

  // ── Public API ─────────────────────────────────────────────────

  /** Start the camera stream. Idempotent — safe to call before first use or after stop(). */
  public start(options?: { imageSmallerDimension?: number }): void {
    if (this._running) {
      return;
    }
    // Defer DeviceCamera lookup to start() so it is never called before components are awake.
    if (!this._deviceCamera) {
      this._deviceCamera = global.deviceInfoSystem.getTrackingCameraForId(
        CameraModule.CameraId.Default_Color,
      );
    }
    const req = CameraModule.createCameraRequest();
    req.cameraId = CameraModule.CameraId.Default_Color;
    const dim = options?.imageSmallerDimension ?? CAMERA_STREAM_SMALLER_DIM;
    if (dim > 0) {
      req.imageSmallerDimension = dim;
    }
    this._texture = this._cameraModule.requestCamera(req);
    this._provider = this._texture.control as CameraTextureProvider;
    this._frameRegistration = this._provider.onNewFrame.add(
      (frame: CameraFrame) => this._onNewFrame(frame),
    );
    this._running = true;
    this._loggedFirstFrameSize = false;
    print(
      `DeviceCameraStream: started (imageSmallerDimension=${dim})`,
    );
  }

  /** Tear down the stream. The singleton can be restarted with start(). */
  public stop(): void {
    if (!this._running) {
      return;
    }
    if (this._frameRegistration !== null && this._provider !== null) {
      this._provider.onNewFrame.remove(this._frameRegistration);
      this._frameRegistration = null;
    }
    this._provider = null;
    this._texture = null;
    this._latestFrame = null;
    this._running = false;
    // Reject any pending requestNextFrame callers so they don't hang.
    const pending = this._pendingResolvers.splice(0);
    for (const resolve of pending) {
      void resolve;
    }
    print("DeviceCameraStream: stopped");
  }

  public isRunning(): boolean {
    return this._running;
  }

  /** The most recently received camera texture, or null before the first frame. */
  public getCurrentTexture(): Texture | null {
    return this._latestFrame?.texture ?? null;
  }

  /** The `timestampSeconds` of the most recently received frame, or 0 before the first frame. */
  public getLatestTimestamp(): number {
    return this._latestFrame?.timestampSeconds ?? 0;
  }

  /**
   * Promise that resolves on the next frame delivered by onNewFrame.
   */
  public requestNextFrame(): Promise<DeviceCameraStreamFrame> {
    return new Promise<DeviceCameraStreamFrame>((resolve) => {
      this._pendingResolvers.push(resolve);
    });
  }

  /**
   * DeviceCamera provides intrinsics (focalLength, principalPoint, resolution)
   * and extrinsics (pose = T_device_camera).
   */
  public get deviceCamera(): DeviceCamera | null {
    return this._deviceCamera;
  }

  // ── Internal ────────────────────────────────────────────────────

  private _onNewFrame(frame: CameraFrame): void {
    const rawTs = frame.timestampSeconds;
    const ts =
      typeof rawTs === "number" && Number.isFinite(rawTs) && rawTs > 0
        ? rawTs
        : getTime();
    const streamFrame: DeviceCameraStreamFrame = {
      texture: this._texture!,
      timestampSeconds: ts,
    };
    this._latestFrame = streamFrame;
    if (!this._loggedFirstFrameSize) {
      this._loggedFirstFrameSize = true;
      print(
        `DeviceCameraStream: first frame texture=${streamFrame.texture.getWidth()}x${streamFrame.texture.getHeight()}`,
      );
    }

    if (this._pendingResolvers.length > 0) {
      const resolvers = this._pendingResolvers.splice(0);
      for (const resolve of resolvers) {
        resolve(streamFrame);
      }
    }
  }
}
