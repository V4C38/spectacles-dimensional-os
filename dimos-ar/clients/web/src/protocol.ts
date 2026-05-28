/** Keep in sync with dimos_ar/protocol.py and docs/PROTOCOL.md */

export const PROTOCOL_VERSION = 1;
/** Default for replay mode; live hardware uses hello.robots[0] after connect. */
export const ROBOT_ID = "go2";

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

function requireActiveRobotId(action: string): string {
  if (!activeRobotId) {
    throw new Error(`Cannot send ${action} before hello negotiates robot_id`);
  }
  return activeRobotId;
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
}

export type OutboundMessage =
  | HelloMessage
  | LidarMessage
  | PoseMessage
  | RegisteredMessage
  | AlignStatusMessage
  | BridgeStatusMessage;

export function buildGetStatus(): string {
  return JSON.stringify({
    type: "get_status",
    ts: Date.now() / 1000,
    robot_id: requireActiveRobotId("get_status"),
  });
}

export function buildDevRegister(): string {
  return JSON.stringify({
    type: "register",
    ts: Date.now() / 1000,
    robot_id: requireActiveRobotId("register"),
    marker_id: 0,
    marker_position: [0, 0, 0],
    marker_orientation: [0, 0, 0, 1],
  });
}

export function buildAlignCommit(): string {
  return JSON.stringify({
    type: "align_commit",
    ts: Date.now() / 1000,
    robot_id: requireActiveRobotId("align_commit"),
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

function parseColors(raw: unknown): [number, number, number][] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    throw new Error("colors must be an array");
  }
  return raw.map((c) => {
    if (!Array.isArray(c) || c.length !== 3) {
      throw new Error("each color must be [r, g, b]");
    }
    return [Number(c[0]), Number(c[1]), Number(c[2])] as [number, number, number];
  });
}

function unflattenVec3(flat: number[]): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) {
    out.push([flat[i], flat[i + 1], flat[i + 2]]);
  }
  return out;
}

export function parseOutboundMessage(text: string): OutboundMessage | null {
  const data = requireObject(JSON.parse(text));
  const type = requireString(data, "type");

  switch (type) {
    case "hello": {
      const msg: HelloMessage = {
        type: "hello",
        protocol_version: requireNumber(data, "protocol_version"),
        robots: (data.robots as unknown[]).map(String),
        capabilities: (data.capabilities as unknown[]).map(String),
      };
      if (msg.robots.length > 0) {
        setActiveRobotId(msg.robots[0]);
      }
      return msg;
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
      } else {
        const colors = parseColors(data.colors);
        if (colors !== undefined) {
          msg.colors = colors;
        }
      }
      return msg;
    }
    case "pose": {
      const msg: PoseMessage = {
        type: "pose",
        ts: requireNumber(data, "ts"),
        robot_id: requireString(data, "robot_id"),
        frame: requireString(data, "frame"),
        position: parseVec3(data.position),
        orientation: (() => {
          const q = data.orientation;
          if (!Array.isArray(q) || q.length !== 4) {
            throw new Error("orientation must be [qx, qy, qz, qw]");
          }
          return [Number(q[0]), Number(q[1]), Number(q[2]), Number(q[3])] as [
            number,
            number,
            number,
            number,
          ];
        })(),
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
        throw new Error("align_status.state must be detecting, aligned, or failed");
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
      setActiveRobotId(msg.robot_id);
      return msg;
    }
    case "bridge_status": {
      const mode = requireString(data, "mode");
      if (mode !== "live" && mode !== "replay") {
        throw new Error("bridge_status.mode must be live or replay");
      }
      const msg: BridgeStatusMessage = {
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
        msg.robot_serial = data.robot_serial;
      }
      setActiveRobotId(msg.robot_id);
      return msg;
    }
    default:
      return null;
  }
}

export function formatBridgeStatus(msg: BridgeStatusMessage): string {
  const model = msg.robot_model.replace("unitree_", "").toUpperCase();
  if (msg.reconnecting) {
    return `Reconnecting to ${model}…`;
  }
  if (msg.mode === "replay") {
    return `Replay (${model})`;
  }
  const serial = msg.robot_serial ?? msg.robot_id;
  const streams = msg.streams_active ? "streams OK" : "waiting for streams";
  const reg = msg.registered ? "registered" : "not registered";
  return `${model} ${serial.slice(0, 8)}… · ${streams} · ${reg}`;
}
