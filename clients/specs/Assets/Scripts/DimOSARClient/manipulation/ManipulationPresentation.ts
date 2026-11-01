import type { ManipulationInteraction } from "./ManipulationInteraction";
import type { ManipulationPlan, ManipulationState } from "./ManipulationTypes";

export class ManipulationPresentation {
  previewRequested = false;
  private previewId: string | null = null;
  private started = 0;
  private sampledAt: number | null = null;
  hold(now: number): void { if(this.sampledAt!==null) this.started+=now-this.sampledAt; this.sampledAt=now; }
  private pendingStart = false;
  togglePreview(): void { this.previewRequested = !this.previewRequested; this.pendingStart = this.previewRequested; }
  reset(): void { this.previewRequested = false; this.previewId = null; this.pendingStart = false; }
  sample(plan: ManipulationPlan | null, now: number): { playing: boolean; time: number } {
    if (plan?.plan_id !== this.previewId || this.pendingStart) {
      this.previewId = plan?.plan_id ?? null; this.started = now; this.pendingStart = false;
    }
    this.sampledAt = now;
    const time = Math.max(0, now - this.started);
    const playing = this.previewRequested && !!plan && time <= plan.duration;
    if (plan && time > plan.duration) this.previewRequested = false;
    return { playing, time: playing ? time : plan?.duration ?? 0 };
  }
}

export function manipulationControls(state: ManipulationState | null | undefined,
  interaction: Pick<ManipulationInteraction, "snapshot" | "groupId" | "desiredGripper">, selected: boolean) {
  const intent = interaction.snapshot();
  const fresh = intent.fresh;
  const working = intent.planning || intent.executing || intent.resetting;
  const observed = state?.observations?.[interaction.groupId ?? ""];
  const opening = selected ? interaction.desiredGripper ?? observed?.gripper_target ?? observed?.gripper : observed?.gripper_target ?? observed?.gripper;
  return {
    working,
    executeAction: "execute" as const,
    executeLabel: "Execute",
    canExecute: intent.canExecute,
    canPreview: intent.canPreview,
    gripperLabel: opening == null ? "Gripper —" : opening < 0.5 ? "Open" : "Close",
    canGripper: intent.canManipulate && opening != null,
    status: !fresh ? "Feedback unavailable" : state?.stopped ? "Stopped" : intent.activity,
  };
}

export function manipulationMenuRows(_selected: boolean, _stopped: boolean): string[] {
  return ["reset", "speed", "stop", "estop"];
}
export function manipulationButtonEnabled(key: string, intent: import("./ManipulationInteraction").ManipulationSnapshot): boolean {
  switch (key) {
    case "estop": return intent.canStop || intent.canResume;
    case "stop": return intent.canStop;
    case "reset": return intent.canReset;
    case "execute": return intent.canExecute;
    case "plan": return intent.canPreview;
    default: return intent.canManipulate;
  }
}


/** The near-EE button represents the current interaction mode on both hosts. */
export function endEffectorAction(_selected: boolean, intent: import("./ManipulationInteraction").ManipulationSnapshot,
  opening: number | null | undefined, hasGripper: boolean) {
  return { action: "gripper" as const, label: opening == null ? "Gripper —" : opening < 0.5 ? "Open" : "Close",
    available: hasGripper, enabled: intent.canManipulate && opening != null, allowDuringGrab: true };
}

export function manipulationPathOpacity(intent: import("./ManipulationInteraction").ManipulationSnapshot,
  following: boolean, hasPlan: boolean): number {
  return !intent.stopped && (following || intent.finishing || intent.executing) ? 1 : hasPlan ? 0.7 : 0.5;
}

/** A reviewed endpoint cannot replace live IK while a new drag is active. */
export function manipulationPreviewPlan(
  plan: ManipulationPlan | null,
  selected: boolean,
  dragging: boolean,
  rejected: boolean,
): ManipulationPlan | null {
  return selected && !dragging && !rejected ? plan : null;
}
