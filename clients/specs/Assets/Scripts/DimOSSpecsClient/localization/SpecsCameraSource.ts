import { composePose } from "DimOSARClient.lspkg/Scripts/DimOSARClient/localization/ClientTracking";
import { CapturePoseHistory, lookupPoseSample as lookupSharedPose, type PoseSample as TrackingPoseSample } from "DimOSARClient.lspkg/Scripts/DimOSARClient/localization/CapturePoseHistory";
import type { CameraCaptureSource, CameraTrackingSource, Intrinsics, LocalizationObservation, Quat, Vec3 } from "DimOSARClient.lspkg/Scripts/DimOSARClient/ClientContracts";

import { specsToClientTrackingPose, quatFromMat4Rotation } from "../utilities/SpecsCoordinates";

import type { SpecsCameraStream } from "./SpecsCameraStream";

const POSE_BUFFER_CAPACITY = 360;
const STALE_POSE_S = 0.1;

export type PoseSample = {
  t: number;
  position: vec3;
  rotation: quat;
};

export class SpecsCameraSource implements CameraTrackingSource, CameraCaptureSource {
  private readonly stream: Pick<SpecsCameraStream, "start" | "stop" | "requestNextFrame" | "deviceCamera">;
  private readonly cameraObject: SceneObject;
  private readonly poseHistory = new CapturePoseHistory(POSE_BUFFER_CAPACITY, { maxNearestAgeS: STALE_POSE_S, maxBracketAgeS: Infinity });
  private generation = 0;
  private encoding: Promise<Uint8Array> | null = null;
  private readonly metrics = { captures: 0, encodes: 0, discarded: 0, jpegBytes: 0, encodeMs: 0, inFlight: 0, maxInFlight: 0 };
  diagnostics() { return { ...this.metrics }; }
  private readonly pending = new Set<(error: Error) => void>();

  constructor(deps: { stream: Pick<SpecsCameraStream, "start" | "stop" | "requestNextFrame" | "deviceCamera">; cameraObject: SceneObject }) {
    if (!deps.cameraObject) {
      throw new Error("cameraObject is required");
    }
    this.stream = deps.stream;
    this.cameraObject = deps.cameraObject;
  }

  samplePose(): void {
    const transform = this.cameraObject.getTransform();
    const position = transform.getWorldPosition();
    const rotation = transform.getWorldRotation();
    this.poseHistory.sample({ t: getTime(), position: [position.x, position.y, position.z], orientation: [rotation.x, rotation.y, rotation.z, rotation.w] });
  }

  clearTracking(): void { this.poseHistory.clear(); }

  trackingPosition(): Vec3 {
    const sample = this.poseHistory.latest();
    const latest = sample ? nativePoseSample(sample) : null;
    if (!latest || getTime() - latest.t > STALE_POSE_S) throw new Error("no current headset pose");
    return specsWorldPoseToTracking(latest.position, latest.rotation).position;
  }

  cameraOptical(): { position: Vec3; orientation: Quat } {
    if (!this.poseHistory.latest()) {
      throw new Error("no camera pose sample");
    }
    const latest = nativePoseSample(this.poseHistory.latest()!);
    const optical = composeDeviceOptical(latest, this.ensureDeviceCamera()?.pose ?? null);
    return specsCameraOpticalPoseToTracking(optical.position, optical.rotation);
  }

  start(): void {
    this.stream.start();
  }

  stop(): void {
    this.generation++;
    for (const reject of this.pending) reject(new Error("Camera capture stopped"));
    this.pending.clear();
    this.stream.stop();
  }

  private ensureDeviceCamera(): DeviceCamera | null {
    if (this.stream.deviceCamera) {
      return this.stream.deviceCamera;
    }
    return global.deviceInfoSystem.getTrackingCameraForId(CameraModule.CameraId.Default_Color);
  }

  capture(canEncode: () => boolean = () => true): Promise<LocalizationObservation> {
    this.metrics.captures++;
    const generation = this.generation;
    return new Promise((resolve, reject) => {
      this.pending.add(reject);
      void this.captureFrame(generation, canEncode).then(
        observation => { this.pending.delete(reject); resolve(observation); },
        error => { this.pending.delete(reject); reject(error); },
      );
    });
  }

  private async captureFrame(generation: number, canEncode: () => boolean): Promise<LocalizationObservation> {
    // A cancelled native JPEG operation cannot be aborted. Serialize the next
    // generation behind it, then request NEW pixels rather than retaining a frame.
    if (this.encoding) await this.encoding.catch(() => undefined);
    const eligible = () => generation === this.generation && canEncode();
    if (!eligible()) { this.metrics.discarded++; throw new Error("Camera capture no longer eligible"); }
    const frame = await this.stream.requestNextFrame();
    if (generation !== this.generation) throw new Error("Camera capture stopped");
    if (!Number.isFinite(frame.timestampSeconds) || frame.timestampSeconds <= 0) {
      throw new Error("Camera frame is missing a valid exposure timestamp");
    }
    const sample = this.poseHistory.read(frame.timestampSeconds);
    const pose = sample ? nativePoseSample(sample) : null;
    if (!pose) {
      throw new Error("no camera pose for capture timestamp");
    }
    const deviceCamera = this.ensureDeviceCamera();
    if (!deviceCamera) {
      throw new Error("DeviceCamera is required");
    }
    const optical = composeDeviceOptical(pose, deviceCamera.pose);
    const tracking = specsCameraOpticalPoseToTracking(optical.position, optical.rotation);
    const intrinsics = scaleCameraIntrinsics(deviceCamera, frame.texture);
    if (!eligible()) { this.metrics.discarded++; throw new Error("Camera capture no longer eligible"); }
    if (this.encoding) {
      await this.encoding.catch(() => undefined);
      return this.captureFrame(generation, canEncode);
    }
    const started = getTime();
    this.metrics.encodes++; this.metrics.inFlight++;
    this.metrics.maxInFlight = Math.max(this.metrics.maxInFlight, this.metrics.inFlight);
    const encoding = encodeJpeg(frame.texture); this.encoding = encoding;
    let jpeg: Uint8Array;
    try { jpeg = await encoding; }
    finally {
      this.metrics.inFlight--; this.metrics.encodeMs += Math.max(0, getTime() - started) * 1000;
      if (this.encoding === encoding) this.encoding = null;
    }
    this.metrics.jpegBytes += jpeg.length;
    if (!eligible()) { this.metrics.discarded++; throw new Error("Camera capture no longer eligible"); }
    if (generation !== this.generation) throw new Error("Camera capture stopped");
    return {
      ts_capture: frame.timestampSeconds,
      jpeg,
      intrinsics,
      camera_position: tracking.position,
      camera_orientation: tracking.orientation,
    };
  }
}

