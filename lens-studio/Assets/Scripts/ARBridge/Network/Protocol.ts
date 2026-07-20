// ================================================================
/**
 * Protocol v18 — message types, parser, outbound builders, and unit
 * conversion helpers. Single source of truth replacing the v3 trio
 * (ProtocolTypes / ProtocolParser / Protocol).
 *
 * Keep in sync with dimos/ar/network/protocol.py and dimos-ar/PROTOCOL.md.
 */
// ================================================================

import {
  BridgeLinkState,
  BridgeSnapshot,
  createDefaultBridgeSnapshot,
  type NavTerminalOutcome,
  type WireNavigationState,
} from "../../App/AppState";

export const PROTOCOL_VERSION = 18;

/** Wire maximum; operational caps are mode-specific (see PROTOCOL.md). */
export const LIDAR_WIRE_MAX_POINTS = 2500;
export const LIDAR_FULL_POINT_CAP = 1500;
export const LIDAR_OBSTACLE_POINT_CAP = 200;

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

export interface TagTrackingProfile {
  tag_ids: number[];
  tag_total_size_m: number;
}

export interface RobotHelloInfo {
  robot_id: string;
  display_name: string;
  body_bounds_m?: [number, number, number];
  footprint_m?: [number, number];
  visual_origin_frame: string;
  base_height_m?: number;
  default_render_offset_m?: [number, number, number];
  tag_tracking_profile?: TagTrackingProfile;
}

/** Capabilities is a single unified map; disabled_capabilities removed. */
export interface HelloMessage {
  type: "hello";
  protocol_version: number;
  robot: RobotHelloInfo;
  capabilities: Record<string, CapabilityState>;
}

export interface LidarMessage {
  type: "lidar";
  ts: number;
  points: [number, number, number][];
}

export interface LidarObstacleSettings {
  minDistanceM: number;
  opaqueDistanceM: number;
  maxDistanceM: number;
}

export const DEFAULT_LIDAR_OBSTACLE_SETTINGS: LidarObstacleSettings = {
  minDistanceM: 0.10,
  opaqueDistanceM: 0.50,
  maxDistanceM: 0.80,
};

export interface PoseMessage {
  type: "pose";
  ts: number;
  position: [number, number, number];
  orientation: [number, number, number, number];
  /** Smoothed robot speed from bridge odom (m/s); optional on older bridges. */
  speed_mps?: number;
  /** World-frame linear velocity in m/s; optional on older bridges. */
  velocity_mps?: [number, number, number];
  /** World-frame yaw rate in rad/s about world-up; optional on older bridges. */
  yaw_rate_rad_s?: number;
}

export interface WorldFrameCorrectionMessage {
  type: "world_frame_correction";
  ts: number;
  trans_delta_m: number;
  yaw_delta_deg?: number;
  yaw_corrected: boolean;
  solve_quality: number;
  solve_method: WorldFrameSolveMethod;
  alignment_confidence?: number;
  yaw_observable?: boolean;
  scale_observable?: boolean;
  scale_confidence?: number;
  yaw_confidence?: number;
  scale_held?: boolean;
  yaw_held?: boolean;
}

export type WorldFrameSolveMethod =
  | "apriltag_full"
  | "apriltag_translation"
  | "similarity";

export type RegistrationMode = "april_tag" | "manual_pose";

export type RegistrationState =
  | "idle"
  | "april_tag"
  | "manual_placement"
  | "awaiting_commit"
  | "succeeded"
  | "failed";

export interface RegistrationPreviewPose {
  position: [number, number, number];
  orientation: [number, number, number, number];
}

/** Registration progress during a registration session. */
export interface RegistrationStatusMessage {
  type: "registration_status";
  ts: number;
  mode?: RegistrationMode;
  state: RegistrationState;
  message: string;
  tag_visible?: boolean;
  preview_pose?: RegistrationPreviewPose;
  /** AprilTag registration progress 0–100; present during `april_tag` state/succeeded. */
  progress?: number;
  registration_confidence?: number;
  scale_locked?: boolean;
}

