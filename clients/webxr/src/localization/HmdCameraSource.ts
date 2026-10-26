import type { CameraCaptureSource, CameraTrackingSource, ClientClock } from "@dimos-ar-client/websocket/hostPorts";
import type { LocalizationObservation, Quat, Vec3 } from "@dimos-ar-client/websocket/protocolTypes";
import { rotateVecByQuat } from "@dimos-ar-client/localization/clientTrackingTransforms";
import { webxrOpticalToClientTrackingPose } from "../utilities/WebXRCoordinates";
import { reportDiagnostic } from "../diagnostics/BrowserDiagnostics";
import { frameTimeToClientClock } from "../utilities/BrowserClientClock";
import {
  jpegDimensionsMatch,
  requireUsableProfile,
  matchesProfileCamera,
  profileForStream,
  type HmdCalibrationProfile,
  type LiveVideoSettings,
} from "./HmdCalibration";

const POSE_BUFFER_CAPACITY = 360;
const STALE_POSE_S = 0.1;

export type WebxrPoseSample = {
  t: number;
  position: Vec3;
  orientation: Quat;
};

export interface VideoFrameMetadata {
  captureTime?: number;
  presentationTime?: number;
  mediaTime?: number;
  width?: number;
  height?: number;
}

export interface CameraMediaPort {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  enumerateDevices(): Promise<MediaDeviceInfo[]>;
}

export interface FrameCapturePort {
  start(
    video: HTMLVideoElement,
    onFrame: (video: HTMLVideoElement, metadata: VideoFrameMetadata) => void,
  ): void;
  stop(): void;
}

export interface JpegEncoder {
  encode(video: HTMLVideoElement): Promise<{ jpeg: Uint8Array; width: number; height: number }>;
  cancel?(): void;
  dispose?(): void;
}

export function selectFrameTimestamp(metadata: VideoFrameMetadata): number {
  if (typeof metadata.captureTime === "number" && Number.isFinite(metadata.captureTime)) {
    return metadata.captureTime;
  }
  // captureTime is exposure; presentationTime is the next-best browser timestamp when captureTime is absent.
  if (typeof metadata.presentationTime === "number" && Number.isFinite(metadata.presentationTime)) {
    return metadata.presentationTime;
  }
  throw new Error("frame timestamp is missing");
}

export function lookupPoseSample(
  buffer: readonly WebxrPoseSample[],
  ts: number,
): WebxrPoseSample | null {
  if (buffer.length === 0) {
    return null;
  }
  let before: WebxrPoseSample | null = null;
  let after: WebxrPoseSample | null = null;
  for (const sample of buffer) {
    if (sample.t <= ts) {
      before = sample;
    } else if (!after) {
      after = sample;
      break;
    }
  }
  if (before && after && after.t > before.t) {
    if (ts - before.t > STALE_POSE_S || after.t - ts > STALE_POSE_S) return null;
    const alpha = (ts - before.t) / (after.t - before.t);
    return {
      t: ts,
      position: lerpVec3(before.position, after.position, alpha),
      orientation: slerpQuat(before.orientation, after.orientation, alpha),
    };
  }
  const nearest = before ?? after ?? buffer[buffer.length - 1];
  if (Math.abs(nearest.t - ts) > STALE_POSE_S) {
    return null;
  }
  return nearest;
}

type FrozenFrame = { ts: number; pose: WebxrPoseSample; encoded: ReturnType<JpegEncoder["encode"]> };

export class HmdCameraSource implements CameraTrackingSource, CameraCaptureSource {
  private readonly clock: ClientClock;
  private readonly profileOf: () => HmdCalibrationProfile;
  private readonly media: CameraMediaPort;
  private readonly frames: FrameCapturePort;
  private readonly jpeg: JpegEncoder;
  private staleCaptures = 0;
  private readonly performanceNow: () => number;
  private readonly videoFactory: () => HTMLVideoElement;
  private readonly poseBuffer: WebxrPoseSample[] = [];
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private operation = new AbortController();
  private openPromise: Promise<void> | null = null;
  private activeProfile: HmdCalibrationProfile | null = null;
  private waiting: { resolve: (frame: FrozenFrame) => void; reject: (error: unknown) => void } | null = null;