function nativePoseSample(sample: { t: number; position: readonly number[]; orientation: readonly number[] }): PoseSample {
  return { t: sample.t, position: new vec3(...sample.position as [number, number, number]),
    rotation: new quat(sample.orientation[3], sample.orientation[0], sample.orientation[1], sample.orientation[2]) };
}

export function lookupPoseSample(buffer: readonly PoseSample[], ts: number): PoseSample | null {
  const samples: TrackingPoseSample[] = buffer.map(sample => ({ t: sample.t,
    position: [sample.position.x, sample.position.y, sample.position.z],
    orientation: [sample.rotation.x, sample.rotation.y, sample.rotation.z, sample.rotation.w] }));
  const sample = lookupSharedPose(samples, ts, { maxNearestAgeS: STALE_POSE_S, maxBracketAgeS: Infinity });
  return sample ? nativePoseSample(sample) : null;
}

export function scaleCameraIntrinsics(deviceCamera: DeviceCamera, texture: Texture): Intrinsics {
  const frameWidth = texture.getWidth();
  const frameHeight = texture.getHeight();
  const nativeRes = deviceCamera.resolution;
  const scaleX = nativeRes.x > 0 ? frameWidth / nativeRes.x : 1;
  const scaleY = nativeRes.y > 0 ? frameHeight / nativeRes.y : 1;
  return {
    fx: deviceCamera.focalLength.x * scaleX,
    fy: deviceCamera.focalLength.y * scaleY,
    cx: deviceCamera.principalPoint.x * scaleX,
    cy: deviceCamera.principalPoint.y * scaleY,
    width: frameWidth,
    height: frameHeight,
    distortion_model: "none",
    distortion: [],
  };
}

export function composeDeviceOptical(
  devicePose: PoseSample,
  extrinsic: mat4 | null,
): { position: vec3; rotation: quat } {
  if (!extrinsic) {
    return { position: devicePose.position, rotation: devicePose.rotation };
  }
  const extrinsicPos = new vec3(extrinsic.column3.x, extrinsic.column3.y, extrinsic.column3.z);
  const extrinsicRot = quatFromMat4Rotation(extrinsic);
  const composed = composePose({
    position: [devicePose.position.x, devicePose.position.y, devicePose.position.z],
    orientation: [devicePose.rotation.x, devicePose.rotation.y, devicePose.rotation.z, devicePose.rotation.w],
  }, {
    position: [extrinsicPos.x, extrinsicPos.y, extrinsicPos.z],
    orientation: [extrinsicRot.x, extrinsicRot.y, extrinsicRot.z, extrinsicRot.w],
  });
  return {
    position: new vec3(...composed.position),
    rotation: new quat(composed.orientation[3], composed.orientation[0], composed.orientation[1], composed.orientation[2]),
  };
}

export function specsWorldPoseToTracking(
  position: vec3,
  rotation: quat,
): { position: Vec3; orientation: Quat } {
  return specsToClientTrackingPose({
    position: [position.x, position.y, position.z],
    orientation: [rotation.x, rotation.y, rotation.z, rotation.w],
  });
}

export function specsCameraOpticalPoseToTracking(
  position: vec3,
  rotation: quat,
): { position: Vec3; orientation: Quat } {
  const tracking = specsWorldPoseToTracking(position, rotation);
  // A world-pose basis change conjugates R. A camera pose instead keeps the
  // optical local axes: R_tracking_optical = P^-1 R_lens_camera diag(1,-1,-1).
  // Undo the local basis change and convert GL camera axes to optical axes.
  const [x, y, z, w] = tracking.orientation;
  const optical = new quat(w, x, y, z).multiply(new quat(0.5, -0.5, 0.5, -0.5));
  return {
    position: tracking.position,
    orientation: [optical.x, optical.y, optical.z, optical.w],
  };
}

export function encodeJpeg(texture: Texture): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    Base64.encodeTextureAsync(
      texture,
      (base64: string) => {
        const decoded = Base64.decode(base64);
        if (decoded instanceof Uint8Array) {
          resolve(decoded);
          return;
        }
        const binaryStr = decoded as string;
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        resolve(bytes);
      },
      () => reject(new Error("JPEG encode failed")),
      CompressionQuality.IntermediateQuality,
      EncodingType.Jpg,
    );
  });
}
