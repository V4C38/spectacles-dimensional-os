import { ManipulationInteraction } from "./ManipulationInteraction";
import { ManipulationPresentation } from "./ManipulationPresentation";
import type { ARModuleSession } from "../websocket/arModuleSession";

export type ManipulationControlAction = "reset" | "estop" | "plan" | "execute" | "cancel" | "stop" | "resume" | "group" | "gripper";

/** Shared user commands; session observations remain the execution authority. */
export class ManipulationController {
  readonly interaction: ManipulationInteraction;
  readonly presentation = new ManipulationPresentation();
  private selected = false;
  private suspended = false;
  private target: object | null = null;
  private speed = 0.2;
  private group: string | null = null;
  constructor(private readonly session: Pick<ARModuleSession, "view" | "sendText" | "subscribeOutbound" | "requestEstop">,
    now: () => number, private readonly stop: () => void = () => session.requestEstop()) {
    this.interaction = new ManipulationInteraction(session, now);
  }
  setSelected(selected: boolean): void {
    if (selected !== this.selected) this.presentation.reset();
    this.selected = selected; this.interaction.setSelected(selected);
  }
  action(action: ManipulationControlAction): void {
    const interaction = this.interaction;
    switch (action) {
      case "estop": this.presentation.reset(); interaction.discard(); this.stop(); break;
      case "reset": this.presentation.reset(); interaction.resetJoints(); break;
      case "plan": if (!interaction.snapshot().canPreview) break; this.presentation.togglePreview(); if (this.presentation.previewRequested && !interaction.plan) interaction.requestPlan(); break;
      case "execute": this.presentation.reset(); interaction.execute(); break;
      case "stop":
      case "cancel": this.presentation.reset(); interaction.cancel(); break;
      case "resume": interaction.resume(); break;
      case "group": {
        const groups = this.session.view().manipulation?.groups ?? [];
        const index = groups.findIndex(group => group.id === interaction.groupId);
        if (groups.length) { this.presentation.reset(); interaction.selectGroup(groups[(index + 1) % groups.length].id); }
        break;
      }
      case "gripper": {
        const opening = this.selected && interaction.desiredGripper != null ? interaction.desiredGripper
          : this.session.view().manipulation?.observations?.[interaction.groupId ?? ""]?.gripper;
        if (opening != null) { this.presentation.reset(); interaction.setGripper(opening < 0.5 ? 1 : 0); }
        break;
      }
    }
  }
  tick(enabled = true): void {
    if (!enabled) { this.suspend(); this.interaction.tick(); return; }
    this.suspended = false;
    const interaction = this.interaction;
    if (this.target !== interaction.target || this.speed !== interaction.speedScale || this.group !== interaction.groupId)
      this.presentation.reset();
    this.target = interaction.target; this.speed = interaction.speedScale; this.group = interaction.groupId;
    interaction.tick();
  }
  suspend(): void {
    if (this.suspended) return;
    this.suspended = true;
    this.presentation.reset();
    if (this.interaction.dragging || this.interaction.busy || this.interaction.target || this.interaction.plan)
      this.interaction.invalidateTarget();
    else this.interaction.end();
  }
  dispose(): void { this.suspend(); this.interaction.dispose(); }
}
