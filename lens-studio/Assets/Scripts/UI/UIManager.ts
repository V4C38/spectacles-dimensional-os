import { DimosManager } from "../Core/DimosManager";
import { DimosAppState, LidarDisplayMode, OperatingMode } from "../Core/AppState";
import { NavigationGoalMode } from "../Navigation/NavigationModel";
import { SetupWizard } from "../Setup/SetupWizard";
import { getBridgeStatusPresentation } from "./BridgeStatusPresentation";
import { scaleIn, scaleOut } from "./kit/UIAnimations";
import { MainMenuView } from "./MainMenuView";

/** Runtime HUD controller toggling main menu visibility and syncing with DimosManager app state. */
@component
export class UIManager extends BaseScriptComponent {
  /** HUD panel only (MainUI). Must not be the parent of SetupWizard. */
  @input
  mainUIFrame: SceneObject;

  @input
  dimosManager: DimosManager;

  @input
  setupWizard: SetupWizard;

  private _uiState = -1;
  private _mainMenuView: MainMenuView | null = null;
  private _lidarMode: LidarDisplayMode = "obstacles";
  private _operatingMode: OperatingMode = "manual";
  private _navigationGoalMode: NavigationGoalMode = "single";
  private _expandedSettingsMode: OperatingMode | null = null;
  private _debugModeEnabled = false;
  private _unsubscribeAppState: (() => void) | null = null;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this._bindMainUI();
      if (this.dimosManager) {
        this._unsubscribeAppState = this.dimosManager.subscribeAppState((state) =>
          this._applyAppState(state),
        );
      } else {
        this.setUIState(0);
      }
    });
    this.createEvent("OnDestroyEvent").bind(() => {
      this._unsubscribeAppState?.();
      this._unsubscribeAppState = null;
    });
  }

  private _panelRoot(): SceneObject | null {
    if (this.mainUIFrame) {
      return this.mainUIFrame;
    }
    const root = this.getSceneObject();
    for (let i = 0; i < root.getChildrenCount(); i++) {
      const child = root.getChild(i);
      if (child.name === "MainUI") {
        return child;
      }
    }
    return null;
  }

  private _bindMainUI(): void {
    const panel = this._panelRoot();
    if (!panel) {
      print("UIManager: mainUIFrame not set — assign MainUI in Lens Studio");
      return;
    }

    const appState = this.dimosManager?.appState;

    try {
      this._mainMenuView = new MainMenuView(panel, {
        onRestart: () => {
          this.setupWizard?.startSetupWizard();
        },
        onLidarModeCycle: () => this.dimosManager?.cycleLidarMode(),
        onModeButtonPressed: (mode) =>
          this.dimosManager?.onMainMenuModeButtonPressed(mode),
        onModeSettingsChanged: (enabled) =>
          this.dimosManager?.setMainMenuSettingsExpanded(enabled),
        onNavigationGoalModeCycle: () => this.dimosManager?.cycleNavigationGoalMode(),
        onEmergencyStop: () => this.dimosManager?.requestEmergencyStop(),
        onDebugModeChanged: (enabled) => this.dimosManager?.setDebugMode(enabled),
        getLidarMode: () => this._lidarMode,
        getNavigationGoalMode: () => this._navigationGoalMode,
        getOperatingMode: () => this._operatingMode,
        getExpandedSettingsMode: () => this._expandedSettingsMode,
        getModeSettingsExpanded: () => this._expandedSettingsMode !== null,
        getDebugModeValue: () => this._debugModeEnabled,
      });
    } catch (error) {
      print(`UIManager: ${error}`);
      return;
    }

    if (appState) {
      this._expandedSettingsMode = appState.mainMenuExpandedSettingsMode;
      this._operatingMode = appState.operatingMode;
      this._lidarMode = appState.lidarMode;
      this._navigationGoalMode = appState.navigationGoalMode;
      this._debugModeEnabled = appState.debugMode;
    }

    if (this.dimosManager) {
      this._setStatus(
        getBridgeStatusPresentation(this.dimosManager.bridgeLinkState).text,
        getBridgeStatusPresentation(this.dimosManager.bridgeLinkState).color,
      );
    }
    this._mainMenuView?.setLidarModeDisplay(this._lidarMode);
    this._mainMenuView?.setExpandedSettingsMode(this._expandedSettingsMode);
    this._mainMenuView?.setOperatingMode(this._operatingMode);
    this._mainMenuView?.setNavigationGoalModeDisplay(this._navigationGoalMode);
    this._mainMenuView?.setDebugModeToggle(this._debugModeEnabled);
  }

  public setUIState(state: number): void {
    if (this._uiState === state) {
      return;
    }
    this._uiState = state;
    if (state === 0) {
      const panel = this._panelRoot();
      if (panel) {
        scaleOut(panel, 0.35);
      }
    } else if (state === 1) {
      const panel = this._panelRoot();
      if (panel) {
        scaleIn(panel, 0.35);
      }
      this._refreshBridgeStatus();
    }
  }

  public get uiState(): number {
    return this._uiState;
  }

  private _refreshBridgeStatus(): void {
    if (!this.dimosManager) {
      const presentation = getBridgeStatusPresentation("disconnected");
      this._setStatus(presentation.text, presentation.color);
      return;
    }
    const presentation = getBridgeStatusPresentation(this.dimosManager.bridgeLinkState);
    this._setStatus(presentation.text, presentation.color);
    if (this.dimosManager.hasBridgeConnection()) {
      this.dimosManager.requestBridgeStatus();
    }
  }

  private _setStatus(text: string, color: vec4): void {
    this._mainMenuView?.setStatus(text, color);
  }

  private _applyAppState(state: DimosAppState): void {
    const nextUiState = state.phase === "runtime" ? 1 : 0;
    const uiStateChanged = this._uiState !== nextUiState;
    const operatingModeChanged = this._operatingMode !== state.operatingMode;

    this._lidarMode = state.lidarMode;
    this._operatingMode = state.operatingMode;
    this._navigationGoalMode = state.navigationGoalMode;
    this._expandedSettingsMode = state.mainMenuExpandedSettingsMode;
    this._debugModeEnabled = state.debugMode;

    this._mainMenuView?.setLidarModeDisplay(this._lidarMode);
    this._mainMenuView?.setLidarModeAvailability(
      state.robotRuntime.capabilities.lidar?.available ?? true,
      this._lidarMode,
    );
    this._mainMenuView?.setExpandedSettingsMode(this._expandedSettingsMode);
    this._mainMenuView?.setOperatingMode(this._operatingMode);
    this._mainMenuView?.setNavigationGoalModeDisplay(this._navigationGoalMode);
    this._mainMenuView?.setNavigationGoalModeAvailability(
      state.robotRuntime.capabilities.nav?.available ?? true,
    );
    this._mainMenuView?.setDebugModeToggle(this._debugModeEnabled);
    this._mainMenuView?.setEmergencyStopAvailability(
      state.robotRuntime.capabilities.emergency_stop?.available ?? true,
      state.robotRuntime.capabilities.emergency_stop?.reason ?? null,
    );
    const bridgePresentation = getBridgeStatusPresentation(state.bridgeLinkState);
    this._setStatus(bridgePresentation.text, bridgePresentation.color);
    this.setUIState(nextUiState);
    if ((uiStateChanged || operatingModeChanged) && nextUiState === 1) {
      this._refreshBridgeStatus();
    }
  }
}
