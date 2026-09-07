import { clampCameraSmallerDimension } from "../../App/Utilities/Utilities";

// Target smaller dimension for the camera stream in pixels (Spectacles hardware).
// PC preview supports a lower max; start() clamps via getSupportedImageResolutions().
const CAMERA_STREAM_SMALLER_DIM = 756;
// Lens Studio PC preview rejects requests above this even when resolution query fails.
const PC_PREVIEW_MAX_SMALLER_DIM = 682;

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
  private _pendingResolvers: {
    resolve: (frame: DeviceCameraStreamFrame) => void;
    reject: (error: Error) => void;
  }[] = [];
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
    const requestedDim = options?.imageSmallerDimension ?? CAMERA_STREAM_SMALLER_DIM;
    const dim = this._requestCameraWithFallback(requestedDim);
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
    const pending = this._pendingResolvers.splice(0);
    for (const waiter of pending) {
      waiter.reject(new Error("DeviceCameraStream stopped"));
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
    return new Promise<DeviceCameraStreamFrame>((resolve, reject) => {
      this._pendingResolvers.push({ resolve, reject });
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

  private _resolveImageSmallerDimension(requested: number): number {
    if (requested <= 0) {
      return requested;
    }
    try {
      const supported = this._cameraModule.getSupportedImageResolutions();
      const clamped = clampCameraSmallerDimension(requested, supported);
      if (clamped !== requested) {
        print(
          `DeviceCameraStream: clamping imageSmallerDimension ${requested} -> ${clamped}`,
        );
      }
      return clamped;
    } catch (error) {
      print(
        `DeviceCameraStream: getSupportedImageResolutions failed (${String(error)}); using PC preview fallback ${PC_PREVIEW_MAX_SMALLER_DIM}`,
      );
      return Math.min(requested, PC_PREVIEW_MAX_SMALLER_DIM);
    }
  }

  private _requestCameraWithFallback(requestedDim: number): number {
    const candidates = this._imageSmallerDimensionCandidates(requestedDim);
    let lastError: unknown = null;
    for (const dim of candidates) {
      const req = CameraModule.createCameraRequest();
      req.cameraId = CameraModule.CameraId.Default_Color;
      if (dim > 0) {
        req.imageSmallerDimension = dim;
      }
      try {
        this._texture = this._cameraModule.requestCamera(req);
        if (dim !== requestedDim) {
          print(
            `DeviceCameraStream: requestCamera succeeded at imageSmallerDimension=${dim} (requested ${requestedDim})`,
          );
        }
        return dim;
      } catch (error) {
        lastError = error;
        print(
          `DeviceCameraStream: requestCamera failed at imageSmallerDimension=${dim} (${String(error)})`,
        );
      }
    }
    throw lastError ?? new Error("DeviceCameraStream: requestCamera failed");
  }

  private _imageSmallerDimensionCandidates(requestedDim: number): number[] {
    const primary = this._resolveImageSmallerDimension(requestedDim);
    const fallback =
      primary > PC_PREVIEW_MAX_SMALLER_DIM ? PC_PREVIEW_MAX_SMALLER_DIM : 0;
    const candidates = [primary];
    if (fallback > 0 && fallback !== primary) {
      candidates.push(fallback);
    }
    return candidates;
  }

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
      const waiters = this._pendingResolvers.splice(0);
      for (const waiter of waiters) {
        waiter.resolve(streamFrame);
      }
    }
  }
}
