// ================================================================
/**
 * Canonical TypeScript message schemas and active-robot ID state synced with Python protocol.py.
 * Keep in sync with dimos_xr/protocol.py and dimos-xr/PROTOCOL.md.
 */
// ================================================================

export const PROTOCOL_VERSION = 2;

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

export interface HelloMessage {
  type: "hello";
  protocol_version: number;
  robot: RobotHelloInfo;
  capabilities: string[];
  disabled_capabilities: string[];
  capability_states: Record<string, CapabilityState>;
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
  method?: "marker" | "manual";
  message: string;
}

export interface BridgeStatusMessage {
  type: "bridge_status";
  ts: number;
  robot_id: string;
  robot_connected: boolean;
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
  goal_failed: boolean;
}

export type InboundMessage =
  | HelloMessage
  | LidarMessage
  | PoseMessage
  | AlignStatusMessage
  | BridgeStatusMessage
  | PathMessage
  | NavStatusMessage;
