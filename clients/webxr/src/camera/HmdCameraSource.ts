import type { CameraCaptureSource, CameraTrackingSource, ClientClock } from "@dimos-ar-client/websocket/hostPorts";
import type { LocalizationObservation, Quat, Vec3 } from "@dimos-ar-client/websocket/protocolTypes";
import { rotateVecByQuat } from "@dimos-ar-client/localization/clientTrackingTransforms";
import { webxrCameraToOpticalPose } from "../coordinates/WebXRCoordinates";
import { frameTimeToClientClock } from "../time/BrowserClientClock";
import {
  jpegDimensionsMatch,
  matchStream,
  requireAcceptedProfile,
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

export class HmdCameraSource implements CameraTrackingSource, CameraCaptureSource {
  private readonly clock: ClientClock;
  private readonly profile: HmdCalibrationProfile;
  private readonly media: CameraMediaPort;
  private readonly frames: FrameCapturePort;
  private readonly jpeg: JpegEncoder;
  private readonly performanceNow: () => number;
  private readonly videoFactory: () => HTMLVideoElement;
  private readonly poseBuffer: WebxrPoseSample[] = [];
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private opening = false;
  private openPromise: Promise<void> | null = null;
  private lastOpenError: string | null = null;
  private latestFrame: { video: HTMLVideoElement; metadata: VideoFrameMetadata } | null = null;
  private waiting: Array<(frame: { video: HTMLVideoElement; metadata: VideoFrameMetadata }) => void> =
    [];

  constructor(deps: {
    clock: ClientClock;
    profile: HmdCalibrationProfile;
    media: CameraMediaPort;
    frames: FrameCapturePort;
    jpeg: JpegEncoder;
    performanceNow?: () => number;
    videoFactory?: () => HTMLVideoElement;
  }) {
    this.clock = deps.clock;
    this.profile = deps.profile;
    this.media = deps.media;
    this.frames = deps.frames;
    this.jpeg = deps.jpeg;
    this.performanceNow = deps.performanceNow ?? (() => performance.now());
    this.videoFactory = deps.videoFactory ?? createVideoElement;
  }

  samplePose(position: Vec3, orientation: Quat): void {
    this.poseBuffer.push({
      t: this.clock.now(),
      position,
      orientation,
    });
    if (this.poseBuffer.length > POSE_BUFFER_CAPACITY) {
      this.poseBuffer.shift();
    }
  }

  cameraOptical(): { position: Vec3; orientation: Quat } {
    if (this.poseBuffer.length === 0) {
      throw new Error("no camera pose sample");
    }
    const latest = this.poseBuffer[this.poseBuffer.length - 1];
    return composeOptical(latest, this.profile);
  }

  start(): void {
    if (this.opening) {
      return;
    }
    this.opening = true;
    void this.openStream().catch((error) => {
      this.opening = false;
      this.lastOpenError = error instanceof Error ? error.message : String(error);
    });
  }

  async prepare(): Promise<void> {
    requireAcceptedProfile(this.profile);
    const stream = await this.openValidatedStream();
    stream.getTracks().forEach((track) => track.stop());
  }

  async waitUntilOpen(): Promise<void> {
    if (this.stream) {
      return;
    }
    if (this.lastOpenError) {
      throw new Error(this.lastOpenError);
    }
    await this.openStream();
  }

  stop(): void {
    this.frames.stop();
    this.waiting = [];
    this.latestFrame = null;
    this.opening = false;
    this.openPromise = null;
    this.lastOpenError = null;
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
  }

  async capture(): Promise<LocalizationObservation> {
    requireAcceptedProfile(this.profile);
    await this.waitUntilOpen();
    if (!this.stream || !this.video) {
      throw new Error("headset camera is not started");
    }
    const frame = await this.nextFrame();
    const frameTimeMs = selectFrameTimestamp(frame.metadata);
    let tsCapture: number;
    try {
      tsCapture = frameTimeToClientClock(frameTimeMs, this.clock, this.performanceNow());
    } catch {
      throw new Error("frame timestamp clock conversion failed");
    }
    const pose = lookupPoseSample(this.poseBuffer, tsCapture);
    if (!pose) {
      throw new Error("no camera pose for capture timestamp");
    }
    const encoded = await this.jpeg.encode(frame.video);
    jpegDimensionsMatch(this.profile, encoded.width, encoded.height);
    const optical = composeOptical(pose, this.profile);
    return {
      ts_capture: tsCapture,
      jpeg: encoded.jpeg,
      intrinsics: { ...this.profile.intrinsics },
      camera_position: optical.position,
      camera_orientation: optical.orientation,
    };
  }

  dispose(): void {
    this.stop();
    this.poseBuffer.length = 0;
  }

  private async openStream(): Promise<void> {
    if (this.stream) {
      return;
    }
    if (this.openPromise) {
      await this.openPromise;
      return;
    }
    this.lastOpenError = null;
    this.openPromise = this.openValidatedStream()
      .then(async (stream) => {
        const video = this.videoFactory();
        video.srcObject = stream;
        await video.play();
        this.stream = stream;
        this.video = video;
        this.frames.start(video, (nextVideo, metadata) => {
          this.latestFrame = { video: nextVideo, metadata };
          const waiters = this.waiting;
          this.waiting = [];
          for (const resolve of waiters) {
            resolve({ video: nextVideo, metadata });
          }
        });
      })
      .finally(() => {
        this.opening = false;
        this.openPromise = null;
      });
    await this.openPromise;
  }

  private async openValidatedStream(): Promise<MediaStream> {
    requireAcceptedProfile(this.profile);
    const devices = await this.media.enumerateDevices();
    if (devices.filter((device) => device.kind === "videoinput").length === 0) {
      throw new Error("no video input devices");
    }
    const stream = await this.media.getUserMedia({
      video: {
        width: { exact: this.profile.stream.width },
        height: { exact: this.profile.stream.height },
        frameRate: { exact: this.profile.stream.frameRate },
        facingMode: this.profile.stream.facingMode,
      },
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((item) => item.stop());
      throw new Error("no video track");
    }
    try {
      matchStream(this.profile, track.getSettings() as LiveVideoSettings);
    } catch (error) {
      stream.getTracks().forEach((item) => item.stop());
      throw error;
    }
    return stream;
  }

  private nextFrame(): Promise<{ video: HTMLVideoElement; metadata: VideoFrameMetadata }> {
    if (this.latestFrame) {
      const frame = this.latestFrame;
      this.latestFrame = null;
      return Promise.resolve(frame);
    }
    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  }
}

export function composeOptical(
  pose: WebxrPoseSample,
  profile: HmdCalibrationProfile,
): { position: Vec3; orientation: Quat } {
  const camera = webxrCameraToOpticalPose({
    position: pose.position,
    orientation: pose.orientation,
  });
  const extra = profile.T_tracking_optical;
  return {
    position: [
      camera.position[0] + rotateVecByQuat(camera.orientation, extra.position)[0],
      camera.position[1] + rotateVecByQuat(camera.orientation, extra.position)[1],
      camera.position[2] + rotateVecByQuat(camera.orientation, extra.position)[2],
    ],
    orientation: quatMultiply(camera.orientation, extra.orientation),
  };
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
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    enumerateDevices: () => navigator.mediaDevices.enumerateDevices(),
  };
}

export function videoFrameCallbackPort(): FrameCapturePort {
  let handle: number | null = null;
  let videoEl: HTMLVideoElement | null = null;
  return {
    start(video, onFrame) {
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

export function canvasJpegEncoder(quality = 0.85): JpegEncoder {
  return {
    async encode(video) {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("2D canvas is required for JPEG encode");
      }
      ctx.drawImage(video, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (value) => {
            if (!value) {
              reject(new Error("JPEG encode failed"));
              return;
            }
            resolve(value);
          },
          "image/jpeg",
          quality,
        );
      });
      return {
        jpeg: new Uint8Array(await blob.arrayBuffer()),
        width: canvas.width,
        height: canvas.height,
      };
    },
  };
}
