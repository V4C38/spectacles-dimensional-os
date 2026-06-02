import {
  AlignStatusMessage,
  BridgeStatusMessage,
  HelloMessage,
  InboundMessage,
  LidarMessage,
  ObstaclesMessage,
  NavStatusMessage,
  PathMessage,
  PoseMessage,
  RegisteredMessage,
  setActiveRobotId,
} from "./ProtocolTypes";

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
  type: "lidar" | "obstacles",
): LidarMessage | ObstaclesMessage {
  let pts: [number, number, number][];
  if (Array.isArray(data.points_flat)) {
    pts = unflattenVec3(data.points_flat as number[]);
  } else {
    pts = parsePoints(data.points);
  }

  return {
    type,
    ts: requireNumber(data, "ts"),
    robot_id: requireString(data, "robot_id"),
    frame: requireString(data, "frame"),
    points: pts,
  };
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
      const msg = parseFlatPointMessage(data, "lidar");
      setActiveRobotId(msg.robot_id);
      return msg;
    }

    case "obstacles": {
      const msg = parseFlatPointMessage(data, "obstacles");
      setActiveRobotId(msg.robot_id);
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
      if (data.method === "marker" || data.method === "manual") {
        msg.method = data.method;
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
      if (
        state !== "idle" &&
        state !== "following_path" &&
        state !== "recovery"
      ) {
        throw new Error("invalid nav_status.state");
      }
      const msg: NavStatusMessage = {
        type: "nav_status",
        ts: requireNumber(data, "ts"),
        robot_id: requireString(data, "robot_id"),
        state,
        goal_reached: Boolean(data.goal_reached),
        goal_failed: Boolean(data.goal_failed),
      };
      setActiveRobotId(msg.robot_id);
      return msg;
    }

    default:
      return null;
  }
}
