import type { ClientTrackingOrigin } from "../../DimOSARClient/localization/clientTrackingOrigin";
import type { ARModuleSessionState } from "../../DimOSARClient/websocket/arModuleSession";
import { deriveRobotMarkerApplyInput as sharedMarker, getRobotActivityState as sharedActivity, robotTitleText as sharedTitle } from "../../DimOSARClient/robot/RobotMarkerState";

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

export type { RobotMarkerApplyInput } from "../../DimOSARClient/robot/RobotMarkerState";
import type { RobotMarkerApplyInput } from "../../DimOSARClient/robot/RobotMarkerState";

export class AppState {
  debugModeEnabled = false;
  operatingMode: OperatingMode = "manual";

  setDebugMode(enabled: boolean): void {
    this.debugModeEnabled = enabled;
  }

  setOperatingMode(mode: OperatingMode): void {
    this.operatingMode = mode;
  }

}

export function deriveRobotMarkerApplyInput(input: {
  setupCompleted: boolean;
  view: ARModuleSessionState;
  origin: ClientTrackingOrigin | null;
}): RobotMarkerApplyInput {
  return sharedMarker(input);
}

export function agentModeAccessible(
  agentAvailable: boolean,
  _debugModeEnabled: boolean,
): boolean {
  return agentAvailable;
}

export function agentSpeechShouldRun(
  operatingMode: OperatingMode,
  _debugModeEnabled: boolean,
  sessionReady: boolean,
  agentAvailable: boolean,
): boolean {
  return (
    operatingMode === "agent" &&
    sessionReady && agentAvailable
  );
}

export function getRobotActivityState(view: ARModuleSessionState, voice: RobotActivityVoice): RobotActivityState { return sharedActivity(view, voice); }
export function robotTitleText(view: ARModuleSessionState): string { return sharedTitle(view); }
