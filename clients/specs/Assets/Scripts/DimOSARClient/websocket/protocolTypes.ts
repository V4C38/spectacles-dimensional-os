export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type YawPose = [number, number, number, number];

export type CapturePolicy =
  | "robot_los_required"
  | "robot_los_preferred"
  | "any_angle";

export type DistortionModel = "none" | "plumb_bob" | "equidistant";

export const CAPABILITY_NAMES = [
  "lidar",
  "navigation",
  "localization",
  "estop",
  "agent",
] as const;
export type CapabilityName = (typeof CAPABILITY_NAMES)[number];

export const NAVIGATION_INPUT_NAMES = ["nav_goal", "nav_joystick"] as const;
export type NavigationInputName = (typeof NAVIGATION_INPUT_NAMES)[number];

export type NavPhase = "idle" | "following_path" | "resolved";
export type NavOutcome = "succeeded" | "failed";

export type Capability =
  | { available: true; reason: null }
  | { available: false; reason: string };

export type NavigationCapability = Capability & {
  nav_goal: Capability;
  nav_joystick: Capability;
};

export type Capabilities = {
  [K in Exclude<CapabilityName, "navigation">]: Capability;
} & { navigation: NavigationCapability };

export interface TimeSync {
  ts_client: number;
  ts_server: number;
}

export interface RobotDescription {
  display_name: string;
  body_bounds_m: Vec3;
  footprint_m: [number, number];
  base_height_m: number;
}

export interface Hello {
  type: "hello";
  client_id: string;
  time_sync: TimeSync;
  robot: RobotDescription;
  capabilities: Capabilities;
}

export interface LidarSettings {
  enabled: boolean;
  min_height_m: number;
  max_height_m: number;
  max_range_m: number;
}

export type NavState =
  | { state: "idle" | "following_path"; outcome: null }
  | { state: "resolved"; outcome: NavOutcome };

export interface AgentState {
  idle: boolean;
}

export interface State {
  type: "state";
  server: { connected_clients: number };
  lidar: LidarSettings;
  nav: NavState;
  agent: AgentState;
}

export interface AgentMessage {
  type: "agent_message";
  text: string;
}

export interface AgentSkill {
  type: "agent_skill";
  name: string;
  args: Record<string, unknown>;
}

export type LocalizationObservationsRequest =
  | {
      type: "localization_observations_request";
      capture_policy: "robot_los_required" | "any_angle";
      observation_count: number;
    }
  | {
      type: "localization_observations_request";
      capture_policy: "robot_los_preferred";
      observation_count: number;
      wait_timeout_s: number;
    };

export interface LocalizationResult {
  type: "localization_result";
  position: Vec3;
  orientation: Quat;
  confidence: number;
  ts: number;
}

export interface Pose {
  type: "pose";
  position: Vec3;
  orientation: Quat;
  ts: number;
}

export interface NavGoal {
  type: "nav_goal";
  pose: YawPose | null;
  path_poses: YawPose[];
  ts: number;
}

export interface Lidar {
  type: "lidar";
  ts: number;
  points: Vec3[];
}

export type Outbound =
  | Hello
  | State
  | LocalizationObservationsRequest
  | LocalizationResult
  | Pose
  | NavGoal
  | Lidar
  | AgentMessage
  | AgentSkill;

export interface HelloRequest {
  type: "hello_request";
  ts_client: number;
}

export interface StateRequest {
  type: "state_request";
}

export interface LocalizationStartRequest {
  type: "localization_start_request";
}

export interface NavGoalRequest {
  type: "nav_goal_request";
  position: Vec3;
  orientation: Quat;
}

export interface EstopRequest {
  type: "estop_request";
}

export interface LidarSettingsRequest extends LidarSettings {
  type: "lidar_settings_request";
}

export interface UserMessageRequest {
  type: "user_message_request";
  text: string;
}

export interface ClientPose {
  type: "client_pose";
  position: Vec3;
  orientation: Quat;
  ts: number;
}

export interface NavJoystickRequest {
  type: "nav_joystick_request";
  linear: Vec3;
  angular: Vec3;
  duration?: number;
}

export interface Intrinsics {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
  distortion_model: DistortionModel;
  distortion: number[];
}

export interface LocalizationObservation {
  ts_capture: number;
  jpeg: Uint8Array;
  intrinsics: Intrinsics;
  camera_position: Vec3;
  camera_orientation: Quat;
}

export interface LocalizationObservations {
  type: "localization_observations";
  observations: LocalizationObservation[];
}

export type Inbound =
  | HelloRequest
  | StateRequest
  | LocalizationStartRequest
  | LocalizationObservations
  | NavGoalRequest
  | NavJoystickRequest
  | EstopRequest
  | LidarSettingsRequest
  | UserMessageRequest
  | ClientPose;
