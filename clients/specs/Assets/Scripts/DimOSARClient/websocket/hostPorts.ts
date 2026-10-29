import type { LocalizationObservation, Quat, Vec3 } from "./protocolTypes";

export const AR_MODULE_CLIENT_CONFIG = {
  port: 8787,
  connectTimeoutS: 8,
  session: {
    helloTimeoutS: 5,
    reconnectDelayS: 1,
  },
  capture: {
    geometry: {
      minDistanceM: 0.35,
      maxDistanceM: 3.0,
      lookAtMaxAngleDeg: 45,
      frameSpacingS: 0.5,
    },
    episode: {
      resultTimeoutS: 15,
      retryBackoffS: 2,
    },
  },
};

export interface WebSocketTransport {
  connect(): void;
  close(): void;
  sendText(text: string): void;
  sendBinary(data: Uint8Array): void;
}

export interface WebSocketTransportHandlers {
  onTransportOpen: () => void;
  onTransportClose: () => void;
  onTransportText: (chunk: string) => void;
  onTransportBinary: (data: Uint8Array) => void;
}
export interface BindableWebSocketTransport extends WebSocketTransport {
  bind(handlers: WebSocketTransportHandlers): void;
}

export interface ClientClock {
  now(): number;
}

export interface CameraTrackingSource {
  trackingPosition?(): Vec3;
  clearTracking?(): void;
  cameraOptical(): { position: Vec3; orientation: Quat };
}

export interface CameraCaptureSource {
  start(): void;
  capture(canEncode?: () => boolean): Promise<LocalizationObservation>;
  stop(): void;
}

export interface CaptureGeometry {
  minDistanceM: number;
  maxDistanceM: number;
  lookAtMaxAngleDeg: number;
  frameSpacingS: number;
}
