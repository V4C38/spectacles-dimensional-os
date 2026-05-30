import { BridgeStatusMessage } from "../Network/Protocol";
import { OperatingMode } from "../AppState";
import {
  getBridgeStatusPresentation,
  getRobotModelLabel,
} from "./Shared/BridgeStatusPresentation";
import { COLOR_ERROR, COLOR_WARN } from "./Shared/UIConstants";
import { RobotMenuView } from "./RobotMenuView";

export class RobotMenuController {
  constructor(private readonly _view: RobotMenuView) {
    this._view.setStopEmphasis(true);
    this._view.setMenuVisible(false);
  }

  public bindCallbacks(
    onToggle: () => void,
    onStop: () => void,
    onNavigationPlacementChanged: (enabled: boolean) => void,
    getNavigationPlacementValue: () => boolean,
  ): void {
    this._view.onToggleRequested = onToggle;
    this._view.onStopRequested = onStop;
    this._view.onNavigationPlacementRequested = onNavigationPlacementChanged;
    this._view.setNavigationPlacementToggle(getNavigationPlacementValue());
  }

  public toggleVisible(): void {
    this.setVisible(!this._view.isMenuVisible());
  }

  public setVisible(visible: boolean): void {
    this._view.setMenuVisible(visible);
  }

  public hide(): void {
    this.setVisible(false);
  }

  public setNavigationPlacementToggle(enabled: boolean): void {
    this._view.setNavigationPlacementToggle(enabled);
  }

  public setOperatingMode(mode: OperatingMode): void {
    this._view.setOperatingMode(mode);
  }

  public applyBridgeStatus(
    msg: BridgeStatusMessage,
  ): void {
    const presentation = getBridgeStatusPresentation(msg);
    this._view.setRobotLabel(getRobotModelLabel(msg));
    this._view.setStatus(presentation.text, presentation.color);
  }

  public applyConnectionState(connected: boolean): void {
    this._view.setRobotLabel("Unknown Hardware");
    if (!connected) {
      this._view.setStatus("Bridge disconnected", COLOR_ERROR);
      return;
    }
    this._view.setStatus("Waiting for robot status", COLOR_WARN);
  }
}
