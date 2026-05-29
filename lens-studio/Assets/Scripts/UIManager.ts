import { RectangleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton";
import { DimosManager } from "./DimosManager";
import { BridgeStatusMessage } from "./Network/Protocol";
import { SetupWizard } from "./SetupWizard";
import { scaleIn, scaleOut } from "./UI/Shared/UIAnimations";
import {
  createIconButton,
  setButtonStyle,
  setButtonToggleState,
  SnapOS2Styles,
} from "./UI/Shared/UIBuilders";
import {
  BUTTON_HEIGHT,
  BUTTON_WIDTH,
  COLOR_ERROR,
  COLOR_SUCCESS,
  COLOR_WARN,
  COLOR_WHITE,
  FONT_BUTTON,
  FONT_CAPTION,
  FONT_HUD_TITLE,
  Z_BUTTONS,
} from "./UI/Shared/UIConstants";
import { bindFrameLayout, UIFrameMetrics } from "./UI/Shared/UIFrameMetrics";

const HUD_FRAME_PAD_X = 1.2;
const HUD_FRAME_PAD_Y = 0.9;
const HUD_BUTTON_GAP = 0.8;
const HUD_BUTTON_HEIGHT = BUTTON_HEIGHT * 0.72;

/** 0=hidden, 1=active */
@component
export class UIManager extends BaseScriptComponent {
  /** HUD panel only (MainUI). Must not be the parent of SetupWizard. */
  @input
  mainUIFrame: SceneObject;

  @input
  navigationControlsFrame: SceneObject;

  @input
  dimosManager: DimosManager;

  @input
  setupWizard: SetupWizard;

  private _uiState = 0;
  private _restartBtn: RectangleButton | null = null;
  private _restartObj: SceneObject | null = null;
  private _restartLabel: Text | null = null;
  private _debugBtn: RectangleButton | null = null;
  private _debugObj: SceneObject | null = null;
  private _debugLabel: Text | null = null;
  private _lidarBtn: RectangleButton | null = null;
  private _lidarObj: SceneObject | null = null;
  private _lidarLabel: Text | null = null;
  private _placementBtn: RectangleButton | null = null;
  private _placementObj: SceneObject | null = null;
  private _placementLabel: Text | null = null;
  private _executeBtn: RectangleButton | null = null;
  private _executeObj: SceneObject | null = null;
  private _executeLabel: Text | null = null;
  private _stopBtn: RectangleButton | null = null;
  private _stopObj: SceneObject | null = null;
  private _stopLabel: Text | null = null;
  private _titleText: Text | null = null;
  private _statusText: Text | null = null;
  private _debugMode = false;
  private _showLidar = true;
  private _placementMode = false;
  private _executeMovement = true;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this._bindMainUI();
      this._buildNavigationUI();
      this.setUIState(0);
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

  private _navigationPanelRoot(): SceneObject | null {
    if (this.navigationControlsFrame) {
      return this.navigationControlsFrame;
    }
    const panel = this._panelRoot();
    if (!panel) {
      return null;
    }
    for (let i = 0; i < panel.getChildrenCount(); i++) {
      const child = panel.getChild(i);
      if (child.name === "NavigationControls") {
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

    this._titleText = this._findText(panel, "MainTitle");
    this._statusText = this._findText(panel, "MainStatus");
    const restart = this._findButtonBinding(panel, "RestartSetup", "RestartSetupLabel");
    this._restartBtn = restart?.button ?? null;
    this._restartObj = restart?.sceneObject ?? null;
    this._restartLabel = restart?.labelText ?? null;
    this._restartBtn?.onTriggerUp.add(() => {
      this.setUIState(0);
      if (this.setupWizard) {
        this.setupWizard.startSetupWizard();
      }
    });

    const debug = this._findButtonBinding(panel, "DebugMode", "DebugModeLabel");
    this._debugBtn = debug?.button ?? null;
    this._debugObj = debug?.sceneObject ?? null;
    this._debugLabel = debug?.labelText ?? null;
    this._bindToggleButton(
      this._debugBtn,
      (enabled) => this.dimosManager?.setDebugMode(enabled),
      () => this._debugMode,
    );

    const lidar = this._findButtonBinding(panel, "ShowLidar", "ShowLidarLabel");
    this._lidarBtn = lidar?.button ?? null;
    this._lidarObj = lidar?.sceneObject ?? null;
    this._lidarLabel = lidar?.labelText ?? null;
    this._bindToggleButton(
      this._lidarBtn,
      (enabled) => this.dimosManager?.setShowLidar(enabled),
      () => this._showLidar,
    );

    this._restartLabel && (this._restartLabel.size = FONT_BUTTON);
    this._debugLabel && (this._debugLabel.size = FONT_BUTTON);
    this._lidarLabel && (this._lidarLabel.size = FONT_BUTTON);
    if (this._titleText) {
      this._titleText.size = FONT_HUD_TITLE;
      this._titleText.text = "DimOS AR";
      this._titleText.textFill.color = COLOR_WHITE;
    }
    if (this._statusText) {
      this._statusText.size = FONT_CAPTION;
      this._statusText.text = "Bridge disconnected";
      this._statusText.textFill.color = COLOR_ERROR;
    }
    if (this._restartBtn) {
      setButtonStyle(this._restartBtn, SnapOS2Styles.Ghost);
    }
    if (this._restartLabel) {
      this._restartLabel.text = "Restart Setup";
    }
    if (this._debugLabel) {
      this._debugLabel.text = "Debug Mode";
    }
    if (this._lidarLabel) {
      this._lidarLabel.text = "Show LiDAR";
    }

    if (
      !this._titleText ||
      !this._statusText ||
      !this._restartBtn ||
      !this._restartObj ||
      !this._restartLabel ||
      !this._debugBtn ||
      !this._debugObj ||
      !this._debugLabel ||
      !this._lidarBtn ||
      !this._lidarObj ||
      !this._lidarLabel
    ) {
      print("UIManager: MainUI scene hierarchy incomplete");
      return;
    }

    if (this.dimosManager?.bridgeClient) {
      this.dimosManager.bridgeClient.ensureEventHandlers();
      this.dimosManager.bridgeClient.onBridgeStatus.push((msg) =>
        this._applyBridgeStatus(msg),
      );
      this.dimosManager.bridgeClient.onConnectionChanged.push((connected) =>
        this._applyConnectionState(connected),
      );
      if (this.dimosManager.bridgeClient.lastBridgeStatus) {
        this._applyBridgeStatus(this.dimosManager.bridgeClient.lastBridgeStatus);
      }
    }
    if (this.dimosManager) {
      this.dimosManager.onDebugModeChanged.push((enabled) => {
        this._debugMode = enabled;
        this._syncToggleState(this._debugBtn, enabled);
      });
      this.dimosManager.onShowLidarChanged.push((enabled) => {
        this._showLidar = enabled;
        this._syncToggleState(this._lidarBtn, enabled);
      });
      this._debugMode = this.dimosManager.debugMode;
      this._showLidar = this.dimosManager.showLidar;
    }
    this._syncToggleState(this._debugBtn, this._debugMode);
    this._syncToggleState(this._lidarBtn, this._showLidar);

  }

  private _buildNavigationUI(): void {
    const panel = this._panelRoot();
    const navPanel = this._navigationPanelRoot() ?? panel;
    if (!panel || !navPanel) {
      return;
    }

    const placement = createIconButton(
      navPanel,
      "PlacementMode",
      "Pin Drop",
      BUTTON_WIDTH + 1.5,
      BUTTON_HEIGHT * 0.72,
      vec3.zero(),
      SnapOS2Styles.PrimaryNeutral,
      true,
      this._placementMode,
    );
    this._placementBtn = placement.button;
    this._placementObj = placement.sceneObject;
    this._placementLabel = placement.labelText;
    this._placementLabel.size = FONT_BUTTON;
    this._bindToggleButton(
      this._placementBtn,
      (enabled) => this.dimosManager?.setPlacementMode(enabled),
      () => this._placementMode,
    );

    const execute = createIconButton(
      navPanel,
      "ExecuteMovement",
      "Execute",
      BUTTON_WIDTH + 1.5,
      BUTTON_HEIGHT * 0.72,
      vec3.zero(),
      SnapOS2Styles.PrimaryNeutral,
      true,
      this._executeMovement,
    );
    this._executeBtn = execute.button;
    this._executeObj = execute.sceneObject;
    this._executeLabel = execute.labelText;
    this._executeLabel.size = FONT_BUTTON;
    this._bindToggleButton(
      this._executeBtn,
      (enabled) => this.dimosManager?.setExecuteMovement(enabled),
      () => this._executeMovement,
    );

    const stop = createIconButton(
      navPanel,
      "EmergencyStop",
      "E-Stop",
      BUTTON_WIDTH + 1.5,
      BUTTON_HEIGHT * 0.72,
      vec3.zero(),
      SnapOS2Styles.Primary,
    );
    this._stopBtn = stop.button;
    this._stopObj = stop.sceneObject;
    this._stopLabel = stop.labelText;
    this._stopLabel.size = FONT_BUTTON;
    this._stopLabel.textFill.color = COLOR_ERROR;
    this._stopBtn.onTriggerUp.add(() => this.dimosManager?.requestEmergencyStop());

    if (this.dimosManager) {
      this.dimosManager.onPlacementModeChanged.push((enabled) => {
        this._placementMode = enabled;
        this._syncToggleState(this._placementBtn, enabled);
      });
      this.dimosManager.onExecuteMovementChanged.push((enabled) => {
        this._executeMovement = enabled;
        this._syncToggleState(this._executeBtn, enabled);
      });
      this._placementMode = this.dimosManager.placementMode;
      this._executeMovement = this.dimosManager.executeMovement;
    }
    this._syncToggleState(this._placementBtn, this._placementMode);
    this._syncToggleState(this._executeBtn, this._executeMovement);

    if (navPanel !== panel) {
      bindFrameLayout(navPanel, () => this._applyNavigationLayout());
    }
    this._applyNavigationLayout();
  }

  private _findChildRecursive(root: SceneObject, name: string): SceneObject | null {
    for (let i = 0; i < root.getChildrenCount(); i++) {
      const child = root.getChild(i);
      if (child.name === name) {
        return child;
      }
      const nested = this._findChildRecursive(child, name);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  private _findText(root: SceneObject, name: string): Text | null {
    const obj = this._findChildRecursive(root, name);
    if (!obj) {
      return null;
    }
    return obj.getComponent("Component.Text") as Text;
  }

  private _findButtonBinding(
    root: SceneObject,
    objectName: string,
    labelName: string,
  ): { sceneObject: SceneObject; button: RectangleButton; labelText: Text | null } | null {
    const obj = this._findChildRecursive(root, objectName);
    if (!obj) {
      return null;
    }
    const button = obj.getComponent(RectangleButton.getTypeName()) as RectangleButton;
    if (!button) {
      return null;
    }
    return {
      sceneObject: obj,
      button,
      labelText: this._findText(obj, labelName) ?? this._findText(root, labelName),
    };
  }

  private _applyNavigationLayout(): void {
    const navPanel = this._navigationPanelRoot();
    if (
      !navPanel ||
      !this._placementObj ||
      !this._placementBtn ||
      !this._executeObj ||
      !this._executeBtn ||
      !this._stopObj ||
      !this._stopBtn
    ) {
      return;
    }
    const rawNavMetrics = UIFrameMetrics.fromSceneObject(navPanel);
    const navMetrics = new UIFrameMetrics(
      rawNavMetrics.innerWidth,
      rawNavMetrics.innerHeight,
      HUD_FRAME_PAD_X,
      HUD_FRAME_PAD_Y,
    );
    const navButtonWidth = Math.min(
      7.4,
      (navMetrics.contentWidth - HUD_BUTTON_GAP * 2) / 3,
    );
    const navRowY = 0;
    const leftX = -navButtonWidth - HUD_BUTTON_GAP;
    const centerX = 0;
    const rightX = navButtonWidth + HUD_BUTTON_GAP;
    this._stopObj.getTransform().setLocalPosition(new vec3(leftX, navRowY, Z_BUTTONS));
    this._placementObj.getTransform().setLocalPosition(new vec3(centerX, navRowY, Z_BUTTONS));
    this._executeObj.getTransform().setLocalPosition(new vec3(rightX, navRowY, Z_BUTTONS));
    this._stopBtn.size = new vec3(navButtonWidth, HUD_BUTTON_HEIGHT, 0.5);
    this._placementBtn.size = new vec3(navButtonWidth, HUD_BUTTON_HEIGHT, 0.5);
    this._executeBtn.size = new vec3(navButtonWidth, HUD_BUTTON_HEIGHT, 0.5);
    this._setButtonLabelRect(this._stopLabel, navButtonWidth, HUD_BUTTON_HEIGHT);
    this._setButtonLabelRect(this._placementLabel, navButtonWidth, HUD_BUTTON_HEIGHT);
    this._setButtonLabelRect(this._executeLabel, navButtonWidth, HUD_BUTTON_HEIGHT);
    this._stopLabel && (this._stopLabel.size = FONT_BUTTON);
    this._placementLabel && (this._placementLabel.size = FONT_BUTTON);
    this._executeLabel && (this._executeLabel.size = FONT_BUTTON);
  }

  public setUIState(state: number): void {
    this._uiState = state;
    if (state === 0) {
      const panel = this._panelRoot();
      const navPanel = this._navigationPanelRoot();
      if (panel) {
        scaleOut(panel, 0.35);
      }
      if (navPanel && navPanel !== panel) {
        scaleOut(navPanel, 0.35);
      }
      if (this.dimosManager) {
        this.dimosManager.setIsActive(false);
        this.dimosManager.disconnect();
      }
    } else if (state === 1) {
      const panel = this._panelRoot();
      const navPanel = this._navigationPanelRoot();
      if (panel) {
        scaleIn(panel, 0.35);
      }
      if (navPanel && navPanel !== panel) {
        scaleIn(navPanel, 0.35);
      }
      if (this.dimosManager) {
        this.dimosManager.setIsActive(true);
        this._refreshBridgeStatus();
      }
    }
  }

  public get uiState(): number {
    return this._uiState;
  }

  private _applyBridgeStatus(msg: BridgeStatusMessage): void {
    if (this._titleText) {
      const model = this._formatRobotModel(msg.robot_model);
      this._titleText.text = model;
    }
    if (this._statusText) {
      if (msg.reconnecting) {
        this._setStatus("Bridge reconnecting", COLOR_WARN);
      } else if (!msg.robot_connected) {
        this._setStatus("Robot disconnected", COLOR_ERROR);
      } else if (!msg.streams_active) {
        this._setStatus("Robot connected - waiting for data", COLOR_WARN);
      } else if (!msg.registered) {
        this._setStatus("Robot data active - calibration needed", COLOR_WARN);
      } else {
        this._setStatus("Robot data active", COLOR_SUCCESS);
      }
    }
  }

  private _refreshBridgeStatus(): void {
    const bridgeClient = this.dimosManager?.bridgeClient;
    if (!bridgeClient) {
      this._setStatus("Bridge unavailable", COLOR_ERROR);
      return;
    }
    bridgeClient.ensureEventHandlers();
    if (bridgeClient.lastBridgeStatus) {
      this._applyBridgeStatus(bridgeClient.lastBridgeStatus);
    } else if (bridgeClient.isConnected()) {
      this._setStatus("Waiting for robot status", COLOR_WARN);
    } else {
      this._setStatus("Bridge disconnected", COLOR_ERROR);
    }
    if (bridgeClient.isConnected()) {
      bridgeClient.requestStatus();
    }
  }

  private _applyConnectionState(connected: boolean): void {
    if (!connected) {
      this._setStatus("Bridge disconnected", COLOR_ERROR);
      return;
    }
    this._setStatus("Waiting for robot status", COLOR_WARN);
    this.dimosManager?.bridgeClient?.requestStatus();
  }

  private _setStatus(text: string, color: vec4): void {
    if (!this._statusText) {
      return;
    }
    this._statusText.text = text;
    this._statusText.textFill.color = color;
  }

  private _setButtonLabelRect(label: Text | null, width: number, height: number): void {
    if (!label) {
      return;
    }
    label.worldSpaceRect = Rect.create(
      -width / 2 + 0.3,
      width / 2 - 0.3,
      -height / 2,
      height / 2,
    );
  }

  private _bindToggleButton(
    button: RectangleButton | null,
    onChanged: (enabled: boolean) => void,
    currentValue: () => boolean,
  ): void {
    if (!button) {
      return;
    }
    const toggleButton = button as RectangleButton & {
      onValueChange?: { add: (cb: (value: number) => void) => void };
    };
    if (toggleButton.onValueChange && typeof toggleButton.onValueChange.add === "function") {
      toggleButton.onValueChange.add((value: number) => onChanged(value === 1));
      return;
    }
    button.onTriggerUp.add(() => onChanged(!currentValue()));
  }

  private _syncToggleState(button: RectangleButton | null, enabled: boolean): void {
    setButtonToggleState(button, enabled);
  }

  private _formatRobotModel(raw: string): string {
    const normalized = raw.replace("unitree_", "");
    if (normalized.toLowerCase() === "go2") {
      return "Unitree Go2";
    }
    return `Unitree ${normalized.toUpperCase()}`;
  }
}
