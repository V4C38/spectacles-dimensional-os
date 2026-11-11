import type { NavGoal, Quat, Vec3, ReadonlyFacts } from "../websocket/protocolTypes";

export type InteractionKind = "live" | "navigation_planning" | "joystick" | "manipulation_planning" | "manipulation_following";
export interface InteractionPose { position: Vec3; orientation: Quat; }
export interface InteractionTarget extends InteractionPose {
  domain: "navigation" | "manipulation"; group_id?: string; speed_scale?: number; gripper?: number;
  revision: number; phase: "draft" | "live" | "committed"; sample_ts: number; sequence: number;
}
export interface InteractionAuthority {
  client_id: string; source_id: string; acquisition_id: string; lease_id: string;
  group_id?: string | null;
  kind: InteractionKind; held: boolean; expires_at: number; sequence: number;
}
export interface InteractionState {
  type: "interaction_state"; epoch: string; revision: number; mode: "manual" | "agent";
  authority: InteractionAuthority | null;
  targets: InteractionTarget[];
  following_tail: import("../manipulation/ManipulationTypes").FollowingTail | null;
  motion_busy: boolean;
  preview: NavGoal | null; active_goal: NavGoal | null;
}
export interface InteractionResult {
  type: "interaction_result"; request_id: string; epoch: string; revision: number;
  status: "accepted" | "busy" | "stale" | "rejected"; code: string; lease_id?: string;
}
export interface InteractionCredentials { epoch: string; lease_id: string; sequence: number; }

export interface InteractionSettings { group_id?: string; speed_scale?: number; gripper?: number; }

export type InteractionDomain = "navigation" | "manipulation";
export interface InteractionSnapshot {
  readonly blocked: boolean;
  readonly pending: boolean;
  readonly ownsAuthority: boolean;
  readonly authority: Readonly<InteractionAuthority> | null;
  readonly planning: boolean;
  readonly mode: "manual" | "agent";
  readonly settings: Readonly<InteractionSettings>;
  readonly settling: boolean;
  readonly target: Readonly<InteractionPose> | null;
  readonly rawTarget: Readonly<InteractionTarget> | null;
  readonly phase: InteractionTarget["phase"] | null;
  readonly stale: boolean;
  readonly preview: Readonly<NavGoal> | null;
  readonly activeGoal: Readonly<NavGoal> | null;
}

/** Consumers use observational facts and commands, independent of the implementation. */
export interface InteractionAuthorityPort {
  readonly denialRevision: number;
  raw(): ReadonlyFacts<InteractionState> | null;
  snapshot(domain?: InteractionDomain, groupId?: string, now?: number): InteractionSnapshot;
  begin(kind: InteractionKind, sourceId: string, pose?: InteractionPose, settings?: InteractionSettings): boolean;
  update(pose: InteractionPose, settings?: InteractionSettings): void;
  credentials(): InteractionCredentials | null;
  release(pose?: InteractionPose, kinds?: readonly InteractionKind[]): number | null;
  confirm(pose?: InteractionPose, kinds?: readonly InteractionKind[]): void;
  cancel(kinds?: readonly InteractionKind[]): void;
}
