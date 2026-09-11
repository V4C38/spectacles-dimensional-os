import type { CameraCaptureSource, CameraTrackingSource } from "../core/websocket/hostPorts";
import type { Intrinsics, LocalizationObservation, Quat, Vec3 } from "../core/websocket/protocolTypes";
import { specsToClientTrackingPose } from "../SpecsCoordinates";
import type { SpecsCameraStream } from "./SpecsCameraStream";

const POSE_BUFFER_CAPACITY = 360;
const STALE_POSE_S = 0.1;

export type PoseSample = {
  t: number;
  position: vec3;
  rotation: quat;
};

export class SpecsCameraSource implements CameraTrackingSource, CameraCaptureSource {
  private readonly stream: SpecsCameraStream;
  private readonly cameraObject: SceneObject;
  private readonly poseBuffer: PoseSample[] = [];

  constructor(deps: { stream: SpecsCameraStream; cameraObject: SceneObject }) {
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

  cameraOptical(): { position: Vec3; orientation: Quat } {
    if (this.poseBuffer.length === 0) {
      throw new Error("no camera pose sample");
    }
    const latest = this.poseBuffer[this.poseBuffer.length - 1];
    const optical = composeDeviceOptical(latest, this.ensureDeviceCamera()?.pose ?? null);
    return specsWorldPoseToTracking(optical.position, optical.rotation);
  }

  start(): void {
    this.stream.start();
  }

  stop(): void {
    this.stream.stop();
  }

  private ensureDeviceCamera(): DeviceCamera | null {
    if (this.stream.deviceCamera) {
      return this.stream.deviceCamera;
    }
    return global.deviceInfoSystem.getTrackingCameraForId(CameraModule.CameraId.Default_Color);
  }

  async capture(): Promise<LocalizationObservation> {
    const frame = await this.stream.requestNextFrame();
    const pose = lookupPoseSample(this.poseBuffer, frame.timestampSeconds);
    if (!pose) {
      throw new Error("no camera pose for capture timestamp");
    }
    const deviceCamera = this.ensureDeviceCamera();
    if (!deviceCamera) {
      throw new Error("DeviceCamera is required");
    }
    const optical = composeDeviceOptical(pose, deviceCamera.pose);
    const tracking = specsWorldPoseToTracking(optical.position, optical.rotation);
    const jpeg = await encodeJpeg(frame.texture);
    return {
      ts_capture: frame.timestampSeconds,
      jpeg,
      intrinsics: scaleCameraIntrinsics(deviceCamera, frame.texture),
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

function quatFromMat4Rotation(m: mat4): quat {
  const c0 = new vec3(m.column0.x, m.column0.y, m.column0.z).normalize();
  const c1 = new vec3(m.column1.x, m.column1.y, m.column1.z).normalize();
  const c2 = new vec3(m.column2.x, m.column2.y, m.column2.z).normalize();
  const r00 = c0.x;
  const r01 = c1.x;
  const r02 = c2.x;
  const r10 = c0.y;
  const r11 = c1.y;
  const r12 = c2.y;
  const r20 = c0.z;
  const r21 = c1.z;
  const r22 = c2.z;
  const trace = r00 + r11 + r22;
  let w: number;
  let x: number;
  let y: number;
  let z: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (r21 - r12) / s;
    y = (r02 - r20) / s;
    z = (r10 - r01) / s;
  } else if (r00 > r11 && r00 > r22) {
    const s = Math.sqrt(1 + r00 - r11 - r22) * 2;
    w = (r21 - r12) / s;
    x = 0.25 * s;
    y = (r01 + r10) / s;
    z = (r02 + r20) / s;
  } else if (r11 > r22) {
    const s = Math.sqrt(1 + r11 - r00 - r22) * 2;
    w = (r02 - r20) / s;
    x = (r01 + r10) / s;
    y = 0.25 * s;
    z = (r12 + r21) / s;
  } else {
    const s = Math.sqrt(1 + r22 - r00 - r11) * 2;
    w = (r10 - r01) / s;
    x = (r02 + r20) / s;
    y = (r12 + r21) / s;
    z = 0.25 * s;
  }
  const result = new quat(w, x, y, z);
  result.normalize();
  return result;
}
