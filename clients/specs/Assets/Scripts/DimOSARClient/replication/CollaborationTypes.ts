import type { NavGoal, Quat, Vec3 } from "../websocket/protocolTypes";

export type InteractionKind = "live" | "navigation_planning" | "joystick" | "manipulation_planning" | "manipulation_following";
export interface InteractionPose { position: Vec3; orientation: Quat; }
export interface InteractionTarget extends InteractionPose {
  domain?: "navigation" | "manipulation"; group_id?: string; speed_scale?: number; gripper?: number;
  revision: number; phase: "draft" | "live" | "committed"; sample_ts: number; sequence: number;
}
export interface InteractionAuthority {
  client_id: string; source_id: string; acquisition_id: string; lease_id: string;
  group_id?: string | null;
  kind: InteractionKind; held: boolean; expires_at: number; sequence: number;
}
export interface InteractionState {
  type: "interaction_state"; epoch: string; revision: number; mode: "manual" | "agent";
  authority: InteractionAuthority | null; target: InteractionTarget | null;
  targets?: InteractionTarget[];
  following_tail?: import("../manipulation/ManipulationTypes").FollowingTail | null;
  motion_busy?: boolean;
  preview: NavGoal | null; active_goal: NavGoal | null;
}
export interface InteractionResult {
  type: "interaction_result"; request_id: string; epoch: string; revision: number;
  status: "accepted" | "busy" | "stale" | "rejected"; code: string; lease_id?: string;
}
export interface InteractionCredentials { epoch: string; lease_id: string; sequence: number; }

export interface InteractionSettings { group_id?: string; speed_scale?: number; gripper?: number; }

/** Interaction consumers depend on authority operations, not session or transport internals. */
export type InteractionAuthorityPort = Pick<import("./CollaborationController").CollaborationController,
  "raw" | "snapshot" | "denialRevision" | "begin" | "update" | "credentials" | "release" | "confirm" | "cancel">;
