import { ARBridgeCoordinator } from "../ARBridgeCoordinator";
import { bridgeLinkPresentation } from "../Bridge/BridgePresentation";
import { AppStateData, LidarDisplayMode, OperatingMode } from "../AppState";
import { RegistrationWizard } from "../Registration/RegistrationWizard";
import { scaleIn, scaleOut } from "../Utilities/AnimationUtilities";
import { findChildRecursive, getFrameComponent, isFrameInitialized } from "./UIKit";
import { MainMenuView } from "./MainMenuView";
import { WristMenuController } from "./WristMenuController";

const EDITOR_MENU_SCALE = 1.0;
const SPECTACLES_MENU_SCALE = 0.6;
const EDITOR_MENU_ANIM_DURATION = 0.35;
const SPECTACLES_MENU_SCALE_IN_DURATION = 0.25;
const SPECTACLES_MENU_SCALE_OUT_DURATION = 0.2;

type SetUIStateOptions = {
  immediate?: boolean;
};

/** Runtime HUD: editor shows MainUI after registration; Spectacles uses wrist gesture only. */
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

    const debugLogRoot = findChildRecursive(panel, "DebugLog");
    if (debugLogRoot && this.arBridgeCoordinator) {
      this.arBridgeCoordinator.arBridgeServices.state.uiLogger.bindConsoleOutput(debugLogRoot);
    }

    if (appState) {
      this._operatingMode = appState.operatingMode;
      this._lidarMode = appState.lidarMode;
      this._debugModeEnabled = appState.debugMode;
    }

    if (this.arBridgeCoordinator) {
      const presentation = bridgeLinkPresentation(
        this.arBridgeCoordinator.bridgeLinkState,
        this.arBridgeCoordinator.appState.robotRuntime.displayName,
      );
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
      this._ensureWristMenuController(panel);
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

  private _ensureWristMenuController(panel: SceneObject): void {
    if (this._isEditorMode || this._wristMenuController) {
      return;
    }

    if (!this.wristMenuRoot) {
      print("UIManager: wristMenuRoot not set — wrist menu disabled");
      this.setUIState(0, { immediate: true });
      return;
    }

    try {
      this._wristMenuController = new WristMenuController({
        panel,
        anchorRoot: this.wristMenuRoot,
        handType: "left",
        onBeforeShow: () => this._mainMenuView?.applySpectaclesFrameMotion(),
        onMenuShow: () => this.setUIState(1),
        onMenuHide: (immediate) => this.setUIState(0, { immediate }),
      });
    } catch (error) {
      print(`UIManager: ${error}`);
      return;
    }

    this.createEvent("UpdateEvent").bind(() => {
      this._wristMenuController?.tick(getDeltaTime());
    });
  }

  public setUIState(state: number, options?: SetUIStateOptions): void {
    const immediate = options?.immediate ?? false;
    if (!immediate && this._uiState === state) {
      return;
    }
    this._uiState = state;

    const panel = this._panelRoot();
    if (!panel) {
      return;
    }

    const menuScale = this._isEditorMode ? EDITOR_MENU_SCALE : SPECTACLES_MENU_SCALE;
    const visibleScale = new vec3(menuScale, menuScale, menuScale);

    if (state === 0) {
      if (immediate) {
        panel.enabled = false;
        panel.getTransform().setLocalScale(new vec3(0, 0, 0));
        return;
      }
      scaleOut(
        panel,
        this._isEditorMode ? EDITOR_MENU_ANIM_DURATION : SPECTACLES_MENU_SCALE_OUT_DURATION,
      );
      return;
    }

    if (state === 1) {
      if (immediate) {
        panel.enabled = true;
        panel.getTransform().setLocalScale(visibleScale);
      } else {
        scaleIn(
          panel,
          this._isEditorMode ? EDITOR_MENU_ANIM_DURATION : SPECTACLES_MENU_SCALE_IN_DURATION,
          visibleScale,
        );
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
    const presentation = bridgeLinkPresentation(
      this.arBridgeCoordinator.bridgeLinkState,
      this.arBridgeCoordinator.appState.robotRuntime.displayName,
    );
    this._setStatus(presentation.text, presentation.color);
    if (this.arBridgeCoordinator.isBridgeSessionReady()) {
      this.arBridgeCoordinator.requestBridgeStatus();
    }
  }

  private _setStatus(text: string, color: vec4): void {
    this._mainMenuView?.setStatus(text, color);
  }

  private _applyAppState(state: AppStateData): void {
    const runtimeVisible = state.phase === "runtime";
    const uiStateChanged = this._uiState !== (runtimeVisible ? 1 : 0);
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
    const bridgePresentation = bridgeLinkPresentation(
      this.arBridgeCoordinator.bridgeLinkState,
      state.robotRuntime.displayName,
    );
    this._setStatus(bridgePresentation.text, bridgePresentation.color);

    if (this._isEditorMode) {
      this.setUIState(runtimeVisible ? 1 : 0);
      if ((uiStateChanged || operatingModeChanged) && runtimeVisible) {
        this._refreshBridgeStatus();
      }
      return;
    }

    if (operatingModeChanged) {
      this._refreshBridgeStatus();
    }
  }
}
