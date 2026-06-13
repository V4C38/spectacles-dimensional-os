// ================================================================
/**
 * Protocol v4 — message types, parser, outbound builders, and unit
 * conversion helpers. Single source of truth replacing the v3 trio
 * (ProtocolTypes / ProtocolParser / Protocol).
 *
 * Keep in sync with dimos_xr/protocol.py and dimos-xr/PROTOCOL.md.
 */
// ================================================================

export const PROTOCOL_VERSION = 4;

// ── Unit conversion ────────────────────────────────────────────

const LENS_CM_TO_PROTOCOL_M = 0.01;
const PROTOCOL_M_TO_LENS_CM = 100.0;

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

// ── Message types ──────────────────────────────────────────────

export interface CapabilityState {
  available: boolean;
  reason?: string;
}

export interface RobotHelloInfo {
  robot_id: string;
  robot_model: string;
  display_name: string;
  body_bounds_m?: [number, number, number];
  footprint_m?: [number, number];
  visual_origin_frame: string;
  base_height_m?: number;
  default_render_offset_m?: [number, number, number];
  alignment_profile?: Record<string, unknown>;
}

/** v4: capabilities is a single unified map; disabled_capabilities removed. */
export interface HelloMessage {
  type: "hello";
  protocol_version: number;
  robot: RobotHelloInfo;
  capabilities: Record<string, CapabilityState>;
}

export interface LidarMessage {
  type: "lidar";
  ts: number;
  robot_id: string;
  frame: string;
  points: [number, number, number][];
}

export interface PoseMessage {
  type: "pose";
  ts: number;
  robot_id: string;
  frame: string;
  position: [number, number, number];
  orientation: [number, number, number, number];
}

/**
 * v4: simplified align_status — method, state, progress, message, tag_visible.
 * "ready" = has candidate; "aligned" = committed successfully.
 */
export interface AlignStatusMessage {
  type: "align_status";
  ts: number;
  robot_id: string;
  method: "tag" | "manual";
  state: "detecting" | "ready" | "aligned" | "failed";
  progress: number;
  message: string;
  tag_visible?: boolean;
  baseline_m?: number;
  baseline_target_m?: number;
  assist_stage?: string;
  robot_world_pose?: { position: [number, number, number]; orientation: [number, number, number, number] };
}

/** v4: camera_frame_ack contains only seq. */
export interface CameraFrameAckMessage {
  type: "camera_frame_ack";
  ts: number;
  robot_id: string;
  seq: number;
}

export interface BridgeStatusMessage {
  type: "bridge_status";
  ts: number;
  robot_id: string;
  robot_connected: boolean;
  streams_active: boolean;
  registered: boolean;
  reconnecting: boolean;
  registration_method?: "tag" | "manual";
  registration_approximate?: boolean;
}

export interface PathMessage {
  type: "path";
  ts: number;
  robot_id: string;
  frame: string;
  waypoints: [number, number, number][];
}

export interface PathPreviewMessage {
  type: "path_preview";
  ts: number;
  robot_id: string;
  frame: string;
  waypoints: [number, number, number][];
  target: [number, number, number];
}

export interface NavStatusMessage {
  type: "nav_status";
  ts: number;
  robot_id: string;
  state: "idle" | "following_path" | "recovery";
  goal_reached: boolean;
  goal_failed: boolean;
  recovering?: boolean;
  error_code?: number;
}

export type InboundMessage =
  | HelloMessage
  | LidarMessage
  | PoseMessage
  | AlignStatusMessage
  | CameraFrameAckMessage
  | BridgeStatusMessage
  | PathMessage
  | PathPreviewMessage
  | NavStatusMessage;

// ── Parse-error taxonomy ───────────────────────────────────────

export type ProtocolParseFailureKind = "json" | "schema";

export class ProtocolParseError extends Error {
  readonly kind: ProtocolParseFailureKind;
  readonly messageType: string | null;