/** camera_frame_ack clears Lens single-flight capture state. */
export interface CameraFrameAckMessage {
  type: "camera_frame_ack";
  ts: number;
  seq: number;
  capturing_budgeted_complete: boolean;
}

export interface CapturePolicyMessage {
  type: "capture_policy";
  ts: number;
  max_capture_distance_m: number;
  min_capture_distance_m: number;
  max_capture_speed_mps: number;
  static_speed_mps: number;
  min_observations: number;
}

export interface BridgeStatusMessage {
  type: "bridge_status";
  ts: number;
  robot_connected: boolean;
  world_frame_committed: boolean;
  reconnecting: boolean;
  world_frame_method?: RegistrationMode | null;
  world_frame_approximate?: boolean;
}

export interface BridgeWorldFrameFields {
  world_frame_method?: RegistrationMode | null;
  world_frame_approximate: boolean;
}

function resolveBridgeWorldFrameFields(
  world_frame_method: RegistrationMode | null | undefined,
  world_frame_approximate: boolean | undefined,
  committed: boolean,
): BridgeWorldFrameFields {
  const approximate =
    typeof world_frame_approximate === "boolean" ? world_frame_approximate : false;
  if (
    world_frame_method === "april_tag" ||
    world_frame_method === "manual_pose"
  ) {
    return {
      world_frame_method,
      world_frame_approximate: approximate,
    };
  }
  if (committed || world_frame_method === null) {
    return { world_frame_method: null, world_frame_approximate: approximate };
  }
  return { world_frame_approximate: approximate };
}

/** Parse optional world-frame fields from bridge_status / runtime_snapshot.bridge. */
export function parseBridgeWorldFrameFields(
  data: Record<string, unknown>,
  committed: boolean,
): BridgeWorldFrameFields {
  const world_frame_approximate =
    typeof data.world_frame_approximate === "boolean"
      ? data.world_frame_approximate
      : undefined;
  let world_frame_method: RegistrationMode | null | undefined;
  if (
    data.world_frame_method === "april_tag" ||
    data.world_frame_method === "manual_pose"
  ) {
    world_frame_method = data.world_frame_method;
  } else if (data.world_frame_method === null) {
    world_frame_method = null;
  } else {
    world_frame_method = undefined;
  }
  return resolveBridgeWorldFrameFields(
    world_frame_method,
    world_frame_approximate,
    committed,
  );
}

export interface PathMessage {
  type: "path";
  ts: number;
  waypoints: [number, number, number][];
}

export type NavStallReason = "no_path" | "planner_idle";

export type WireGoalSource = "user" | "agent";

export interface NavGoalBlock {
  source: WireGoalSource;
  position: [number, number, number];
  orientation: [number, number, number, number];
}

export interface NavStatusMessage {
  type: "nav_status";
  ts: number;
  state: WireNavigationState;
  outcome?: NavTerminalOutcome;
  error_code?: number;
  retryable?: boolean;
  stall_reason?: NavStallReason;
  goal?: NavGoalBlock;
}

export interface SnapshotBridgeState {
  robot_connected: boolean;
  world_frame_committed: boolean;
  reconnecting: boolean;
  world_frame_method?: RegistrationMode | null;
  world_frame_approximate?: boolean;
}

export interface SnapshotNavState {
  state: WireNavigationState;
  outcome?: NavTerminalOutcome | null;
  error_code?: number | null;
  retryable?: boolean;
  stall_reason?: NavStallReason | null;
  goal?: NavGoalBlock;
}

export interface SnapshotAgentState {
  state: WireAgentState;
}

export interface SnapshotPathState {
  waypoints: [number, number, number][];
}

export interface RuntimeSnapshotMessage {
  type: "runtime_snapshot";
  ts: number;
  robot_id: string;
  bridge: SnapshotBridgeState;
  nav: SnapshotNavState;
  agent: SnapshotAgentState;
  path?: SnapshotPathState;
}

