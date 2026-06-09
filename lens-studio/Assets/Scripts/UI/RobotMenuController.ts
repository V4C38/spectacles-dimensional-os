import { BridgeLinkState, OperatingMode } from "../AppState";
import { getBridgeStatusPresentation } from "./Shared/BridgeStatusPresentation";
import { RobotMenuView } from "./RobotMenuView";

// ================================================================
/** Binds bridge status and operating mode to the world-anchored robot menu. */
// ================================================================

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

  public setNavigationPlacementAvailability(available: boolean): void {
    this._view.setNavigationPlacementAvailability(available);
  }

  public setEmergencyStopAvailability(
    available: boolean,
    reason: string | null,
  ): void {
    this._view.setEmergencyStopAvailability(available, reason);
  }

  public setRobotLabel(label: string): void {
    this._view.setRobotLabel(label);
  }

  public setOperatingMode(mode: OperatingMode): void {
    this._view.setOperatingMode(mode);
    if (mode === "manual") {
      this.hide();
    }
  }

  public applyBridgeLinkState(state: BridgeLinkState): void {
    const presentation = getBridgeStatusPresentation(state);
    this._view.setStatus(presentation.text, presentation.color);
  }
}
