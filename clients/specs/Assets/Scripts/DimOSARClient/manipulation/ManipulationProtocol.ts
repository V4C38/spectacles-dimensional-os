import { object, text, finite, vector, pose } from "./ManipulationValidation";
import { isValidatedBulkAsset, validatedBulkArray } from "../websocket/BulkTransfer";
import { validateManipulationModel } from "./ManipulationModelValidation";
import type {
  FollowingTail,
  ManipulationAction,
  ManipulationOutbound,
  ManipulationPose,
} from "./ManipulationTypes";

const ACTIONS: readonly string[] = [
  "evaluate",
  "plan",
  "execute",
  "cancel",
  "resume",
  "acquire",
  "update",
  "release",
  "gripper",
  "reset_joints",
  "prepare_shutdown",
];
function joints(value: unknown): void {
  for (const v of Object.values(object(value))) finite(v);
}
function plan(value: Record<string, unknown>): void {
  text(value.plan_id);
  if (value.target_revision !== undefined && (!Number.isSafeInteger(value.target_revision) || Number(value.target_revision) < 0)) throw new Error("Invalid plan target revision");
  if (value.group_id !== undefined) text(value.group_id);
  if (!Array.isArray(value.joint_names) || !value.joint_names.length)
    throw new Error("Missing joint names");
  value.joint_names.forEach(text);
  if (new Set(value.joint_names).size !== value.joint_names.length)
    throw new Error("Duplicate joints");
  const count = value.joint_names.length;
  if (
    !Array.isArray(value.trajectory) ||
    value.trajectory.length < 1 ||
    value.trajectory.length > 8192
  )
    throw new Error("Invalid trajectory");
  const cached = validatedBulkArray(value.trajectory);
  if (cached) {
    if (cached.names?.length !== value.joint_names.length || cached.names.some((name, i) => name !== (value.joint_names as unknown[])[i]) || finite(value.duration) < cached.lastTime) throw new Error("Bulk plan metadata mismatch");
    return;
  }
  let previous = -1;
  for (const raw of value.trajectory) {
    const point = object(raw),
      time = finite(point.time);
    if (time < 0 || time < previous)
      throw new Error("Trajectory time is not monotonic");
    previous = time;
    vector(point.positions, count);
  }
  if (finite(value.duration) < previous)
    throw new Error("Trajectory exceeds duration");
}

export function decodeFollowingTail(value: unknown): FollowingTail | null {
  if (value == null) return null;
  const tail = object(value);
  text(tail.group_id);
  for (const field of ["generation", "target_revision"]) {
    if (!Number.isSafeInteger(tail[field]) || Number(tail[field]) < 0) throw new Error("Invalid finishing generation");
  }
  if (tail.status !== "finishing") throw new Error("Invalid finishing status");
  if (tail.position !== undefined || tail.orientation !== undefined) pose(tail);
  if (tail.speed_scale !== undefined && (finite(tail.speed_scale) <= 0 || Number(tail.speed_scale) > 1)) throw new Error("Invalid finishing speed");
  if (tail.joints !== undefined) joints(tail.joints);
  return tail as unknown as FollowingTail;
}