export interface PongMessage {
  type: "pong";
  ts: number;
  robot_id: string;
  client_ts: number;
  bridge_ts: number;
}

export type WireAgentState = "idle" | "busy";

export interface AgentResponseMessage {
  type: "agent_response";
  ts: number;
  text: string;
}

export interface AgentStatusMessage {
  type: "agent_status";
  ts: number;
  state: WireAgentState;
  detail?: string;
}

export interface ArSkillMessage {
  type: "ar_skill";
  ts: number;
  request_id: string;
  skill: string;
  args?: Record<string, unknown>;
}

export type InboundMessage =
  | HelloMessage
  | LidarMessage
  | PoseMessage
  | WorldFrameCorrectionMessage
  | RegistrationStatusMessage
  | CameraFrameAckMessage
  | CapturePolicyMessage
  | BridgeStatusMessage
  | PathMessage
  | NavStatusMessage
  | RuntimeSnapshotMessage
  | PongMessage
  | AgentResponseMessage
  | AgentStatusMessage
  | ArSkillMessage;

export type RegistrationCommandAction =
  | "start"
  | "stop"
  | "commit";

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
  return (
    messageType === "lidar" ||
    messageType === "pose" ||
    messageType === "world_frame_correction" ||
    messageType === "agent_response" ||
    messageType === "agent_status" ||
    messageType === "ar_skill"
  );
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

function requireBoolean(obj: Record<string, unknown>, key: string): boolean {
  const value = obj[key];
  if (typeof value !== "boolean") {
    throw new Error(`Missing or invalid boolean field: ${key}`);
  }
  return value;
}

const REGISTRATION_STATES: RegistrationState[] = [
  "idle",
  "april_tag",
  "manual_placement",
  "awaiting_commit",
  "succeeded",
  "failed",
];

const WIRE_NAV_STATES: WireNavigationState[] = [
  "idle",
  "navIntent",
  "navigating",
  "resolved",
];

const NAV_TERMINAL_OUTCOMES: NavTerminalOutcome[] = ["succeeded", "failed"];

function parseNavStallReason(raw: unknown): NavStallReason | undefined {
  if (raw === "no_path" || raw === "planner_idle") {
    return raw;
  }
  return undefined;
}

function parsePreviewPose(raw: unknown): RegistrationPreviewPose | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const pose = raw as Record<string, unknown>;
  const q = pose.orientation;
  if (!Array.isArray(q) || q.length !== 4) {
    return undefined;
  }
  return {
    position: parseVec3(pose.position),
    orientation: [Number(q[0]), Number(q[1]), Number(q[2]), Number(q[3])],
  };
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

function parseQuat(raw: unknown): [number, number, number, number] {
  if (!Array.isArray(raw) || raw.length !== 4) {
    throw new Error("orientation must be [qx, qy, qz, qw]");
  }
  return [Number(raw[0]), Number(raw[1]), Number(raw[2]), Number(raw[3])];
}

function parseTagTrackingProfile(raw: unknown): TagTrackingProfile | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const profile = raw as Record<string, unknown>;
  if (!Array.isArray(profile.tag_ids)) {
    return undefined;
  }
  const tagIds = profile.tag_ids.map((id) => Number(id));
  if (tagIds.some((id) => !Number.isFinite(id))) {
    return undefined;
  }
  if (typeof profile.tag_total_size_m !== "number") {
    return undefined;
  }
  return {
    tag_ids: tagIds,
    tag_total_size_m: profile.tag_total_size_m,
  };
}

function parseSnapshotBridge(raw: unknown): SnapshotBridgeState {
  const bridge = requireObject(raw);
  const status: SnapshotBridgeState = {
    robot_connected: Boolean(bridge.robot_connected),
    world_frame_committed: Boolean(bridge.world_frame_committed),
    reconnecting: Boolean(bridge.reconnecting),
  };
  const method = bridge.world_frame_method;
  if (method === "april_tag" || method === "manual_pose") {
    status.world_frame_method = method;
  } else if (method === null) {
    status.world_frame_method = null;
  }
  if (typeof bridge.world_frame_approximate === "boolean") {
    status.world_frame_approximate = bridge.world_frame_approximate;
  }
  return status;
}