  constructor(deps: {
    clock: ClientClock;
    profile: HmdCalibrationProfile | (() => HmdCalibrationProfile);
    media: CameraMediaPort;
    frames: FrameCapturePort;
    jpeg: JpegEncoder;
    performanceNow?: () => number;
    videoFactory?: () => HTMLVideoElement;
  }) {
    this.clock = deps.clock;
    const profile = deps.profile;
    this.profileOf = typeof profile === "function" ? profile : () => profile;
    this.media = deps.media;
    this.frames = deps.frames;
    this.jpeg = deps.jpeg;
    this.performanceNow = deps.performanceNow ?? (() => performance.now());
    this.videoFactory = deps.videoFactory ?? createVideoElement;
  }

  availabilityError(): string | null {
    try { requireUsableProfile(this.profileOf()); return null; }
    catch (error) { return String(error instanceof Error ? error.message : error); }
  }

  /** Read-only access to the validated localization stream; never opens another camera. */
  previewFrame(): { video: HTMLVideoElement; width: number; height: number } | null {
    if (!this.video || !this.stream || !this.activeProfile) return null;
    return { video: this.video, width: this.activeProfile.stream.width, height: this.activeProfile.stream.height };
  }

  samplePose(position: Vec3, orientation: Quat, timestamp = this.clock.now()): void {
    this.poseBuffer.push({ t: timestamp, position: [...position], orientation: [...orientation] });
    if (this.poseBuffer.length > POSE_BUFFER_CAPACITY) this.poseBuffer.shift();
  }

  clearTracking(): void { this.stop(); this.poseBuffer.length = 0; this.staleCaptures = 0; }

  cameraOptical(): { position: Vec3; orientation: Quat } {
    const latest = this.poseBuffer[this.poseBuffer.length - 1];
    if (!latest || this.clock.now() - latest.t > STALE_POSE_S) throw new Error("no current viewer pose");
    requireUsableProfile(this.profileOf());
    return composeOptical(latest, this.profileOf());
  }

  start(): void { void this.waitUntilOpen().catch(() => {}); }

  async requestPermission(): Promise<void> {
    try { await this.waitUntilOpen(); } finally { this.stop(); }
  }

  async waitUntilOpen(): Promise<void> {
    if (this.openPromise) return this.openPromise;
    if (this.stream && this.activeProfile) return;
    if (this.operation.signal.aborted) this.operation = new AbortController();
    const signal = this.operation.signal;
    const profile = structuredClone(this.profileOf());
    requireUsableProfile(profile);
    const pending = this.openValidatedStream(profile, signal).then(async ({ stream, profile: boundProfile }) => {
      if (signal.aborted) { releaseStream(stream); throw new Error("camera capture cancelled"); }
      this.stream = stream;
      const video = this.videoFactory();
      this.video = video;
      video.srcObject = stream;
      await bounded(video.play(), signal, 10000);
      if (signal.aborted) throw new Error("camera capture cancelled");
      this.activeProfile = boundProfile;
      this.frames.start(video, (nextVideo, metadata) => {
        const waiter = this.waiting;
        if (!waiter || signal.aborted) return;
        this.waiting = null;
        try {
          const ts = frameTimeToClientClock(selectFrameTimestamp(metadata), this.clock, this.performanceNow());
          const pose = lookupPoseSample(this.poseBuffer, ts);
          if (!pose) throw new Error("no viewer pose for capture timestamp");
          // encode() draws synchronously here, before the video advances. The asynchronous
          // JPEG completion cannot change the pixels, timestamp, profile or sampled pose.
          const encoded = this.jpeg.encode(nextVideo);
          waiter.resolve({ ts, pose, encoded });
        } catch (error) {
          waiter.reject(error);
        }
      });
    });
    this.openPromise = pending;
    try { await pending; }
    catch (error) { if (!signal.aborted) this.stop(); throw cameraFailure(error); }
    finally { if (this.openPromise === pending) this.openPromise = null; }
  }

  stop(): void {
    this.operation.abort();
    this.jpeg.cancel?.();
    this.frames.stop();
    this.waiting = null;
    this.openPromise = null;
    this.activeProfile = null;
    if (this.video) {
      this.video.pause?.();
      this.video.srcObject = null;
      this.video = null;
    }
    if (this.stream) releaseStream(this.stream);
    this.stream = null;
  }

