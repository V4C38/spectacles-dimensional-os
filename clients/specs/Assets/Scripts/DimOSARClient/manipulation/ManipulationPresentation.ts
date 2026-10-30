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
  interaction: Pick<ManipulationInteraction, "feedbackFresh" | "busy" | "target" | "groupId" | "desiredGripper" | "status">, selected: boolean) {
  const fresh = interaction.feedbackFresh;
  const working = interaction.busy || ["accepted", "executing"].includes(state?.execution ?? "");
  const observed = state?.observations?.[interaction.groupId ?? ""];
  const opening = selected ? interaction.desiredGripper ?? observed?.gripper : observed?.gripper;
  return {
    working,
    executeAction: working ? "cancel" as const : "execute" as const,
    executeLabel: working ? "Cancel" : "Execute",
    canExecute: working || fresh && interaction.target !== null,
    canPreview: fresh && interaction.target !== null && !working && !state?.stopped,
    gripperLabel: opening == null ? "Gripper —" : opening < 0.5 ? "Open" : "Close",
    canGripper: fresh && opening != null && !state?.stopped,
    status: !fresh ? "Feedback unavailable" : state?.stopped ? "Stopped" : state?.following ? "Following" : interaction.status || state?.execution || "Idle",
  };
}
