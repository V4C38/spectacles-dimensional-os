import { ARBridgeCoordinator } from "../ARBridgeCoordinator";
import { bridgeLinkPresentation, AppStateData, LidarDisplayMode, OperatingMode } from "../AppState";
import { RegistrationWizard } from "../Registration/RegistrationWizard";
import { scaleIn, scaleOut } from "../Utilities/AnimationUtilities";
import { getFrameComponent, isFrameInitialized } from "./kit/UIKit";
import { MainMenuView } from "./MainMenuView";
import { WristMenuController } from "./WristMenuController";

const EDITOR_MENU_SCALE = 1.0;
const SPECTACLES_MENU_SCALE = 0.6;

/** Runtime HUD controller toggling main menu visibility and syncing with ARBridgeCoordinator app state. */
@component
export class UIManager extends BaseScriptComponent {
  /** HUD panel only (MainUI). Must not be the parent of RegistrationWizard. */
  @input
  mainUIFrame: SceneObject;

  @input
  arBridgeCoordinator: ARBridgeCoordinator;

  @input
  registrationWizard: RegistrationWizard;

  /** Scene anchor under the SIK left-hand rig; MainUI interpolates toward it in Spectacles mode. */
  @input
  wristMenuRoot: SceneObject;

  private _uiState = -1;
  private _mainMenuView: MainMenuView | null = null;
  private _wristMenuController: WristMenuController | null = null;
  private _isEditorMode = false;
  private _lidarMode: LidarDisplayMode = "obstacles";
  private _operatingMode: OperatingMode = "manual";
  private _debugModeEnabled = false;
  private _unsubscribeAppState: (() => void) | null = null;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this._bindMainUI();
      if (this.arBridgeCoordinator) {
        this._unsubscribeAppState = this.arBridgeCoordinator.subscribeAppState((state) =>
          this._applyAppState(state),
        );
      } else if (this._isEditorMode) {
        this.setUIState(0);
      } else {
        this._wristMenuController?.setGatingActive(false);
        this._uiState = 0;
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

    const appState = this.arBridgeCoordinator?.appState;

    try {
      this._mainMenuView = new MainMenuView(panel, {
        onRestart: () => {
          this.registrationWizard?.startRegistrationWizard();
        },
        onLidarModeCycle: () => this.arBridgeCoordinator?.cycleLidarMode(),
        onModeButtonPressed: (mode) =>
          this.arBridgeCoordinator?.onMainMenuModeButtonPressed(mode),
        onEmergencyStop: () => this.arBridgeCoordinator?.requestEmergencyStop(),
        onDebugModeChanged: (enabled) => this.arBridgeCoordinator?.setDebugMode(enabled),
        getLidarMode: () => this._lidarMode,
        getOperatingMode: () => this._operatingMode,
        getDebugModeValue: () => this._debugModeEnabled,
      });
    } catch (error) {
      print(`UIManager: ${error}`);
      return;
    }

    if (appState) {
      this._operatingMode = appState.operatingMode;
      this._lidarMode = appState.lidarMode;
      this._debugModeEnabled = appState.debugMode;
    }

    if (this.arBridgeCoordinator) {
      const presentation = bridgeLinkPresentation(this.arBridgeCoordinator.bridgeLinkState);
      this._setStatus(presentation.text, presentation.color);
    }
    this._mainMenuView?.setLidarModeDisplay(this._lidarMode);
    this._mainMenuView?.setOperatingMode(this._operatingMode);
    this._mainMenuView?.setDebugModeToggle(this._debugModeEnabled);
    this._configureMenuMotion(panel);
  }

  private _configureMenuMotion(panel: SceneObject): void {
    this._isEditorMode = global.deviceInfoSystem.isEditor();

    const apply = () => {
      const view = this._mainMenuView;
      if (!view) {
        return;
      }

      if (this._isEditorMode) {
        view.applyEditorFrameMotion();
        panel.getTransform().setLocalScale(
          new vec3(EDITOR_MENU_SCALE, EDITOR_MENU_SCALE, EDITOR_MENU_SCALE),
        );
        return;
      }

      view.applySpectaclesFrameMotion();
      this._ensureWristMenuController(panel, SPECTACLES_MENU_SCALE);
    };

    const deferEvent = this.createEvent("UpdateEvent");
    deferEvent.bind(() => {
      if (!isFrameInitialized(getFrameComponent(panel))) {
        return;
      }
      deferEvent.enabled = false;
      apply();
    });
  }

