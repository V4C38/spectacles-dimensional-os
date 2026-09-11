const CAMERA_STREAM_SMALLER_DIM = 756;
const PC_PREVIEW_MAX_SMALLER_DIM = 682;

export interface SpecsCameraStreamFrame {
  texture: Texture;
  timestampSeconds: number;
}

export function clampCameraSmallerDimension(
  requested: number,
  supportedResolutions: { x: number; y: number }[],
): number {
  if (requested <= 0) {
    return requested;
  }
  let maxSmaller = 0;
  for (const res of supportedResolutions) {
    const smaller = Math.min(res.x, res.y);
    if (smaller > maxSmaller) {
      maxSmaller = smaller;
    }
  }
  if (maxSmaller <= 0) {
    return requested;
  }
  return Math.min(requested, maxSmaller);
}

export class SpecsCameraStream {
  private static instance: SpecsCameraStream | null = null;

  static getInstance(): SpecsCameraStream {
    if (!SpecsCameraStream.instance) {
      SpecsCameraStream.instance = new SpecsCameraStream();
    }
    return SpecsCameraStream.instance;
  }

  private readonly cameraModule: CameraModule = require("LensStudio:CameraModule") as CameraModule;
  private deviceCameraValue: DeviceCamera | null = null;
  private texture: Texture | null = null;
  private provider: CameraTextureProvider | null = null;
  private frameRegistration: EventRegistration | null = null;
  private latestFrame: SpecsCameraStreamFrame | null = null;
  private pendingResolvers: {
    resolve: (frame: SpecsCameraStreamFrame) => void;
    reject: (error: Error) => void;
  }[] = [];
  private running = false;
  private loggedFirstFrameSize = false;

  private constructor() {}

  start(options?: { imageSmallerDimension?: number }): void {
    if (this.running) {
      return;
    }
    // Defer DeviceCamera lookup to start() so it is never called before components are awake.
    if (!this.deviceCameraValue) {
      this.deviceCameraValue = global.deviceInfoSystem.getTrackingCameraForId(
        CameraModule.CameraId.Default_Color,
      );
    }
    const requestedDim = options?.imageSmallerDimension ?? CAMERA_STREAM_SMALLER_DIM;
    const dim = this.requestCameraWithFallback(requestedDim);
    this.provider = this.texture!.control as CameraTextureProvider;
    this.frameRegistration = this.provider.onNewFrame.add((frame: CameraFrame) => this.onNewFrame(frame));
    this.running = true;
    this.loggedFirstFrameSize = false;
    print(`SpecsCameraStream: started (imageSmallerDimension=${dim})`);
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    if (this.frameRegistration !== null && this.provider !== null) {
      this.provider.onNewFrame.remove(this.frameRegistration);
      this.frameRegistration = null;
    }
    this.provider = null;
    this.texture = null;
    this.latestFrame = null;
    this.running = false;
    const pending = this.pendingResolvers.splice(0);
    for (const waiter of pending) {
      waiter.reject(new Error("SpecsCameraStream stopped"));
    }
    print("SpecsCameraStream: stopped");
  }

  isRunning(): boolean {
    return this.running;
  }

  requestNextFrame(): Promise<SpecsCameraStreamFrame> {
    return new Promise<SpecsCameraStreamFrame>((resolve, reject) => {
      this.pendingResolvers.push({ resolve, reject });
    });
  }

  get deviceCamera(): DeviceCamera | null {
    return this.deviceCameraValue;
  }

  private resolveImageSmallerDimension(requested: number): number {
    if (requested <= 0) {
      return requested;
    }
    try {
      const supported = this.cameraModule.getSupportedImageResolutions();
      const clamped = clampCameraSmallerDimension(requested, supported);
      if (clamped !== requested) {
        print(`SpecsCameraStream: clamping imageSmallerDimension ${requested} -> ${clamped}`);
      }
      return clamped;
    } catch (error) {
      print(
        `SpecsCameraStream: getSupportedImageResolutions failed (${String(error)}); using PC preview fallback ${PC_PREVIEW_MAX_SMALLER_DIM}`,
      );
      return Math.min(requested, PC_PREVIEW_MAX_SMALLER_DIM);
    }
  }

  private requestCameraWithFallback(requestedDim: number): number {
    const candidates = this.imageSmallerDimensionCandidates(requestedDim);
    let lastError: unknown = null;
    for (const dim of candidates) {
      const req = CameraModule.createCameraRequest();
      req.cameraId = CameraModule.CameraId.Default_Color;
      if (dim > 0) {
        req.imageSmallerDimension = dim;
      }
      try {
        this.texture = this.cameraModule.requestCamera(req);
        if (dim !== requestedDim) {
          print(
            `SpecsCameraStream: requestCamera succeeded at imageSmallerDimension=${dim} (requested ${requestedDim})`,
          );
        }
        return dim;
      } catch (error) {
        lastError = error;
        print(`SpecsCameraStream: requestCamera failed at imageSmallerDimension=${dim} (${String(error)})`);
      }
    }
    throw lastError ?? new Error("SpecsCameraStream: requestCamera failed");
  }

  private imageSmallerDimensionCandidates(requestedDim: number): number[] {
    const primary = this.resolveImageSmallerDimension(requestedDim);
    const fallback = primary > PC_PREVIEW_MAX_SMALLER_DIM ? PC_PREVIEW_MAX_SMALLER_DIM : 0;
    const candidates = [primary];
    if (fallback > 0 && fallback !== primary) {
      candidates.push(fallback);
    }
    return candidates;
  }

  private onNewFrame(frame: CameraFrame): void {
    const rawTs = frame.timestampSeconds;
    const ts =
      typeof rawTs === "number" && Number.isFinite(rawTs) && rawTs > 0 ? rawTs : getTime();
    const streamFrame: SpecsCameraStreamFrame = {
      texture: this.texture!,
      timestampSeconds: ts,
    };
    this.latestFrame = streamFrame;
    if (!this.loggedFirstFrameSize) {
      this.loggedFirstFrameSize = true;
      print(
        `SpecsCameraStream: first frame texture=${streamFrame.texture.getWidth()}x${streamFrame.texture.getHeight()}`,
      );
    }
    if (this.pendingResolvers.length > 0) {
      const waiters = this.pendingResolvers.splice(0);
      for (const waiter of waiters) {
        waiter.resolve(streamFrame);
      }
    }
  }
}
