/**
 * Bridge domain types and helpers for app code outside Bridge/.
 * Wire parsing and builders stay in Protocol.ts (Bridge-internal).
 */
export type {
  BridgeStatusMessage,
  CameraFrameAckMessage,
  CaptureHint,
  HelloMessage,
  NavStatusMessage,
  PathMessage,
  PoseCorrectionMessage,
  PoseMessage,
  RegistrationMode,
  RegistrationMotion,
  RegistrationPhase,
  RegistrationProfile,
  RegistrationStatusMessage,
} from "./Protocol";

export {
  buildCameraFrameBytes,
  buildCameraInfo,
  DEFAULT_LIDAR_OBSTACLE_SETTINGS,
  ProtocolParseError,
  protocolMetersToLensCentimeters,
} from "./Protocol";
