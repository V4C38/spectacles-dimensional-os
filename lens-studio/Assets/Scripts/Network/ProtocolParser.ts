import {
  AlignStatusMessage,
  CameraFrameAckMessage,
  BridgeStatusMessage,
  HelloMessage,
  InboundMessage,
  LidarMessage,
  NavStatusMessage,
  PathMessage,
  PathPreviewMessage,
  PoseMessage,
} from "./ProtocolTypes";

// ================================================================
/** Validates and parses inbound WebSocket JSON into typed InboundMessage objects. */
// ================================================================

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

export function sniffInboundMessageType(text: string): string | null {
  const match = text.match(/"type"\s*:\s*"([^"]+)"/);
  return match ? match[1] : null;
}

export function isNonCriticalInboundMessageType(messageType: string | null): boolean {
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

function parseInboundObject(data: Record<string, unknown>): InboundMessage | null {
  const type = requireString(data, "type");

  switch (type) {
    case "hello": {
      const robot = requireObject(data.robot);
      const hello: HelloMessage = {
        type: "hello",
        protocol_version: requireNumber(data, "protocol_version"),
        robot: {
          robot_id: requireString(robot, "robot_id"),
          robot_model: requireString(robot, "robot_model"),
          display_name: requireString(robot, "display_name"),
          visual_origin_frame: requireString(robot, "visual_origin_frame"),
        },
        capabilities: (data.capabilities as unknown[]).map(String),
        disabled_capabilities: Array.isArray(data.disabled_capabilities)
          ? (data.disabled_capabilities as unknown[]).map(String)
          : [],
        capability_states: {},
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
      const rawStates = requireObject(data.capability_states ?? {});
      Object.keys(rawStates).forEach((key) => {
        const value = requireObject(rawStates[key]);
        hello.capability_states[key] = {
          available: Boolean(value.available),
          reason:
            typeof value.reason === "string" ? value.reason : undefined,
        };
      });
      return hello;
    }

    case "align_status": {
      const state = requireString(data, "state");
      if (state !== "detecting" && state !== "aligned" && state !== "failed") {
        print(`ProtocolParser: unknown align_status.state "${state}"; skipping`);
        return null;
      }
      const msg: AlignStatusMessage = {
        type: "align_status",
        ts: requireNumber(data, "ts"),
        robot_id: requireString(data, "robot_id"),
        state,
        tag_detected: Boolean(data.tag_detected),
        message: typeof data.message === "string" ? data.message : "",
      };
      if (typeof data.observation_count === "number") {
        msg.observation_count = data.observation_count;
      }
      if (typeof data.baseline_m === "number") {
        msg.baseline_m = data.baseline_m;
      }
      if (typeof data.quality === "number") {
        msg.quality = data.quality;
      }
      if (typeof data.best_quality === "number") {
        msg.best_quality = data.best_quality;
      }
      if (typeof data.has_candidate === "boolean") {
        msg.has_candidate = data.has_candidate;
      }
      if (
        data.method === "marker" ||
        data.method === "manual" ||
        data.method === "tag" ||
        data.method === "tag_orientation"
      ) {
        msg.method = data.method;
      }
      if (typeof data.cluster_size === "number") {
        msg.cluster_size = data.cluster_size;
      }
      if (typeof data.required_samples === "number") {
        msg.required_samples = data.required_samples;
      }
      return msg;
    }

    case "camera_frame_ack": {
      const ack: CameraFrameAckMessage = {
        type: "camera_frame_ack",
        ts: requireNumber(data, "ts"),
        robot_id: requireString(data, "robot_id"),
        seq: requireNumber(data, "seq"),
        tag_detected: Boolean(data.tag_detected),
      };
      if (Array.isArray(data.tag_ids)) {
        ack.tag_ids = data.tag_ids.map((id) => Number(id));
      }
      if (typeof data.quality === "number") {
        ack.quality = data.quality;
      }
      return ack;
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
        data.registration_method === "marker" ||
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
      const msg: PoseMessage = {
        type: "pose",
        ts: requireNumber(data, "ts"),
        robot_id: requireString(data, "robot_id"),
        frame: requireString(data, "frame"),
        position: parseVec3(data.position),
        orientation: [Number(q[0]), Number(q[1]), Number(q[2]), Number(q[3])],
      };
      return msg;
    }

    case "path": {
      const msg: PathMessage = {
        type: "path",
        ts: requireNumber(data, "ts"),
        robot_id: requireString(data, "robot_id"),
        frame: requireString(data, "frame"),
        waypoints: parsePoints(data.waypoints),
      };
      return msg;
    }

    case "path_preview": {
      const msg: PathPreviewMessage = {
        type: "path_preview",
        ts: requireNumber(data, "ts"),
        robot_id: requireString(data, "robot_id"),
        frame: requireString(data, "frame"),
        waypoints: parsePoints(data.waypoints),
        target: parseVec3(data.target),
      };
      return msg;
    }

    case "nav_status": {
      const state = requireString(data, "state");
      if (
        state !== "idle" &&
        state !== "following_path" &&
        state !== "recovery"
      ) {
        print(`ProtocolParser: unknown nav_status.state "${state}"; skipping`);
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
