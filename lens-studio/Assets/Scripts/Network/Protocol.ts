import { BridgeStatusMessage } from "./ProtocolTypes";

// ================================================================
/**
 * Public protocol surface re-exporting types/parser plus outbound builders,
 * unit conversion helpers, status formatting, and simple callback fan-out.
 */
// ================================================================

const LENS_CM_TO_PROTOCOL_M = 0.01;
const PROTOCOL_M_TO_LENS_CM = 100.0;

export * from "./ProtocolTypes";
export * from "./ProtocolParser";

export function protocolMetersToLensCentimeters(
  position: [number, number, number],
): vec3 {
  return new vec3(
    position[0] * PROTOCOL_M_TO_LENS_CM,
    position[1] * PROTOCOL_M_TO_LENS_CM,
    position[2] * PROTOCOL_M_TO_LENS_CM,
  );
}

export function lensCentimetersToProtocolMeters(
  position: vec3,
): [number, number, number] {
  return [
    position.x * LENS_CM_TO_PROTOCOL_M,
    position.y * LENS_CM_TO_PROTOCOL_M,
    position.z * LENS_CM_TO_PROTOCOL_M,
  ];
}

export function buildGetStatus(robotId: string): string {
  return JSON.stringify({
    type: "get_status",
    ts: getTime(),
    robot_id: robotId,
  });
}

export function buildAlignStart(robotId: string): string {
  return JSON.stringify({
    type: "align_start",
    ts: getTime(),
    robot_id: robotId,
  });
}

export function buildAlignStop(robotId: string): string {
  return JSON.stringify({
    type: "align_stop",
    ts: getTime(),
    robot_id: robotId,
  });
}

export function buildAlignCommit(robotId: string): string {
  return JSON.stringify({
    type: "align_commit",
    ts: getTime(),
    robot_id: robotId,
  });
}

export function buildAlignManualPose(
  position: vec3,
  rotation: quat,
  robotId: string,
): string {
  return JSON.stringify({
    type: "align_manual_pose",
    ts: getTime(),
    robot_id: robotId,
    position: lensCentimetersToProtocolMeters(position),
    orientation: [rotation.x, rotation.y, rotation.z, rotation.w],
  });
}

export function buildCameraInfo(args: {
  robotId: string;
  width: number;
  height: number;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  deviceModel?: string;
}): string {
  return JSON.stringify({
    type: "camera_info",
    ts: getTime(),
    robot_id: args.robotId,
    width: args.width,
    height: args.height,
    fx: args.fx,
    fy: args.fy,
    cx: args.cx,
    cy: args.cy,
    distortion: [],
    camera_model: "pinhole",
    device_model: args.deviceModel ?? "spectacles",
  });
}

const CAMERA_FRAME_MAGIC = [0x58, 0x52, 0x46, 0x31];

export function buildCameraFrameBytes(args: {
  robotId: string;
  seq: number;
  ts: number;
  sendTs: number;
  camPos: vec3;
  camRot: quat;
  jpegBytes: Uint8Array;
}): Uint8Array {
  const header = JSON.stringify({
    type: "camera_frame",
    robot_id: args.robotId,
    seq: args.seq,
    ts: args.ts,
    send_ts: args.sendTs,
    cam_pos: lensCentimetersToProtocolMeters(args.camPos),
    cam_rot: [args.camRot.x, args.camRot.y, args.camRot.z, args.camRot.w],
  });
  const headerBytes = [];
  for (let i = 0; i < header.length; i++) {
    headerBytes.push(header.charCodeAt(i));
  }
  const headerLen = headerBytes.length;
  const totalLen = 8 + headerLen + args.jpegBytes.length;
  const out = new Uint8Array(totalLen);
  out.set(CAMERA_FRAME_MAGIC, 0);
  out[4] = headerLen & 0xff;
  out[5] = (headerLen >> 8) & 0xff;
  out[6] = (headerLen >> 16) & 0xff;
  out[7] = (headerLen >> 24) & 0xff;
  out.set(headerBytes, 8);
  out.set(args.jpegBytes, 8 + headerLen);
  return out;
}

export function buildNavGoal(
  position: vec3,
  rotation: quat,
  robotId: string,
): string {
  return JSON.stringify({
    type: "nav_goal",
    ts: getTime(),
    robot_id: robotId,
    position: lensCentimetersToProtocolMeters(position),
    orientation: [rotation.x, rotation.y, rotation.z, rotation.w],
  });
}

export function buildPlanPath(
  position: vec3,
  robotId: string,
  rotation?: quat | null,
): string {
  const payload: Record<string, unknown> = {
    type: "plan_path",
    ts: getTime(),
    robot_id: robotId,
    position: lensCentimetersToProtocolMeters(position),
  };
  if (rotation) {
    payload.orientation = [rotation.x, rotation.y, rotation.z, rotation.w];
  }
  return JSON.stringify(payload);
}

export function buildCancelGoal(robotId: string): string {
  return JSON.stringify({
    type: "cancel_goal",
    ts: getTime(),
    robot_id: robotId,
  });
}

export function buildEmergencyStop(robotId: string): string {
  return JSON.stringify({
    type: "emergency_stop",
    ts: getTime(),
    robot_id: robotId,
  });
}

export function emit<T>(callbacks: ((value: T) => void)[], value: T): void {
  callbacks.forEach((cb) => cb(value));
}
