import type { CameraCaptureSource,CameraTrackingSource } from "../../DimOSARClient/websocket/hostPorts";
import type { Intrinsics,LocalizationObservation,Quat,Vec3 } from "../../DimOSARClient/websocket/protocolTypes";
import { specsToClientTrackingPose } from "../utilities/SpecsCoordinates";
import { quatFromMat4Rotation } from "../utilities/SpecsUtilities";
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
  private readonly poseBuffer: PoseSample[] = [];
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
    this.poseBuffer.push({
      t: getTime(),
      position: transform.getWorldPosition(),
      rotation: transform.getWorldRotation(),
    });
    if (this.poseBuffer.length > POSE_BUFFER_CAPACITY) {
      this.poseBuffer.shift();
    }
  }

  clearTracking(): void { this.poseBuffer.length = 0; }

  trackingPosition(): Vec3 {
    const latest = this.poseBuffer[this.poseBuffer.length - 1];
    if (!latest || getTime() - latest.t > STALE_POSE_S) throw new Error("no current headset pose");
    return specsWorldPoseToTracking(latest.position, latest.rotation).position;
  }

  cameraOptical(): { position: Vec3; orientation: Quat } {
    if (this.poseBuffer.length === 0) {
      throw new Error("no camera pose sample");
    }
    const latest = this.poseBuffer[this.poseBuffer.length - 1];
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
    const pose = lookupPoseSample(this.poseBuffer, frame.timestampSeconds);
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

export function lookupPoseSample(buffer: readonly PoseSample[], ts: number): PoseSample | null {
  if (buffer.length === 0) {
    return null;
  }
  let before: PoseSample | null = null;
  let after: PoseSample | null = null;
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
      position: vec3.lerp(before.position, after.position, alpha),
      rotation: quat.slerp(before.rotation, after.rotation, alpha),
    };
  }
  const nearest = before ?? after ?? buffer[buffer.length - 1];
  if (Math.abs(nearest.t - ts) > STALE_POSE_S) {
    return null;
  }
  return nearest;
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
  return {
    position: devicePose.position.add(devicePose.rotation.multiplyVec3(extrinsicPos)),
    rotation: devicePose.rotation.multiply(extrinsicRot),
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
