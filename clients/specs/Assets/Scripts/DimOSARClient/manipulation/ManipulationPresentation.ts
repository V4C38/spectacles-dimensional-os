import type { ManipulationInteraction } from "./ManipulationInteraction";
import type { ManipulationPlan, ManipulationState } from "./ManipulationTypes";

export class ManipulationPresentation {
  previewRequested = false;
  private previewId: string | null = null;
  private started = 0;
  private pendingStart = false;
  togglePreview(): void { this.previewRequested = !this.previewRequested; this.pendingStart = this.previewRequested; }
  reset(): void { this.previewRequested = false; this.previewId = null; this.pendingStart = false; }
  sample(plan: ManipulationPlan | null, now: number): { playing: boolean; time: number } {
    if (plan?.plan_id !== this.previewId || this.pendingStart) {
      this.previewId = plan?.plan_id ?? null; this.started = now; this.pendingStart = false;
    }
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
  const opening = selected ? interaction.desiredGripper ?? observed?.gripper : observed?.gripper;
  return {
    working,
    executeAction: working ? "cancel" as const : "execute" as const,
    executeLabel: working ? "Cancel" : "Execute",
    canExecute: working ? intent.canStop : intent.canExecute,
    canPreview: intent.canPreview,
    gripperLabel: opening == null ? "Gripper —" : opening < 0.5 ? "Open" : "Close",
    canGripper: intent.canManipulate && opening != null,
    status: !fresh ? "Feedback unavailable" : state?.stopped ? "Stopped" : state?.following ? "Following" : intent.activity,
  };
}