export function decodeManipulation(
  data: Record<string, unknown>,
): ManipulationOutbound {
  if (data.type === "manipulation_result") {
    if (data.target_revision !== undefined && (!Number.isSafeInteger(data.target_revision) || Number(data.target_revision) < 0))
      throw new Error("Invalid advisory target revision");
    text(data.request_id);
    text(data.group_id);
    text(data.status);
    if (data.quiescent !== undefined && typeof data.quiescent !== "boolean")
      throw new Error("Invalid shutdown acknowledgment");
    if (data.code !== undefined) text(data.code);
    if (data.failed_joints !== undefined) {
      if (!Array.isArray(data.failed_joints) || data.failed_joints.length > 256)
        throw new Error("Invalid failed joints");
      data.failed_joints.forEach(text);
    }
    if (
      data.sequence !== undefined &&
      (!Number.isSafeInteger(data.sequence) || Number(data.sequence) < 0)
    )
      throw new Error("Invalid update sequence");
    if (!ACTIONS.includes(String(data.action)))
      throw new Error("Unknown manipulation action");
    if (data.token !== undefined) text(data.token);
    if (data.joints != null) joints(data.joints);
    if (data.pose != null) pose(data.pose);
    if (data.sample_pose !== undefined) pose(data.sample_pose, "sample_pose");
    if (data.plan_id !== undefined) plan(data);
  } else {
    if (data.evaluation != null) {
      const evaluation = object(data.evaluation);
      text(evaluation.group_id);
      if (!Number.isSafeInteger(evaluation.target_revision) || Number(evaluation.target_revision) < 0) throw new Error("Invalid evaluation target revision");
      joints(evaluation.joints);
      if (evaluation.pose != null) pose(evaluation.pose);
    }
    if (data.execution_phase != null && !["motion", "gripper"].includes(String(data.execution_phase))) throw new Error("Invalid execution phase");
    if (data.following_at_target !== undefined && typeof data.following_at_target !== "boolean") throw new Error("Invalid following arrival flag");
    if (data.following_goal != null) pose(data.following_goal);
    if (data.protection != null) {
      const p = object(data.protection);
      if (!["normal", "derated", "paused", "fault"].includes(String(p.state))) throw new Error("Invalid protection state");
      const scale = finite(p.effective_speed_scale);
      if (scale < 0 || scale > 1) throw new Error("Invalid protection scale");
    }
    if (data.read_only !== undefined && typeof data.read_only !== "boolean")
      throw new Error("Invalid manipulation read-only flag");
    if (data.following_tail !== undefined) decodeFollowingTail(data.following_tail);
    if (typeof data.available !== "boolean")
      throw new Error("Invalid manipulation availability");
    if (
      data.operation != null &&
      !["resetting", "parking"].includes(String(data.operation))
    )
      throw new Error("Invalid arm operation");
    if (data.available) {
      finite(data.ts);
      if (data.root_pose != null) pose(data.root_pose);
      const model = object(data.model);
      if (!isValidatedBulkAsset(model)) {
        validateManipulationModel(model);
      }
      if (!Array.isArray(data.groups))
        throw new Error("Missing manipulation groups");
      for (const raw of data.groups) {
        const group = object(raw);
        text(group.id);
        text(group.base_frame);
        if (group.tip_frame !== null) text(group.tip_frame);
        if (!Array.isArray(group.joint_names))
          throw new Error("Missing group joints");
        group.joint_names.forEach(text);
        if (
          typeof group.following !== "boolean" ||
          typeof group.has_gripper !== "boolean"
        )
          throw new Error("Invalid group capabilities");
      }
      for (const raw of Object.values(object(data.observations))) {
        const observation = object(raw);
        if (observation.joints != null) joints(observation.joints);
        if (observation.gripper_target != null) { finite(observation.gripper_target); if (Number(observation.gripper_target)<0 || Number(observation.gripper_target)>1) throw new Error("Invalid gripper target"); }
        if (observation.joint_velocities != null) for (const value of Object.values(object(observation.joint_velocities))) finite(value);
        if (observation.measured_at != null) finite(observation.measured_at);
        if (observation.pose != null) pose(observation.pose);
        if (observation.gripper != null) finite(observation.gripper);
      }
      if (data.plan != null) plan(object(data.plan));
    }
  }
  return data as unknown as ManipulationOutbound;
}

export function encodeManipulation(
  requestId: string,
  action: ManipulationAction,
  groupId: string,
  payload: Partial<ManipulationPose> & {
    epoch?: string; lease_id?: string; target_revision?: number;
    token?: string;
    plan_id?: string;
    ts?: number;
    sequence?: number;
    value?: number;
    speed_scale?: number;
    final_gripper?: number;
  } = {},
): string {
  text(requestId);
  text(groupId);
  if (payload.epoch !== undefined || payload.lease_id !== undefined) {
    text(payload.epoch); text(payload.lease_id);
    if (!Number.isSafeInteger(payload.sequence) || payload.sequence! < 0) throw new Error("Invalid authority sequence");
  }
  if (payload.target_revision !== undefined && (!Number.isSafeInteger(payload.target_revision) || payload.target_revision < 0)) throw new Error("Invalid target revision");
  if (["evaluate", "plan", "update"].includes(action)) pose(payload);
  if (
    ["plan", "update", "reset_joints", "prepare_shutdown"].includes(action) &&
    payload.speed_scale !== undefined
  ) {
    if (finite(payload.speed_scale) <= 0 || payload.speed_scale > 1)
      throw new Error("Invalid speed scale");
  }
  if (
    payload.final_gripper !== undefined &&
    (finite(payload.final_gripper) < 0 || payload.final_gripper > 1)
  )
    throw new Error("Invalid final gripper value");
  if (action === "execute") text(payload.plan_id);
  if (action === "update" || action === "release") text(payload.token);
  if (action === "update") {
    finite(payload.ts);
    if (!Number.isSafeInteger(payload.sequence) || payload.sequence! < 0)
      throw new Error("Invalid following sequence");
  }
  if (action === "gripper" && (finite(payload.value) < 0 || payload.value! > 1))
    throw new Error("Invalid gripper value");
  return (
    JSON.stringify({
      type: "manipulation_request",
      request_id: requestId,
      action,
      group_id: groupId,
      ...payload,
    }) + "\n"
  );
}
