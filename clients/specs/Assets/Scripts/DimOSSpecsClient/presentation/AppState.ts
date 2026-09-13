import type { LidarDisplayMode } from "../../DimOSARClient/sensors/lidarSettings";
import type { ARModuleSessionState } from "../../DimOSARClient/websocket/arModuleSession";
import {
  deriveSessionLinkPhase,
  NO_ROBOT_CONNECTED_LABEL,
} from "../../DimOSARClient/websocket/sessionLinkStatus";
import type { OperatingMode } from "./MainMenuView";

export type RobotActivityState = "Idle" | "Following Path";

export class AppState {
  debugModeEnabled = false;
  operatingMode: OperatingMode = "manual";
  wizardFinished = false;
  wizardLocalized = false;
  lidarMode: LidarDisplayMode = "obstacles";

  setDebugMode(enabled: boolean): void {
    this.debugModeEnabled = enabled;
  }

  setOperatingMode(mode: OperatingMode): void {
    this.operatingMode = mode;
  }

  finishWizard(localized: boolean): void {
    this.wizardFinished = true;
    this.wizardLocalized = localized;
  }

  resetWizard(): void {
    this.wizardFinished = false;
    this.wizardLocalized = false;
  }

  setLidarMode(mode: LidarDisplayMode): void {
    this.lidarMode = mode;
  }
}

export function getRobotActivityState(view: ARModuleSessionState): RobotActivityState {
  const nav = view.nav;
  if (nav !== null && nav.state === "following_path") {
    return "Following Path";
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
