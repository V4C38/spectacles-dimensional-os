import type { LocalizationObservation, Quat, Vec3 } from "./protocolTypes";

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
  start(): void;
  capture(): Promise<LocalizationObservation>;
  stop(): void;
}

export interface CaptureGeometry {
  minDistanceM: number;
  maxDistanceM: number;
  lookAtMaxAngleDeg: number;
  frameSpacingS: number;
}