  constructor(
    kind: ProtocolParseFailureKind,
    messageType: string | null,
    detail: string,
  ) {
    super(detail);
    this.name = "ProtocolParseError";
    this.kind = kind;
    this.messageType = messageType;
  }
}

// ── Parser ─────────────────────────────────────────────────────

export function sniffInboundMessageType(text: string): string | null {
  const match = text.match(/"type"\s*:\s*"([^"]+)"/);
  return match ? match[1] : null;
}

export function isNonCriticalInboundMessageType(
  messageType: string | null,
): boolean {
  return messageType === "lidar" || messageType === "pose";
}

function unflattenVec3(flat: number[]): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) {
    out.push([flat[i], flat[i + 1], flat[i + 2]]);
  }
  return out;
}

function requireObject(data: unknown): Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Message must be a JSON object");
  }
  return data as Record<string, unknown>;
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== "string") {
    throw new Error(`Missing or invalid field: ${key}`);
  }
  return v;
}

function requireNumber(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  if (typeof v !== "number") {
    throw new Error(`Missing or invalid field: ${key}`);
  }
  return v;
}

function parsePoints(raw: unknown): [number, number, number][] {
  if (!Array.isArray(raw)) {
    throw new Error("points must be an array");
  }
  return raw.map((p) => {
    if (!Array.isArray(p) || p.length !== 3) {
      throw new Error("each point must be [x, y, z]");
    }
    return [Number(p[0]), Number(p[1]), Number(p[2])] as [
      number,
      number,
      number,
    ];
  });
}

function parseVec3(raw: unknown): [number, number, number] {
  if (!Array.isArray(raw) || raw.length !== 3) {
    throw new Error("expected [x, y, z]");
  }
  return [Number(raw[0]), Number(raw[1]), Number(raw[2])];
}

function parseFlatPointMessage(
  data: Record<string, unknown>,
): LidarMessage {
  let pts: [number, number, number][];
  if (Array.isArray(data.points_flat)) {
    pts = unflattenVec3(data.points_flat as number[]);
  } else {
    pts = parsePoints(data.points);
  }
  return {
    type: "lidar",
    ts: requireNumber(data, "ts"),
    robot_id: requireString(data, "robot_id"),
    frame: requireString(data, "frame"),
    points: pts,
  };
}

export function parseInboundJson(text: string): Record<string, unknown> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new ProtocolParseError(
      "json",
      sniffInboundMessageType(text),
      `JSON parse failed: ${error}`,
    );
  }
  return requireObject(data);
}