  async capture(): Promise<LocalizationObservation> {
    // Take the operation token before opening: stop() must cancel this capture,
    // including while permission or video.play() is pending.
    if (this.operation.signal.aborted) this.operation = new AbortController();
    const signal = this.operation.signal;
    await this.waitUntilOpen();
    const profile = this.activeProfile;
    if (!profile || signal.aborted) throw new Error("headset camera is not started");
    if (this.waiting) throw new Error("camera capture already pending");
    const startedAt = this.performanceNow();
    reportDiagnostic("localization-camera-wait", {});
    const frame = await bounded(new Promise<FrozenFrame>((resolve, reject) => { this.waiting = { resolve, reject }; }), signal, 3000)
      .finally(() => { if (this.operation.signal === signal) this.waiting = null; });
    const frameAt = this.performanceNow();
    const encoded = await bounded(frame.encoded, signal, 5000);
    reportDiagnostic("localization-camera-encoded", { frameWaitMs: frameAt - startedAt, encodeWaitMs: this.performanceNow() - frameAt, jpegBytes: encoded.jpeg.length, tsCapture: frame.ts });
    const captureAgeS = this.clock.now() - frame.ts;
    reportDiagnostic("localization-capture-age", { captureAgeS });
    if (!Number.isFinite(captureAgeS) || captureAgeS < -0.25 || captureAgeS > 1.5) {
      this.staleCaptures++;
      throw Object.assign(new Error("Camera images are arriving too slowly. Keep the headset connected and try again."), { retryable: this.staleCaptures < 3 });
    }
    this.staleCaptures = 0;
    jpegDimensionsMatch(profile, encoded.width, encoded.height);
    const optical = composeOptical(frame.pose, profile);
    return {
      ts_capture: frame.ts,
      jpeg: encoded.jpeg,
      intrinsics: structuredClone(profile.intrinsics),
      camera_position: optical.position,
      camera_orientation: optical.orientation,
    };
  }

  dispose(): void { this.clearTracking(); this.jpeg.dispose?.(); }

  private async openValidatedStream(profile: HmdCalibrationProfile, signal: AbortSignal): Promise<{ stream: MediaStream; profile: HmdCalibrationProfile }> {
    // Required constraints can reject before prompting. Bootstrap permission first;
    // only the explicitly selected physical camera below may supply capture frames.
    const permission = this.media.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    let permissionFinished = false;
    void permission.then(stream => { if (permissionFinished) releaseStream(stream); }, () => {});
    let permissionStream: MediaStream | undefined;
    let devices: MediaDeviceInfo[];
    try {
      permissionStream = await bounded(permission, signal, 30000);
      // Keep a track live until enumeration: device labels may be hidden again
      // after the last track stops when permission was granted only once.
      devices = await bounded(this.media.enumerateDevices(), signal, 5000);
    } finally {
      permissionFinished = true;
      if (permissionStream) releaseStream(permissionStream);
    }
    reportDiagnostic("camera-devices", { model: profile.id, labels: devices.filter(device => device.kind === "videoinput").map(device => device.label) });
    const matching = devices.filter(device => device.kind === "videoinput" &&
      matchesProfileCamera(profile, device.label));
    if (matching.length > 1) throw new Error("Multiple cameras match the left-camera calibration. Camera selection is ambiguous.");
    const selected = matching[0];
    if (!selected?.deviceId) throw new Error(`No camera matches the ${profile.id} left-camera calibration. Cameras found: ${devices.filter(device => device.kind === "videoinput").map(device => device.label || "unnamed").join("; ") || "none"}.`);
    const pending = this.media.getUserMedia({
      video: {
        deviceId: { exact: selected.deviceId },
        width: { exact: profile.stream.width }, height: { ideal: profile.stream.height },
        frameRate: { exact: profile.stream.frameRate }, facingMode: { exact: "environment" },
      }, audio: false,
    });
    void pending.then(stream => { if (signal.aborted) releaseStream(stream); }, () => {});
    const stream = await bounded(pending, signal, 15000);
    try {
      const track = stream.getVideoTracks()[0];
      if (!track || track.label !== selected.label || !matchesProfileCamera(profile, track.label) || /avatar|virtual/i.test(track.label))
        throw new Error("camera identity does not match calibration");
      const settings = track.getSettings();
      if (settings.deviceId !== selected.deviceId) throw new Error("camera device does not match selection");
      const boundProfile = profileForStream(profile, settings as LiveVideoSettings);
      reportDiagnostic("camera-opened", { model: profile.id, camera: track.label, width: settings.width, height: settings.height, frameRate: settings.frameRate });
      return { stream, profile: boundProfile };
    } catch (error) { releaseStream(stream); throw error; }
  }
}

