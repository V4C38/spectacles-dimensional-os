/** Keep in sync with dimos_ar/protocol.py and docs/PROTOCOL.md */

export const PROTOCOL_VERSION = 1;
export const ROBOT_ID = "go2";
const LENS_CM_TO_PROTOCOL_M = 0.01;
const PROTOCOL_M_TO_LENS_CM = 100.0;

let activeRobotId: string | null = null;

export function setActiveRobotId(robotId: string): void {
  activeRobotId = robotId;
}

export function clearActiveRobotId(): void {
  activeRobotId = null;
}

export function getActiveRobotId(): string | null {
  return activeRobotId;
}

export function protocolMetersToLensCentimeters(position: [number, number, number]): vec3 {
  return new vec3(
    position[0] * PROTOCOL_M_TO_LENS_CM,
    position[1] * PROTOCOL_M_TO_LENS_CM,
    position[2] * PROTOCOL_M_TO_LENS_CM,
  );
}

export function lensCentimetersToProtocolMeters(position: vec3): [number, number, number] {
  return [
    position.x * LENS_CM_TO_PROTOCOL_M,
    position.y * LENS_CM_TO_PROTOCOL_M,
    position.z * LENS_CM_TO_PROTOCOL_M,
  ];
}

export interface HelloMessage {
  type: "hello";
  protocol_version: number;
  robots: string[];
  capabilities: string[];
}

export interface LidarMessage {
  type: "lidar";
  ts: number;
  robot_id: string;
  frame: string;
  points: [number, number, number][];
  colors?: [number, number, number][];
}

function unflattenVec3(flat: number[]): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) {
    out.push([flat[i], flat[i + 1], flat[i + 2]]);
  }
  return out;
}

export interface PoseMessage {
  type: "pose";
  ts: number;
  robot_id: string;
  frame: string;
  position: [number, number, number];
  orientation: [number, number, number, number];
}

export interface RegisteredMessage {
  type: "registered";
  ts: number;
  robot_id: string;
  registered: boolean;
}

export interface AlignStatusMessage {
  type: "align_status";
  ts: number;
  robot_id: string;
  state: "detecting" | "aligned" | "failed";
  robot_marker_detected: boolean;
  spectacles_marker_detected: boolean;
  quality?: number;
  best_quality?: number;
  has_candidate?: boolean;
  candidate_count?: number;
  method?: "marker" | "manual";
  approximate?: boolean;
  message: string;
}

export interface BridgeStatusMessage {
  type: "bridge_status";
  ts: number;
  robot_id: string;
  mode: "live" | "replay";
  robot_connected: boolean;
  robot_model: string;
  robot_serial?: string;
  streams_active: boolean;
  registered: boolean;
  reconnecting: boolean;
  registration_method?: "marker" | "manual";
  registration_approximate?: boolean;
}

export interface PathMessage {
  type: "path";
  ts: number;
  robot_id: string;
  frame: string;
  waypoints: [number, number, number][];
}

export interface NavStatusMessage {
  type: "nav_status";
  ts: number;
  robot_id: string;
  state: "idle" | "following_path" | "recovery";
  goal_reached: boolean;
}

export type InboundMessage =
  | HelloMessage
  | LidarMessage
  | PoseMessage
  | RegisteredMessage
  | AlignStatusMessage
  | BridgeStatusMessage
  | PathMessage
  | NavStatusMessage;

export function buildGetStatus(robotId: string): string {
  return JSON.stringify({
    type: "get_status",
    ts: getTime(),
    robot_id: robotId,
  });
}

export function formatBridgeStatus(msg: BridgeStatusMessage): string {
  const model = msg.robot_model.replace("unitree_", "").toUpperCase();
  const mode = msg.mode === "replay" ? "Replay" : "Live";

  if (msg.reconnecting) {
    return `${mode} · ${model} — reconnecting…`;
  }
  if (!msg.robot_connected) {
    return `${mode} · ${model} — robot not connected`;
  }

  const label = msg.robot_serial ?? msg.robot_id;
  const streams = msg.streams_active ? "data streaming" : "waiting for lidar/odom";
  const calibrated = msg.registered ? "calibrated" : "needs calibration";
  return `${mode} · ${model} (${label}) — ${streams}, ${calibrated}`;
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

export function buildAlignMarker(
  position: vec3,
  rotation: quat,
  robotId: string,
): string {
  // Lens marker tracking reports centimeters; the bridge protocol uses meters.
  const markerPositionM = [
    position.x * LENS_CM_TO_PROTOCOL_M,
    position.y * LENS_CM_TO_PROTOCOL_M,
    position.z * LENS_CM_TO_PROTOCOL_M,
  ];
  return JSON.stringify({
    type: "align_marker",
    ts: getTime(),
    robot_id: robotId,
    marker_position: markerPositionM,
    marker_orientation: [rotation.x, rotation.y, rotation.z, rotation.w],
  });
}

export function buildNavGoal(position: vec3, robotId: string): string {
  return JSON.stringify({
    type: "nav_goal",
    ts: getTime(),
    robot_id: robotId,
    frame: "world",
    position: lensCentimetersToProtocolMeters(position),
  });
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
    return [Number(p[0]), Number(p[1]), Number(p[2])] as [number, number, number];
  });
}

function parseVec3(raw: unknown): [number, number, number] {
  if (!Array.isArray(raw) || raw.length !== 3) {
    throw new Error("expected [x, y, z]");
  }
  return [Number(raw[0]), Number(raw[1]), Number(raw[2])];
}

