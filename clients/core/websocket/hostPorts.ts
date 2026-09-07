import type { Intrinsics, Quat, Vec3 } from "./protocolTypes";

export interface WebSocketTransport {
  connect(): void;
  close(): void;
  sendText(text: string): void;
  sendBinary(data: Uint8Array): void;
}

export interface ClientClock {
  now(): number;
}

export interface CameraTrackingSource {
  cameraOptical(): { position: Vec3; orientation: Quat };
}

export interface CameraCaptureSource {
  capture(): {
    ts_capture: number;
    jpeg: Uint8Array;
    intrinsics: Intrinsics;
    camera_position: Vec3;
    camera_orientation: Quat;
  };
}

export interface CaptureGeometry {
  minDistanceM: number;
  maxDistanceM: number;
  lookAtMaxAngleDeg: number;
  frameSpacingS: number;
}