  private _ensureWristMenuController(panel: SceneObject, visibleScale: number): void {
    if (this._isEditorMode || this._wristMenuController) {
      return;
    }

    if (!this.wristMenuRoot) {
      print("UIManager: wristMenuRoot not set — wrist menu disabled");
      panel.enabled = false;
      panel.getTransform().setLocalScale(new vec3(0, 0, 0));
      return;
    }

    try {
      this._wristMenuController = new WristMenuController({
        panel,
        anchorRoot: this.wristMenuRoot,
        handType: "left",
        visibleScale,
        onBeforeShow: () => this._mainMenuView?.applySpectaclesFrameMotion(),
      });
      this._wristMenuController.setGatingActive(this._uiState === 1);
    } catch (error) {
      print(`UIManager: ${error}`);
      return;
    }

    this.createEvent("UpdateEvent").bind(() => {
      this._wristMenuController?.tick(getDeltaTime());
    });
  }

  public setUIState(state: number): void {
    if (this._uiState === state) {
      return;
    }
    this._uiState = state;
    const visibleScale = new vec3(EDITOR_MENU_SCALE, EDITOR_MENU_SCALE, EDITOR_MENU_SCALE);
    if (state === 0) {
      const panel = this._panelRoot();
      if (panel) {
        scaleOut(panel, 0.35);
      }
    } else if (state === 1) {
      const panel = this._panelRoot();
      if (panel) {
        scaleIn(panel, 0.35, visibleScale);
      }
      this._refreshBridgeStatus();
    }
  }

  public get uiState(): number {
    return this._uiState;
  }

  private _refreshBridgeStatus(): void {
    if (!this.arBridgeCoordinator) {
      const presentation = bridgeLinkPresentation("disconnected");
      this._setStatus(presentation.text, presentation.color);
      return;
    }
    const presentation = bridgeLinkPresentation(this.arBridgeCoordinator.bridgeLinkState);
    this._setStatus(presentation.text, presentation.color);
    if (this.arBridgeCoordinator.hasBridgeConnection()) {
      this.arBridgeCoordinator.requestBridgeStatus();
    }
  }

  private _setStatus(text: string, color: vec4): void {
    this._mainMenuView?.setStatus(text, color);
  }

  private _applyAppState(state: AppStateData): void {
    const nextUiState = state.phase === "runtime" ? 1 : 0;
    const uiStateChanged = this._uiState !== nextUiState;
    const operatingModeChanged = this._operatingMode !== state.operatingMode;

    this._lidarMode = state.lidarMode;
    this._operatingMode = state.operatingMode;
    this._debugModeEnabled = state.debugMode;

    this._mainMenuView?.setLidarModeDisplay(this._lidarMode);
    this._mainMenuView?.setLidarModeAvailability(
      state.robotRuntime.capabilities.lidar?.available ?? true,
      this._lidarMode,
    );
    this._mainMenuView?.setOperatingMode(this._operatingMode);
    this._mainMenuView?.setDebugModeToggle(this._debugModeEnabled);
    this._mainMenuView?.setEmergencyStopAvailability(
      state.robotRuntime.capabilities.emergency_stop?.available ?? true,
      state.robotRuntime.capabilities.emergency_stop?.reason ?? null,
    );
    const bridgePresentation = bridgeLinkPresentation(state.bridgeLinkState);
    this._setStatus(bridgePresentation.text, bridgePresentation.color);

    if (this._isEditorMode) {
      this.setUIState(nextUiState);
      if ((uiStateChanged || operatingModeChanged) && nextUiState === 1) {
        this._refreshBridgeStatus();
      }
      return;
    }

    this._wristMenuController?.setGatingActive(nextUiState === 1);
    const previousUiState = this._uiState;
    this._uiState = nextUiState;
    if ((previousUiState !== nextUiState || operatingModeChanged) && nextUiState === 1) {
      this._refreshBridgeStatus();
    }
  }
}
