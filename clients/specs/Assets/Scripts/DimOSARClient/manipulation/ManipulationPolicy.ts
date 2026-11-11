import type { ManipulationPose } from "./ManipulationTypes";

export const MANIPULATION_PLAN_INTERVAL_S = 0.05;
export function poseChanged(
  a: ManipulationPose,
  b: ManipulationPose,
  distance = 0.01,
  angle = Math.PI / 60,
): boolean {
  const separation = Math.hypot(...a.position.map((v, i) => v - b.position[i]));
  const turn =
    2 *
    Math.acos(
      Math.min(
        1,
        Math.abs(
          a.orientation.reduce((sum, v, i) => sum + v * b.orientation[i], 0),
        ),
      ),
    );
  return separation >= distance || turn >= angle;
}

/** Hysteresis is based on raw observed poses, never on presentation smoothing. */
export function targetIsOffset(
  target: ManipulationPose | null,
  measured: ManipulationPose | null | undefined,
  wasOffset = false,
): boolean {
  return (
    !!target &&
    !!measured &&
    poseChanged(
      target,
      measured,
      wasOffset ? 0.005 : 0.01,
      wasOffset ? Math.PI / 120 : Math.PI / 60,
    )
  );
}

export interface ManipulationRejection {
  revision: number;
  pose: ManipulationPose;
  message: string;
  failedJoints?: string[];
}

export interface ManipulationSnapshot {
  readonly blocked?: boolean;
  readonly targetOffset: boolean;
  readonly hasDraft: boolean;
  readonly sharedDraft?: boolean;
  readonly dragging: boolean;
  readonly finishing?: boolean;
  readonly planning: boolean;
  readonly executing: boolean;
  readonly resetting: boolean;
  readonly stopped: boolean;
  readonly fresh: boolean;
  readonly retainingFeedback?: boolean;
  readonly activity: string;
  readonly canPreview: boolean;
  readonly canExecute: boolean;
  readonly canReset: boolean;
  readonly canManipulate: boolean;
  readonly canStop: boolean;
  readonly canResume: boolean;
}

export interface ManipulationFacts {
  available: boolean;
  fresh: boolean;
  selected: boolean;
  targetOffset: boolean;
  gripperDraft: boolean;
  dragging: boolean;
  planning: boolean;
  executing: boolean;
  resetting: boolean;
  stopped: boolean;
  stopConfirmed: boolean;
  pendingControl: boolean;
  following: boolean;
  followingSettled?: boolean;
  rejection: boolean;
  status: string;
  runtimeMessage?: string | null;
  readOnly?: boolean;
  finishing?: boolean;
}

export function deriveManipulationSnapshot(
  facts: ManipulationFacts,
): ManipulationSnapshot {
  const canManipulate =
    facts.available &&
    !facts.readOnly &&
    facts.fresh &&
    !facts.stopped &&
    !facts.executing &&
    !facts.resetting &&
    !facts.pendingControl;
  const ready = canManipulate && !facts.planning && !facts.dragging;
  const hasDraft = facts.targetOffset || facts.gripperDraft;
  let activity = "Idle";
  if (facts.readOnly) activity = "Recording";
  else if (!facts.fresh) activity = "No feedback";
  else if (facts.stopped) activity = "Stopped";
  else if (facts.resetting) activity = "Resetting";
  else if (facts.executing) activity = "Moving";
  else if (facts.rejection) activity = shortManipulationStatus(facts.status);
  else if (facts.followingSettled) activity = "Idle";
  else if (facts.runtimeMessage)
    activity = shortManipulationStatus(facts.runtimeMessage);
  else if (facts.following && facts.targetOffset) activity = "Moving";
  else if (facts.selected && hasDraft) activity = "Planning";
  return Object.freeze({
    targetOffset: facts.targetOffset,
    hasDraft,
    dragging: facts.dragging,
    finishing: facts.finishing === true,
    planning: facts.planning,
    executing: facts.executing,
    resetting: facts.resetting,
    stopped: facts.stopped,
    fresh: facts.fresh,
    activity,
    canPreview: facts.selected && facts.targetOffset && ready,
    canExecute: facts.selected && hasDraft && ready,
    canReset: ready,
    canManipulate,
    canStop: !facts.readOnly && !facts.stopped,
    canResume: !facts.readOnly && facts.stopped && facts.fresh && facts.stopConfirmed,
  });
}

/** Short world labels; detailed runtime messages remain available in diagnostics. */
export function shortManipulationStatus(message: string): string {
  const s = message.toLowerCase();
  if (/target not reached/.test(s)) return "Target not reached";
  if (/joint.?limit/.test(s)) return "Joint limit";
  if (/ik|unreachable|infeasible|no.solution|converge/.test(s))
    return "IK failed";
  if (/uncertain|fault/.test(s)) return "Check arm";
  if (/stale|feedback/.test(s)) return "No feedback";
  if (/timeout|timed out/.test(s)) return "Timed out";
  if (/planning|planned|feasible/.test(s)) return "Planning";
  if (/execut|following/.test(s)) return "Moving";
  if (/reset|zero/.test(s)) return "Resetting";
  if (/stop|abort|cancel/.test(s)) return "Stopped";
  if (/gripper.*(skipped|fail|confirm)|fail.*gripper/.test(s)) return "Gripper failed";
  if (/fail|reject/.test(s)) return "Plan failed";
  return "Idle";
}