export function parseInboundMessage(text: string): InboundMessage | null {
  const data = requireObject(JSON.parse(text));
  const type = requireString(data, "type");

  switch (type) {
    case "hello": {
      const hello: HelloMessage = {
        type: "hello",
        protocol_version: requireNumber(data, "protocol_version"),
        robots: (data.robots as unknown[]).map(String),
        capabilities: (data.capabilities as unknown[]).map(String),
      };
      if (hello.robots.length > 0) {
        setActiveRobotId(hello.robots[0]);
      }
      return hello;
    }
    case "lidar": {
      let pts: [number, number, number][];
      if (Array.isArray(data.points_flat)) {
        pts = unflattenVec3(data.points_flat as number[]);
      } else {
        pts = parsePoints(data.points);
      }
      const msg: LidarMessage = {
        type: "lidar",
        ts: requireNumber(data, "ts"),
        robot_id: requireString(data, "robot_id"),
        frame: requireString(data, "frame"),
        points: pts,
      };
      setActiveRobotId(msg.robot_id);
      if (Array.isArray(data.colors_flat)) {
        msg.colors = unflattenVec3(data.colors_flat as number[]);
      } else if (Array.isArray(data.colors)) {
        msg.colors = (data.colors as unknown[]).map((c) => {
          const row = c as number[];
          return [row[0], row[1], row[2]] as [number, number, number];
        });
      }
      return msg;
    }
    case "pose": {
      const q = data.orientation;
      if (!Array.isArray(q) || q.length !== 4) {
        throw new Error("orientation must be [qx, qy, qz, qw]");
      }
      const msg: PoseMessage = {
        type: "pose",
        ts: requireNumber(data, "ts"),
        robot_id: requireString(data, "robot_id"),
        frame: requireString(data, "frame"),
        position: parseVec3(data.position),
        orientation: [Number(q[0]), Number(q[1]), Number(q[2]), Number(q[3])],
      };
      setActiveRobotId(msg.robot_id);
      return msg;
    }
    case "registered": {
      const msg: RegisteredMessage = {
        type: "registered",
        ts: requireNumber(data, "ts"),
        robot_id: requireString(data, "robot_id"),
        registered: Boolean(data.registered),
      };
      setActiveRobotId(msg.robot_id);
      return msg;
    }
    case "align_status": {
      const state = requireString(data, "state");
      if (state !== "detecting" && state !== "aligned" && state !== "failed") {
        throw new Error("invalid align_status.state");
      }
      const msg: AlignStatusMessage = {
        type: "align_status",
        ts: requireNumber(data, "ts"),
        robot_id: requireString(data, "robot_id"),
        state,
        robot_marker_detected: Boolean(data.robot_marker_detected),
        spectacles_marker_detected: Boolean(data.spectacles_marker_detected),
        message: typeof data.message === "string" ? data.message : "",
      };
      if (typeof data.quality === "number") {
        msg.quality = data.quality;
      }
      if (typeof data.best_quality === "number") {
        msg.best_quality = data.best_quality;
      }
      if (typeof data.has_candidate === "boolean") {
        msg.has_candidate = data.has_candidate;
      }
      if (typeof data.candidate_count === "number") {
        msg.candidate_count = data.candidate_count;
      }
      if (data.method === "marker" || data.method === "manual") {
        msg.method = data.method;
      }
      if (typeof data.approximate === "boolean") {
        msg.approximate = data.approximate;
      }
      setActiveRobotId(msg.robot_id);
      return msg;
    }
    case "bridge_status": {
      const mode = requireString(data, "mode");
      if (mode !== "live" && mode !== "replay") {
        throw new Error("invalid bridge_status.mode");
      }
      const status: BridgeStatusMessage = {
        type: "bridge_status",
        ts: requireNumber(data, "ts"),
        robot_id: requireString(data, "robot_id"),
        mode,
        robot_connected: Boolean(data.robot_connected),
        robot_model: requireString(data, "robot_model"),
        streams_active: Boolean(data.streams_active),
        registered: Boolean(data.registered),
        reconnecting: Boolean(data.reconnecting),
      };
      if (typeof data.robot_serial === "string") {
        status.robot_serial = data.robot_serial;
      }
      if (data.registration_method === "marker" || data.registration_method === "manual") {
        status.registration_method = data.registration_method;
      }
      if (typeof data.registration_approximate === "boolean") {
        status.registration_approximate = data.registration_approximate;
      }
      setActiveRobotId(status.robot_id);
      return status;
    }
    case "path": {
      const msg: PathMessage = {
        type: "path",
        ts: requireNumber(data, "ts"),
        robot_id: requireString(data, "robot_id"),
        frame: requireString(data, "frame"),
        waypoints: parsePoints(data.waypoints),
      };
      setActiveRobotId(msg.robot_id);
      return msg;
    }
    case "nav_status": {
      const state = requireString(data, "state");
      if (state !== "idle" && state !== "following_path" && state !== "recovery") {
        throw new Error("invalid nav_status.state");
      }
      const msg: NavStatusMessage = {
        type: "nav_status",
        ts: requireNumber(data, "ts"),
        robot_id: requireString(data, "robot_id"),
        state,
        goal_reached: Boolean(data.goal_reached),
      };
      setActiveRobotId(msg.robot_id);
      return msg;
    }
    default:
      return null;
  }
}