export function parseInboundMessage(text: string): InboundMessage | null {
  const data = parseInboundJson(text);
  const messageType =
    typeof data.type === "string" ? (data.type as string) : null;
  try {
    return parseInboundObject(data);
  } catch (error) {
    throw new ProtocolParseError(
      "schema",
      messageType,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function parseInboundObject(
  data: Record<string, unknown>,
): InboundMessage | null {
  const type = requireString(data, "type");

  switch (type) {
    case "hello": {
      const version = requireNumber(data, "protocol_version");
      if (version !== PROTOCOL_VERSION) {
        throw new ProtocolParseError(
          "schema",
          "hello",
          `Unsupported protocol version ${version} (expected ${PROTOCOL_VERSION}); connect a v${PROTOCOL_VERSION} bridge.`,
        );
      }
      const robot = requireObject(data.robot);
      const hello: HelloMessage = {
        type: "hello",
        protocol_version: version,
        robot: {
          robot_id: requireString(robot, "robot_id"),
          robot_model: requireString(robot, "robot_model"),
          display_name: requireString(robot, "display_name"),
          visual_origin_frame: requireString(robot, "visual_origin_frame"),
        },
        capabilities: {},
      };
      if (Array.isArray(robot.body_bounds_m) && robot.body_bounds_m.length === 3) {
        hello.robot.body_bounds_m = parseVec3(robot.body_bounds_m);
      }
      if (Array.isArray(robot.footprint_m) && robot.footprint_m.length === 2) {
        hello.robot.footprint_m = [
          Number(robot.footprint_m[0]),
          Number(robot.footprint_m[1]),
        ];
      }
      if (typeof robot.base_height_m === "number") {
        hello.robot.base_height_m = robot.base_height_m;
      }
      if (
        Array.isArray(robot.default_render_offset_m) &&
        robot.default_render_offset_m.length === 3
      ) {
        hello.robot.default_render_offset_m = parseVec3(
          robot.default_render_offset_m,
        );
      }
      if (
        typeof robot.alignment_profile === "object" &&
        robot.alignment_profile !== null &&
        !Array.isArray(robot.alignment_profile)
      ) {
        hello.robot.alignment_profile = robot.alignment_profile as Record<
          string,
          unknown
        >;
      }
      const rawCapabilities = requireObject(data.capabilities ?? {});
      Object.keys(rawCapabilities).forEach((key) => {
        const value = requireObject(rawCapabilities[key]);
        hello.capabilities[key] = {
          available: Boolean(value.available),
          reason:
            typeof value.reason === "string" ? value.reason : undefined,
        };
      });
      return hello;
    }

    case "align_status": {
      const state = requireString(data, "state");
      if (
        state !== "detecting" &&
        state !== "ready" &&
        state !== "aligned" &&
        state !== "failed"
      ) {
        print(`Protocol: unknown align_status.state "${state}"; skipping`);
        return null;
      }
      const method = data.method;
      if (method !== "tag" && method !== "manual") {
        print(`Protocol: unknown align_status.method "${method}"; skipping`);
        return null;
      }
      return {
        type: "align_status",
        ts: requireNumber(data, "ts"),
        robot_id: requireString(data, "robot_id"),
        method,
        state: state as AlignStatusMessage["state"],
        progress: typeof data.progress === "number" ? data.progress : 0,
        message: typeof data.message === "string" ? data.message : "",
        tag_visible:
          typeof data.tag_visible === "boolean"
            ? data.tag_visible
            : undefined,
      };
    }

    case "camera_frame_ack": {
      return {
        type: "camera_frame_ack",
        ts: requireNumber(data, "ts"),
        robot_id: requireString(data, "robot_id"),
        seq: requireNumber(data, "seq"),
      };
    }

    case "bridge_status": {
      const status: BridgeStatusMessage = {
        type: "bridge_status",
        ts: requireNumber(data, "ts"),
        robot_id: requireString(data, "robot_id"),
        robot_connected: Boolean(data.robot_connected),
        streams_active: Boolean(data.streams_active),
        registered: Boolean(data.registered),
        reconnecting: Boolean(data.reconnecting),
      };
      if (
        data.registration_method === "tag" ||
        data.registration_method === "manual"
      ) {
        status.registration_method = data.registration_method;
      }
      if (typeof data.registration_approximate === "boolean") {
        status.registration_approximate = data.registration_approximate;
      }
      return status;
    }

    case "lidar": {
      return parseFlatPointMessage(data);
    }

    case "pose": {
      const q = data.orientation;
      if (!Array.isArray(q) || q.length !== 4) {
        throw new Error("orientation must be [qx, qy, qz, qw]");
      }
      return {
        type: "pose",
        ts: requireNumber(data, "ts"),
        robot_id: requireString(data, "robot_id"),
        frame: requireString(data, "frame"),
        position: parseVec3(data.position),
        orientation: [Number(q[0]), Number(q[1]), Number(q[2]), Number(q[3])],
      };
    }

    case "path": {
      return {
        type: "path",
        ts: requireNumber(data, "ts"),
        robot_id: requireString(data, "robot_id"),
        frame: requireString(data, "frame"),
        waypoints: parsePoints(data.waypoints),
      };
    }

    case "path_preview": {
      return {
        type: "path_preview",
        ts: requireNumber(data, "ts"),
        robot_id: requireString(data, "robot_id"),
        frame: requireString(data, "frame"),
        waypoints: parsePoints(data.waypoints),
        target: parseVec3(data.target),
      };
    }

    case "nav_status": {
      const state = requireString(data, "state");
      if (
        state !== "idle" &&
        state !== "following_path" &&
        state !== "recovery"
      ) {
        print(`Protocol: unknown nav_status.state "${state}"; skipping`);
        return null;
      }
      const msg: NavStatusMessage = {
        type: "nav_status",
        ts: requireNumber(data, "ts"),
        robot_id: requireString(data, "robot_id"),
        state,
        goal_reached: Boolean(data.goal_reached),
        goal_failed: Boolean(data.goal_failed),
      };
      if (typeof data.recovering === "boolean") {
        msg.recovering = data.recovering;
      }
      if (typeof data.error_code === "number") {
        msg.error_code = data.error_code;
      }
      return msg;
    }

    default:
      return null;
  }
}

// ── Outbound builders ──────────────────────────────────────────

export function buildGetStatus(robotId: string): string {
  return JSON.stringify({
    type: "get_status",
    ts: getTime(),
    robot_id: robotId,
  });
}

/** v4: align_start includes the session method. Pass assist=true for robot-assisted calibration. */
export function buildAlignStart(
  robotId: string,
  method: "tag" | "manual",
  assist: boolean = false,
): string {
  const payload: Record<string, unknown> = {
    type: "align_start",
    ts: getTime(),
    robot_id: robotId,
    method,
  };
  if (assist) {
    payload["assist"] = true;
  }
  return JSON.stringify(payload);
}

export function buildAssistConfirm(robotId: string): string {
  return JSON.stringify({
    type: "assist_confirm",
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

// Binary lidar frame (message_type 0x01 = lidar_f16).
// Layout: [1B type][4B float32 ts LE][N*6B float16 xyz world-metres LE]
const LIDAR_F16_TYPE = 0x01;

function _getFloat16LE(view: DataView, byteOffset: number): number {
  const h = view.getUint16(byteOffset, true);
  const exp = (h >> 10) & 0x1f;
  const mant = h & 0x3ff;
  if (exp === 0) {
    return (h >> 15 ? -1 : 1) * Math.pow(2, -14) * (mant / 1024);
  }
  if (exp === 31) {
    return mant ? NaN : h >> 15 ? -Infinity : Infinity;
  }
  return (h >> 15 ? -1 : 1) * Math.pow(2, exp - 15) * (1 + mant / 1024);
}

/**
 * Parse a binary lidar_f16 WebSocket frame into a LidarMessage.
 * Accepts a Uint8Array (from Blob.bytes()) — Spectacles only delivers binary
 * WebSocket frames as Blob, not ArrayBuffer.
 * The robot_id is not present in the binary frame; pass the currently
 * active robot id from the session context.
 */
export function parseLidarBinary(
  data: Uint8Array,
  robotId: string,
): LidarMessage | null {
  if (data.byteLength < 5) {
    return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const msgType = view.getUint8(0);
  if (msgType !== LIDAR_F16_TYPE) {
    return null;
  }
  const ts = view.getFloat32(1, true);
  const pointBytes = data.byteLength - 5;
  const n = Math.floor(pointBytes / 6);
  const points: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const base = 5 + i * 6;
    const x = _getFloat16LE(view, base);
    const y = _getFloat16LE(view, base + 2);
    const z = _getFloat16LE(view, base + 4);
    points.push([x, y, z]);
  }
  return { type: "lidar", ts, robot_id: robotId, frame: "world", points };
}

/** Derive BridgeLinkState from connection + bridge_status flags. */
export function deriveLinkState(
  connected: boolean,
  status: BridgeStatusMessage | null,
): "disconnected" | "connectedNoRobot" | "connected" {
  if (!connected) {
    return "disconnected";
  }
  if (!status?.robot_connected) {
    return "connectedNoRobot";
  }
  return "connected";
}
