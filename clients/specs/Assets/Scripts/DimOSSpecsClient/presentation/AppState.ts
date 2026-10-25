import type { ClientTrackingOrigin } from "../../DimOSARClient/localization/clientTrackingOrigin";
import type { LidarDisplayMode } from "../../DimOSARClient/sensors/lidarSettings";
import type { ARModuleSessionState } from "../../DimOSARClient/websocket/arModuleSession";
import { deriveRobotMarkerApplyInput as sharedMarker, getRobotActivityState as sharedActivity, robotTitleText as sharedTitle } from "../../DimOSARClient/robot/RobotMarkerState";
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
  return sharedMarker(input);
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

export function getRobotActivityState(view: ARModuleSessionState, voice: RobotActivityVoice): RobotActivityState { return sharedActivity(view, voice); }
export function robotTitleText(view: ARModuleSessionState): string { return sharedTitle(view); }
