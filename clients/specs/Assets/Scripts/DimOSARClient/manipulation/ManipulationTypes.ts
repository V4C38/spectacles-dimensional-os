import type { Capability, Quat, Vec3 } from "../websocket/protocolTypes";

export interface ManipulationPose {
  position: Vec3;
  orientation: Quat;
}
export type ManipulationAction =
  | "evaluate"
  | "plan"
  | "execute"
  | "cancel"
  | "resume"
  | "acquire"
  | "update"
  | "release"
  | "gripper"
  | "reset_joints"
  | "prepare_shutdown";
export interface ManipulationJoint {
  name: string;
  kind: "fixed" | "revolute" | "continuous" | "prismatic";
  parent: string;
  child: string;
  axis: Vec3;
  origin: ManipulationPose;
  limits?: { lower: number; upper: number } | null;
  mimic: { joint: string; multiplier: number; offset: number } | null;
}
export interface ManipulationModel {
  visual_signature?: string;
  visual_profile?: string;
  gripper_joints?: Record<string, { closed: number; open: number }>;
  revision: string;
  root: string;
  asset_url: string | null;
  links: { name: string; bounds: { center: Vec3; size: Vec3 } | null }[];
  joints: ManipulationJoint[];
}
export interface ManipulationGroup {
  id: string;
  joint_names: string[];
  base_frame: string;
  tip_frame: string | null;
  has_gripper: boolean;
  following: boolean;
}
export interface ManipulationPlan {
  plan_id: string;
  joint_names: string[];
  trajectory: { time: number; positions: number[] }[];
  duration: number;
}
export interface ManipulationObservation {
  joints: Record<string, number> | null;
  measured_at: number | null;
  pose: ManipulationPose | null;
  gripper: number | null;
}
export interface ManipulationState {
  type: "manipulation_state";
  available: boolean;
  message?: string | null;
  ts?: number;
  root_pose?: ManipulationPose;
  model?: ManipulationModel;
  groups?: ManipulationGroup[];
  observations?: Record<string, ManipulationObservation>;
  execution?: string;
  operation?: "resetting" | "parking" | null;
  owner?: string | null;
  following?: boolean;
  stopped?: boolean;
  stop_confirmed?: boolean;
  plan?: ManipulationPlan | null;
  operation_id?: string | null;
}
export interface ManipulationResult {
  type: "manipulation_result";
  request_id: string;
  action: ManipulationAction;
  group_id: string;
  status: string;
  quiescent?: boolean;
  sequence?: number;
  code?: string;
  message?: string;
  token?: string;
  joints?: Record<string, number> | null;
  pose?: ManipulationPose | null;
  plan_id?: string;
  joint_names?: string[];
  trajectory?: { time: number; positions: number[] }[];
  duration?: number;
  operation_id?: string | null;
}
export type ManipulationOutbound = ManipulationState | ManipulationResult;
export type ManipulationCapability = Capability;
