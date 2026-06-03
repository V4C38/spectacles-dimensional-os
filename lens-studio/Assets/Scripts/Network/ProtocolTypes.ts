/** Keep in sync with dimos_ar/protocol.py and docs/PROTOCOL.md */

export const PROTOCOL_VERSION = 1;
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
  method?: "marker" | "manual";
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
  | RegisteredMessage
  | AlignStatusMessage
  | BridgeStatusMessage
  | PathMessage
  | NavStatusMessage;
