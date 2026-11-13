import type { ClientTrackingOrigin } from "../localization/ClientTracking";
import type { ARModuleSessionState } from "../websocket/ARModuleSession";
import { deriveSessionLinkPhase, NO_ROBOT_CONNECTED_LABEL } from "../presentation/ControlPanelPresentation";
import type { Pose, RobotDescription } from "../ClientContracts";

/** The single robot selection owner. Views receive facts; hover never changes selection. */
export class RobotSelection {
  private selected = false;
  private eligible = false;
  private readonly listeners = new Set<(selected: boolean) => void>();

  isSelected(): boolean { return this.selected; }
  snapshot(): Readonly<{ selected: boolean; eligible: boolean }> { return { selected: this.selected, eligible: this.eligible }; }
  setEligible(eligible: boolean): void { this.eligible = eligible; if (!eligible) this.clear(); }
  setSelected(selected: boolean): void {
    const next = selected && this.eligible;
    if (next === this.selected) return;
    this.selected = next;
    for (const listener of this.listeners) listener(next);
  }
  toggle(): void { this.setSelected(!this.selected); }
  clear(): void { this.setSelected(false); }
  subscribe(listener: (selected: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}

export type RobotActivityState = "Idle" | "Following Path" | "Thinking" | "Responding" | "Listening";

export type RobotMarkerApplyInput =
  | { mode: "hidden" }
  | { mode: "localizedPending" }
  | {
      mode: "unlocalizedFallbackPosition";
      robot: RobotDescription | null;
      view: ARModuleSessionState;
    }
  | {
      mode: "localizedOdom";
      robot: RobotDescription;
      pose: Pose;
      origin: ClientTrackingOrigin;
      view: ARModuleSessionState;
    };

export function deriveRobotMarkerApplyInput(input: {
  setupCompleted: boolean;
  view: ARModuleSessionState;
  origin: ClientTrackingOrigin | null;
}): RobotMarkerApplyInput {
  if (!input.setupCompleted || input.view.capabilities?.navigation.available !== true) {
    return { mode: "hidden" };
  }
  const robot = input.view.hello?.robot;
  if (input.origin && input.view.hasTrackingOrigin && input.view.pose && robot) {
    return {
      mode: "localizedOdom",
      robot,
      pose: input.view.pose,
      origin: input.origin,
      view: input.view,
    };
  }
  if (input.origin || input.view.hasRetainedTrackingOrigin || input.view.alignmentRequired) return { mode: "localizedPending" };
  return {
    mode: "unlocalizedFallbackPosition",
    robot: robot ?? null,
    view: input.view,
  };
}

export function getRobotActivityState(view: ARModuleSessionState, voice?: { ttsPlaying: boolean; asrRunning: boolean }): RobotActivityState {
  if (view.nav !== null && view.nav.state === "following_path") {
    return "Following Path";
  }
  if (view.state?.agent.idle === false) {
    return "Thinking";
  }
  if (voice?.ttsPlaying) return "Responding";
  if (voice?.asrRunning) return "Listening";
  return "Idle";
}

export function robotTitleText(view: ARModuleSessionState): string {
  const linkPhase = deriveSessionLinkPhase(view);
  if (linkPhase === "disconnected" || linkPhase === "connecting") {
    return NO_ROBOT_CONNECTED_LABEL;
  }
  return view.hello?.robot.display_name ?? NO_ROBOT_CONNECTED_LABEL;
}
