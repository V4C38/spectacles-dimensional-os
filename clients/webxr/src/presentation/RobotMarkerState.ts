import type { ClientTrackingOrigin } from "@dimos-ar-client/localization/clientTrackingOrigin";
import type { ARModuleSessionState } from "@dimos-ar-client/websocket/arModuleSession";
import {
  deriveSessionLinkPhase,
  NO_ROBOT_CONNECTED_LABEL,
} from "@dimos-ar-client/websocket/sessionLinkStatus";
import type { Pose, RobotDescription } from "@dimos-ar-client/websocket/protocolTypes";

export type RobotActivityState = "Idle" | "Following Path" | "Thinking" | "Responding" | "Listening";

export type RobotMarkerApplyInput =
  | { mode: "hidden" }
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
  return {
    mode: "unlocalizedFallbackPosition",
    robot: robot ?? null,
    view: input.view,
  };
}

export function getRobotActivityState(view: ARModuleSessionState): RobotActivityState {
  if (view.nav !== null && view.nav.state === "following_path") {
    return "Following Path";
  }
  if (view.state?.agent.idle === false) {
    return "Thinking";
  }
  return "Idle";
}

export function robotTitleText(view: ARModuleSessionState): string {
  const linkPhase = deriveSessionLinkPhase(view);
  if (linkPhase === "disconnected" || linkPhase === "connecting") {
    return NO_ROBOT_CONNECTED_LABEL;
  }
  return view.hello?.robot.display_name ?? NO_ROBOT_CONNECTED_LABEL;
}
