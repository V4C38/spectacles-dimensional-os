import type { ClientTrackingOrigin } from "../../DimOSARClient/localization/clientTrackingOrigin";
import type { LidarDisplayMode } from "../../DimOSARClient/sensors/lidarSettings";
import type { ARModuleSessionState } from "../../DimOSARClient/websocket/arModuleSession";
import {
  deriveSessionLinkPhase,
  NO_ROBOT_CONNECTED_LABEL,
} from "../../DimOSARClient/websocket/sessionLinkStatus";
import type { Pose, RobotDescription } from "../../DimOSARClient/websocket/protocolTypes";

export type OperatingMode = "manual" | "agent";

export type RobotActivityState =
  | "Idle"
  | "Following Path"
  | "Thinking"
  | "Responding"
  | "Listening";

export interface RobotActivityVoice {
  asrRunning: boolean;
  ttsPlaying: boolean;
}

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

export class AppState {
  debugModeEnabled = false;
  operatingMode: OperatingMode = "manual";
  lidarMode: LidarDisplayMode = "obstacles";

  setDebugMode(enabled: boolean): void {
    this.debugModeEnabled = enabled;
  }

  setOperatingMode(mode: OperatingMode): void {
    this.operatingMode = mode;
  }

  setLidarMode(mode: LidarDisplayMode): void {
    this.lidarMode = mode;
  }
}

export function deriveRobotMarkerApplyInput(input: {
  setupCompleted: boolean;
  view: ARModuleSessionState;
  origin: ClientTrackingOrigin | null;
}): RobotMarkerApplyInput {
  if (!input.setupCompleted) {
    return { mode: "hidden" };
  }
  const robot = input.view.hello?.robot;
  if (
    input.origin &&
    input.view.hasTrackingOrigin &&
    input.view.pose &&
    robot
  ) {
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

export function agentModeAccessible(
  agentAvailable: boolean,
  debugModeEnabled: boolean,
): boolean {
  return agentAvailable || debugModeEnabled;
}

export function agentSpeechShouldRun(
  operatingMode: OperatingMode,
  debugModeEnabled: boolean,
  sessionReady: boolean,
  agentAvailable: boolean,
): boolean {
  return (
    operatingMode === "agent" &&
    (debugModeEnabled || (sessionReady && agentAvailable))
  );
}

export function getRobotActivityState(
  view: ARModuleSessionState,
  voice: RobotActivityVoice,
): RobotActivityState {
  if (view.nav !== null && view.nav.state === "following_path") {
    return "Following Path";
  }
  if (view.state?.agent.idle === false) {
    return "Thinking";
  }
  if (voice.ttsPlaying) {
    return "Responding";
  }
  if (voice.asrRunning) {
    return "Listening";
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
