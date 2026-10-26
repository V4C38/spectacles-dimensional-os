import type { ClientTrackingOrigin } from "../localization/clientTrackingOrigin";
import type { ARModuleSessionState } from "../websocket/arModuleSession";
import {
  deriveSessionLinkPhase,
  NO_ROBOT_CONNECTED_LABEL,
} from "../websocket/sessionLinkStatus";
import type { Pose, RobotDescription } from "../websocket/protocolTypes";

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
  if (!input.setupCompleted) {
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