function parseNavGoalBlock(raw: unknown): NavGoalBlock | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  const goal = requireObject(raw);
  const source = requireString(goal, "source");
  if (source !== "user" && source !== "agent") {
    throw new Error(`Missing or invalid field: source`);
  }
  return {
    source,
    position: parseVec3(goal.position),
    orientation: parseQuat(goal.orientation),
  };
}

function parseSnapshotNav(raw: unknown): SnapshotNavState {
  const nav = requireObject(raw);
  const state = requireString(nav, "state");
  if (!WIRE_NAV_STATES.includes(state as WireNavigationState)) {
    throw new Error(`Missing or invalid field: state`);
  }
  const status: SnapshotNavState = { state: state as WireNavigationState };
  if (typeof nav.outcome === "string") {
    if (!NAV_TERMINAL_OUTCOMES.includes(nav.outcome as NavTerminalOutcome)) {
      throw new Error(`Missing or invalid field: outcome`);
    }
    status.outcome = nav.outcome as NavTerminalOutcome;
  } else if (nav.outcome === null) {
    status.outcome = null;
  }
  if (typeof nav.error_code === "number") {
    status.error_code = nav.error_code;
  } else if (nav.error_code === null) {
    status.error_code = null;
  }
  if (typeof nav.retryable === "boolean") {
    status.retryable = nav.retryable;
  }
  const stallReason = parseNavStallReason(nav.stall_reason);
  if (stallReason) {
    status.stall_reason = stallReason;
  } else if (nav.stall_reason === null) {
    status.stall_reason = null;
  }
  const goal = parseNavGoalBlock(nav.goal);
  if (goal) {
    status.goal = goal;
  }
  return status;
}

function parseSnapshotAgent(raw: unknown): SnapshotAgentState {
  const agent = requireObject(raw);
  const state = requireString(agent, "state");
  if (state !== "idle" && state !== "busy") {
    throw new Error(`Missing or invalid field: state`);
  }
  return { state };
}

function parseSnapshotPath(raw: unknown): SnapshotPathState {
  const path = requireObject(raw);
  return {
    waypoints: parsePoints(path.waypoints),
  };
}