function releaseStream(stream: MediaStream): void { stream.getTracks().forEach(track => track.stop()); }

function bounded<T>(pending: Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => { cleanup(); reject(new Error("camera capture cancelled")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("camera operation timed out")); }, timeoutMs);
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", cancel); };
    // Attach settlement handlers even when already cancelled, to drain late rejections.
    pending.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener("abort", cancel, { once: true });
  });
}

export function composeOptical(pose: WebxrPoseSample, profile: HmdCalibrationProfile): { position: Vec3; orientation: Quat } {
  const extra = profile.T_viewer_optical;
  const offset = rotateVecByQuat(pose.orientation, extra.position);
  return webxrOpticalToClientTrackingPose({
    position: [pose.position[0] + offset[0], pose.position[1] + offset[1], pose.position[2] + offset[2]],
    orientation: quatMultiply(pose.orientation, extra.orientation),
  });
}

function createVideoElement(): HTMLVideoElement {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  return video;
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function slerpQuat(a: Quat, b: Quat, t: number): Quat {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bAdj: Quat = b;
  if (dot < 0) {
    bAdj = [-b[0], -b[1], -b[2], -b[3]];
    dot = -dot;
  }
  if (dot > 0.9995) {
    return normalizeQuatTuple([
      a[0] + (bAdj[0] - a[0]) * t,
      a[1] + (bAdj[1] - a[1]) * t,
      a[2] + (bAdj[2] - a[2]) * t,
      a[3] + (bAdj[3] - a[3]) * t,
    ]);
  }
  const theta = Math.acos(Math.min(1, dot));
  const sinTheta = Math.sin(theta);
  const w1 = Math.sin((1 - t) * theta) / sinTheta;
  const w2 = Math.sin(t * theta) / sinTheta;
  return [
    a[0] * w1 + bAdj[0] * w2,
    a[1] * w1 + bAdj[1] * w2,
    a[2] * w1 + bAdj[2] * w2,
    a[3] * w1 + bAdj[3] * w2,
  ];
}

function normalizeQuatTuple(q: Quat): Quat {
  const length = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

function quatMultiply(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function browserMediaPort(): CameraMediaPort {
  return {
    getUserMedia: (constraints) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        return Promise.reject(new Error("Camera access requires HTTPS and a browser with headset camera support."));
      }
      return navigator.mediaDevices.getUserMedia(constraints);
    },
    enumerateDevices: () => navigator.mediaDevices.enumerateDevices(),
  };
}

export function videoFrameCallbackPort(): FrameCapturePort {
  let handle: number | null = null;
  let videoEl: HTMLVideoElement | null = null;
  return {
    start(video, onFrame) {
      if (typeof video.requestVideoFrameCallback !== "function") {
        throw new Error("This browser cannot synchronize camera frames. Update the Quest browser or Skip localization.");
      }
      videoEl = video;
      const tick: VideoFrameRequestCallback = (_now, metadata) => {
        onFrame(video, {
          captureTime: (metadata as VideoFrameCallbackMetadata & { captureTime?: number }).captureTime,
          presentationTime: metadata.presentationTime,
          mediaTime: metadata.mediaTime,
          width: metadata.width,
          height: metadata.height,
        });
        if (videoEl) {
          handle = video.requestVideoFrameCallback(tick);
        }
      };
      handle = video.requestVideoFrameCallback(tick);
    },
    stop() {
      if (videoEl && handle !== null) {
        videoEl.cancelVideoFrameCallback(handle);
      }
      handle = null;
      videoEl = null;
    },
  };
}


function cameraFailure(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  if (error.name === "NotAllowedError" || error.name === "SecurityError") {
    return new Error("Camera access was denied. Allow camera access for this site and enable Browser's headset camera permission in Quest settings, then retry.");
  }
  if (["NotFoundError", "OverconstrainedError", "NotReadableError"].includes(error.name)) {
    return new Error(`The headset camera could not open (${error.name}). Check Browser's headset camera permission in Quest settings and update Quest Browser, then retry.`);
  }
  return error;
}
