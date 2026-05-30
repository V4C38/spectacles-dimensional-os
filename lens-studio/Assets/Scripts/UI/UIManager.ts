import { DimosManager } from "../DimosManager";
import { DimosAppState, OperatingMode } from "../AppState";
import { BridgeStatusMessage } from "../Network/Protocol";
import { SetupWizard } from "../Setup/SetupWizard";
import { getBridgeStatusPresentation } from "./Shared/BridgeStatusPresentation";
import { scaleIn, scaleOut } from "./Shared/UIAnimations";
import { COLOR_ERROR, COLOR_WARN } from "./Shared/UIConstants";
import { MainHudView } from "./HUD/MainHudView";

/** 0=hidden, 1=active */
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
  private _mainHudView: MainHudView | null = null;
  private _debugMode = false;
  private _operatingMode: OperatingMode = "manual";
  private _navigationPlacementEnabled = false;
  private _executeMovement = true;
  private _subMenuExpanded = false;
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

  private _setSubMenuExpanded(expanded: boolean): void {
    if (this._subMenuExpanded === expanded) {
      return;
    }
    this._subMenuExpanded = expanded;
    this._mainHudView?.setSubMenuExpanded(expanded);
  }

  private _bindMainUI(): void {
    const panel = this._panelRoot();
    if (!panel) {
      print("UIManager: mainUIFrame not set — assign MainUI in Lens Studio");
      return;
    }

    try {
      this._mainHudView = new MainHudView(panel, {
        onRestart: () => {
          this.setupWizard?.startSetupWizard();
        },
        onDebugChanged: (enabled) => this.dimosManager?.setDebugMode(enabled),
        onOperatingModeSelected: (mode) => this.dimosManager?.setOperatingMode(mode),
        onNavigationPlacementChanged: (enabled) =>
          this.dimosManager?.setNavigationPlacementEnabled(enabled),
        onExecuteChanged: (enabled) => this.dimosManager?.setExecuteMovement(enabled),
        onEmergencyStop: () => this.dimosManager?.requestEmergencyStop(),
        onToggleSubMenu: () => this._setSubMenuExpanded(!this._subMenuExpanded),
        getDebugValue: () => this._debugMode,
        getNavigationPlacementValue: () => this._navigationPlacementEnabled,
        getOperatingMode: () => this._operatingMode,
        getExecuteValue: () => this._executeMovement,
        getSubMenuExpanded: () => this._subMenuExpanded,
      });
    } catch (error) {
      print(`UIManager: ${error}`);
      return;
    }

    if (this.dimosManager) {
      this.dimosManager.onBridgeStatusChanged.push((msg) =>
        this._applyBridgeStatus(msg),
      );
      this.dimosManager.onBridgeConnectionChanged.push((connected) =>
        this._applyConnectionState(connected),
      );
      if (this.dimosManager.lastBridgeStatus) {
        this._applyBridgeStatus(this.dimosManager.lastBridgeStatus);
      }
    }
    this._mainHudView?.setDebugToggle(this._debugMode);
    this._mainHudView?.setOperatingMode(this._operatingMode);
    this._mainHudView?.setNavigationPlacementToggle(this._navigationPlacementEnabled);
    this._mainHudView?.setExecuteToggle(this._executeMovement);
    this._mainHudView?.setSubMenuExpanded(this._subMenuExpanded);
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

  private _applyBridgeStatus(msg: BridgeStatusMessage): void {
    const presentation = getBridgeStatusPresentation(msg);
    this._setStatus(presentation.text, presentation.color);
  }

  private _refreshBridgeStatus(): void {
    if (!this.dimosManager) {
      this._setStatus("Bridge unavailable", COLOR_ERROR);
      return;
    }
    if (this.dimosManager.lastBridgeStatus) {
      this._applyBridgeStatus(this.dimosManager.lastBridgeStatus);
    } else if (this.dimosManager.hasBridgeConnection()) {
      this._setStatus("Waiting for robot status", COLOR_WARN);
    } else if (this._operatingMode === "manual") {
      this._setStatus("Bridge disconnected - local placement only", COLOR_WARN);
    } else {
      this._setStatus("Bridge disconnected", COLOR_ERROR);
    }
    if (this.dimosManager.hasBridgeConnection()) {
      this.dimosManager.requestBridgeStatus();
    }
  }

  private _applyConnectionState(connected: boolean): void {
    if (!connected) {
      this._refreshBridgeStatus();
      return;
    }
    this._setStatus("Waiting for robot status", COLOR_WARN);
    this.dimosManager?.requestBridgeStatus();
  }

  private _setStatus(text: string, color: vec4): void {
    this._mainHudView?.setStatus(text, color);
  }

  private _applyAppState(state: DimosAppState): void {
    const nextUiState = state.phase === "runtime" ? 1 : 0;
    const uiStateChanged = this._uiState !== nextUiState;
    const operatingModeChanged = this._operatingMode !== state.operatingMode;
    this._debugMode = state.debugMode;
    this._operatingMode = state.operatingMode;
    this._navigationPlacementEnabled = state.navigationPlacementEnabled;
    this._executeMovement = state.executeMovement;
    this._mainHudView?.setDebugToggle(this._debugMode);
    this._mainHudView?.setOperatingMode(this._operatingMode);
    this._mainHudView?.setNavigationPlacementToggle(this._navigationPlacementEnabled);
    this._mainHudView?.setExecuteToggle(this._executeMovement);
    this._mainHudView?.setSubMenuExpanded(this._subMenuExpanded);
    this.setUIState(nextUiState);
    if ((uiStateChanged || operatingModeChanged) && nextUiState === 1) {
      this._refreshBridgeStatus();
    }
  }
}