function parsePathMessage(data: Record<string, unknown>): PathMessage {
  return {
    type: "path",
    ts: requireNumber(data, "ts"),
    waypoints: parsePoints(data.waypoints),
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
      const tagTrackingProfile = parseTagTrackingProfile(
        robot.tag_tracking_profile,
      );
      if (tagTrackingProfile) {
        hello.robot.tag_tracking_profile = tagTrackingProfile;
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

    case "runtime_snapshot": {
      const snapshot: RuntimeSnapshotMessage = {
        type: "runtime_snapshot",
        ts: requireNumber(data, "ts"),
        robot_id: requireString(data, "robot_id"),
        bridge: parseSnapshotBridge(data.bridge),
        nav: parseSnapshotNav(data.nav),
        agent: parseSnapshotAgent(data.agent),
      };
      if (data.path !== undefined) {
        snapshot.path = parseSnapshotPath(data.path);
      }
      return snapshot;
    }

    case "registration_status": {
      if (typeof data.phase === "string") {
        print(`Protocol: legacy registration_status.phase rejected; use state`);
        return null;
      }
      const state = requireString(data, "state");
      if (!REGISTRATION_STATES.includes(state as RegistrationState)) {
        print(`Protocol: unknown registration_status.state "${state}"; skipping`);
        return null;
      }
      const mode = data.mode;
      if (
        mode !== undefined &&
        mode !== "april_tag" &&
        mode !== "manual_pose"
      ) {
        print(`Protocol: unknown registration_status.mode "${mode}"; skipping`);
        return null;
      }
      const msg: RegistrationStatusMessage = {
        type: "registration_status",
        ts: requireNumber(data, "ts"),
        state: state as RegistrationState,
        message: typeof data.message === "string" ? data.message : "",
      };
      if (mode === "april_tag" || mode === "manual_pose") {
        msg.mode = mode;
      }
      if (typeof data.tag_visible === "boolean") {
        msg.tag_visible = data.tag_visible;
      }
      const previewPose = parsePreviewPose(data.preview_pose);
      if (previewPose) {
        msg.preview_pose = previewPose;
      }
      if (typeof data.progress === "number" && Number.isFinite(data.progress)) {
        msg.progress = Math.max(0, Math.min(100, Math.round(data.progress)));
      }
      if (
        typeof data.registration_confidence === "number" &&
        Number.isFinite(data.registration_confidence)
      ) {
        msg.registration_confidence = Math.max(
          0,
          Math.min(1, data.registration_confidence),
        );
      }
      if (typeof data.scale_locked === "boolean") {
        msg.scale_locked = data.scale_locked;
      }
      return msg;
    }

    case "camera_frame_ack": {
      return {
        type: "camera_frame_ack",
        ts: requireNumber(data, "ts"),
        seq: requireNumber(data, "seq"),
        capturing_budgeted_complete: requireBoolean(data, "capturing_budgeted_complete"),
      };
    }

    case "capture_policy": {
      return {
        type: "capture_policy",
        ts: requireNumber(data, "ts"),
        max_capture_distance_m: requireNumber(data, "max_capture_distance_m"),
        min_capture_distance_m: requireNumber(data, "min_capture_distance_m"),
        max_capture_speed_mps: requireNumber(data, "max_capture_speed_mps"),
        static_speed_mps: requireNumber(data, "static_speed_mps"),
        min_observations: requireNumber(data, "min_observations"),
      };
    }

    case "bridge_status": {
      const committed = Boolean(data.world_frame_committed);
      const worldFrame = parseBridgeWorldFrameFields(data, committed);
      const status: BridgeStatusMessage = {
        type: "bridge_status",
        ts: requireNumber(data, "ts"),
        robot_connected: Boolean(data.robot_connected),
        world_frame_committed: committed,
        reconnecting: Boolean(data.reconnecting),
        world_frame_approximate: worldFrame.world_frame_approximate,
      };
      if (worldFrame.world_frame_method !== undefined) {
        status.world_frame_method = worldFrame.world_frame_method;
      }
      return status;
    }

    case "pose": {
      const q = data.orientation;
      if (!Array.isArray(q) || q.length !== 4) {
        throw new Error("orientation must be [qx, qy, qz, qw]");
      }
      return {
        type: "pose",
        ts: requireNumber(data, "ts"),
        position: parseVec3(data.position),
        ...(typeof data.speed_mps === "number" ? { speed_mps: Number(data.speed_mps) } : {}),
        ...(Array.isArray(data.velocity_mps) && data.velocity_mps.length === 3
          ? { velocity_mps: parseVec3(data.velocity_mps) }
          : {}),
        ...(typeof data.yaw_rate_rad_s === "number"
          ? { yaw_rate_rad_s: Number(data.yaw_rate_rad_s) }
          : {}),
        orientation: [Number(q[0]), Number(q[1]), Number(q[2]), Number(q[3])],
      };
    }

    case "world_frame_correction": {
      const solveMethod = data.solve_method;
      if (
        solveMethod !== "apriltag_full" &&
        solveMethod !== "apriltag_translation" &&
        solveMethod !== "similarity"
      ) {
        print(
          `Protocol: unknown world_frame_correction.solve_method "${solveMethod}"; skipping`,
        );
        return null;
      }
      const msg: WorldFrameCorrectionMessage = {
        type: "world_frame_correction",
        ts: requireNumber(data, "ts"),
        trans_delta_m: requireNumber(data, "trans_delta_m"),
        yaw_corrected: Boolean(data.yaw_corrected),
        solve_quality: requireNumber(data, "solve_quality"),
        solve_method: solveMethod,
      };
      if (typeof data.yaw_delta_deg === "number") {
        msg.yaw_delta_deg = data.yaw_delta_deg;
      }
      if (
        typeof data.alignment_confidence === "number" &&
        Number.isFinite(data.alignment_confidence)
      ) {
        msg.alignment_confidence = Math.max(0, Math.min(1, data.alignment_confidence));
      }
      if (typeof data.yaw_observable === "boolean") {
        msg.yaw_observable = data.yaw_observable;
      }
      if (typeof data.scale_observable === "boolean") {
        msg.scale_observable = data.scale_observable;
      }
      if (
        typeof data.scale_confidence === "number" &&
        Number.isFinite(data.scale_confidence)
      ) {
        msg.scale_confidence = Math.max(0, Math.min(1, data.scale_confidence));
      }
      if (
        typeof data.yaw_confidence === "number" &&
        Number.isFinite(data.yaw_confidence)
      ) {
        msg.yaw_confidence = Math.max(0, Math.min(1, data.yaw_confidence));
      }
      if (typeof data.scale_held === "boolean") {
        msg.scale_held = data.scale_held;
      }
      if (typeof data.yaw_held === "boolean") {
        msg.yaw_held = data.yaw_held;
      }
      return msg;
    }

    case "path": {
      return parsePathMessage(data);
    }

    case "nav_status": {
      const state = requireString(data, "state");
      if (!WIRE_NAV_STATES.includes(state as WireNavigationState)) {
        print(`Protocol: unknown nav_status.state "${state}"; skipping`);
        return null;
      }
      const msg: NavStatusMessage = {
        type: "nav_status",
        ts: requireNumber(data, "ts"),
        state: state as WireNavigationState,
      };
      if (typeof data.outcome === "string") {
        if (!NAV_TERMINAL_OUTCOMES.includes(data.outcome as NavTerminalOutcome)) {
          print(`Protocol: unknown nav_status.outcome "${data.outcome}"; skipping`);
          return null;
        }
        msg.outcome = data.outcome as NavTerminalOutcome;
      }
      if (typeof data.error_code === "number") {
        msg.error_code = data.error_code;
      }
      if (typeof data.retryable === "boolean") {
        msg.retryable = data.retryable;
      }
      const stallReason = parseNavStallReason(data.stall_reason);
      if (stallReason) {
        msg.stall_reason = stallReason;
      }
      try {
        const goal = parseNavGoalBlock(data.goal);
        if (goal) {
          msg.goal = goal;
        }
      } catch (error) {
        print(
          `Protocol: invalid nav_status.goal; skipping (${error instanceof Error ? error.message : String(error)})`,
        );
        return null;
      }
      return msg;
    }

    case "pong": {
      return {
        type: "pong",
        ts: requireNumber(data, "ts"),
        robot_id: requireString(data, "robot_id"),
        client_ts: requireNumber(data, "client_ts"),
        bridge_ts: requireNumber(data, "bridge_ts"),
      };
    }

    case "agent_response": {
      return {
        type: "agent_response",
        ts: requireNumber(data, "ts"),
        text: requireString(data, "text"),
      };
    }

    case "agent_status": {
      const state = requireString(data, "state");
      if (state !== "idle" && state !== "busy") {
        print(`Protocol: unknown agent_status.state "${state}"; skipping`);
        return null;
      }
      const msg: AgentStatusMessage = {
        type: "agent_status",
        ts: requireNumber(data, "ts"),
        state,
      };
      if (typeof data.detail === "string") {
        msg.detail = data.detail;
      }
      return msg;
    }

    case "ar_skill": {
      const requestId = requireString(data, "request_id");
      const skill = requireString(data, "skill");
      if (!requestId || !skill) {
        throw new Error("ar_skill requires non-empty request_id and skill");
      }
      const msg: ArSkillMessage = {
        type: "ar_skill",
        ts: requireNumber(data, "ts"),
        request_id: requestId,
        skill,
      };
      if (data.args !== undefined) {
        msg.args = requireObject(data.args);
      }
      return msg;
    }

    default:
      return null;
  }
}

export type BridgeWireStatus = BridgeStatusMessage | SnapshotBridgeState;

function bridgeWireFieldsFromStatus(
  status: BridgeWireStatus,
  ts: number,
): BridgeSnapshot {
  const worldFrame = resolveBridgeWorldFrameFields(
    status.world_frame_method,
    status.world_frame_approximate,
    status.world_frame_committed,
  );
  return {
    handshakeReady: true,
    robotConnected: status.robot_connected,
    worldFrameCommitted: status.world_frame_committed,
    worldFrameApproximate: worldFrame.world_frame_approximate,
    reconnecting: status.reconnecting,
    worldFrameMethod: worldFrame.world_frame_method ?? null,
    statusTs: ts,
  };
}

/** Project wire bridge fields + session flags into app bridge session state. */
export function projectBridgeSession(
  handshakeReady: boolean,
  status: BridgeWireStatus | null,
  statusTs: number | null = status && "ts" in status ? status.ts : null,
): BridgeSnapshot {
  if (!handshakeReady) {
    return createDefaultBridgeSnapshot();
  }
  if (!status) {
    return {
      ...createDefaultBridgeSnapshot(),
      handshakeReady: true,
    };
  }
  const ts = statusTs ?? ("ts" in status ? status.ts : null);
  if (ts === null) {
    return {
      handshakeReady: true,
      robotConnected: status.robot_connected,
      worldFrameCommitted: status.world_frame_committed,
      worldFrameApproximate: status.world_frame_approximate ?? false,
      reconnecting: status.reconnecting,
      worldFrameMethod: status.world_frame_method ?? null,
      statusTs: null,
    };
  }
  return bridgeWireFieldsFromStatus(status, ts);
}

export function deriveLinkStateFromSnapshot(
  snapshot: BridgeSnapshot,
): BridgeLinkState {
  if (!snapshot.handshakeReady) {
    return "disconnected";
  }
  if (snapshot.reconnecting || !snapshot.robotConnected) {
    return "connectedNoRobot";
  }
  return "connected";
}

/** Reconstruct wire-shaped bridge_status for handlers that expect the message type. */
export function bridgeSnapshotToStatusMessage(
  snapshot: BridgeSnapshot,
): BridgeStatusMessage | null {
  if (!snapshot.handshakeReady || snapshot.statusTs === null) {
    return null;
  }
  const msg: BridgeStatusMessage = {
    type: "bridge_status",
    ts: snapshot.statusTs,
    robot_connected: snapshot.robotConnected,
    world_frame_committed: snapshot.worldFrameCommitted,
    reconnecting: snapshot.reconnecting,
    world_frame_approximate: snapshot.worldFrameApproximate,
  };
  if (
    snapshot.worldFrameMethod === "april_tag" ||
    snapshot.worldFrameMethod === "manual_pose"
  ) {
    msg.world_frame_method = snapshot.worldFrameMethod;
  }
  return msg;
}

// ── Outbound builders ──────────────────────────────────────────

export function buildGetStatus(robotId: string): string {
  return JSON.stringify({
    type: "get_status",
    ts: getTime(),
    robot_id: robotId,
  });
}

export function buildSetLidarMode(
  robotId: string,
  mode: "off" | "obstacles" | "full",
  settings: LidarObstacleSettings = DEFAULT_LIDAR_OBSTACLE_SETTINGS,
): string {
  const payload: Record<string, unknown> = {
    type: "set_lidar_mode",
    ts: getTime(),
    robot_id: robotId,
    mode,
  };
  if (mode === "obstacles") {
    payload.obstacle_min_distance_m = settings.minDistanceM;
    payload.obstacle_opaque_distance_m = settings.opaqueDistanceM;
    payload.obstacle_max_distance_m = settings.maxDistanceM;
  }
  return JSON.stringify(payload);
}

export function buildRegistrationCommand(
  robotId: string,
  command: RegistrationCommandAction,
  mode?: RegistrationMode,
): string {
  const payload: Record<string, unknown> = {
    type: "registration_command",
    ts: getTime(),
    robot_id: robotId,
    command,
  };
  if (mode !== undefined) {
    payload.mode = mode;
  }
  return JSON.stringify(payload);
}

export function buildRegistrationPose(
  position: vec3,
  rotation: quat,
  robotId: string,
): string {
  return JSON.stringify({
    type: "registration_pose",
    ts: getTime(),
    robot_id: robotId,
    position: lensCentimetersToProtocolMeters(position),
    orientation: [rotation.x, rotation.y, rotation.z, rotation.w],
  });
}

export function buildNavGoal(
  robotId: string,
  position: vec3,
  rotation?: quat | null,
): string {
  const payload: Record<string, unknown> = {
    type: "nav_goal",
    ts: getTime(),
    robot_id: robotId,
    position: lensCentimetersToProtocolMeters(position),
  };
  if (rotation) {
    payload.orientation = [rotation.x, rotation.y, rotation.z, rotation.w];
  }
  return JSON.stringify(payload);
}

export function buildNavigateGoal(
  robotId: string,
  position: vec3,
  rotation: quat,
): string {
  return buildNavGoal(robotId, position, rotation);
}

export function buildPing(clientTs: number, robotId: string): string {
  return JSON.stringify({
    type: "ping",
    ts: getTime(),
    robot_id: robotId,
    client_ts: clientTs,
  });
}

export function buildUserCommand(robotId: string, text: string): string {
  return JSON.stringify({
    type: "user_command",
    ts: getTime(),
    robot_id: robotId,
    text,
  });
}

export function buildArSkillResult(args: {
  robotId: string;
  requestId: string;
  ok: boolean;
  skill: string;
  data?: Record<string, unknown>;
  error?: string;
}): string {
  const payload: Record<string, unknown> = {
    type: "ar_skill_result",
    ts: getTime(),
    robot_id: args.robotId,
    request_id: args.requestId,
    ok: args.ok,
    skill: args.skill,
  };
  if (args.data !== undefined) {
    payload.data = args.data;
  }
  if (args.error !== undefined) {
    payload.error = args.error;
  }
  return JSON.stringify(payload);
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

const CAMERA_FRAME_MAGIC = [0x41, 0x52, 0x46, 0x31];

export function buildCameraFrameBytes(args: {
  robotId: string;
  seq: number;
  ts: number;
  sendTs: number;
  camPos: vec3;
  camRot: quat;
  jpegBytes: Uint8Array;
  captureTsRobot?: number;
}): Uint8Array {
  const headerObj: Record<string, unknown> = {
    type: "camera_frame",
    robot_id: args.robotId,
    seq: args.seq,
    ts: args.ts,
    send_ts: args.sendTs,
    cam_pos: lensCentimetersToProtocolMeters(args.camPos),
    cam_rot: [args.camRot.x, args.camRot.y, args.camRot.z, args.camRot.w],
  };
  if (args.captureTsRobot !== undefined) {
    headerObj.capture_ts_robot = args.captureTsRobot;
  }
  const header = JSON.stringify(headerObj);
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

export function buildCancelNavGoal(robotId: string): string {
  return JSON.stringify({
    type: "cancel_nav_goal",
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
 * Binary frames carry no robot_id; the session robot comes from hello.
 */
export function parseLidarBinary(data: Uint8Array): LidarMessage | null {
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
  return { type: "lidar", ts, points };
}

/** Derive BridgeLinkState from connection + bridge_status flags. */
export function deriveLinkState(
  connected: boolean,
  status: BridgeStatusMessage | null,
): BridgeLinkState {
  if (!connected) {
    return "disconnected";
  }
  return deriveLinkStateFromSnapshot(
    projectBridgeSession(true, status),
  );
}

/** @deprecated Use projectBridgeSession */
export function projectBridgeSnapshot(
  handshakeReady: boolean,
  status: BridgeStatusMessage | null,
): BridgeSnapshot {
  return projectBridgeSession(handshakeReady, status);
}
