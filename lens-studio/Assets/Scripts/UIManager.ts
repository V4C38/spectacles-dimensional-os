import { RectangleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton";
import { DimosManager } from "./DimosManager";
import { BridgeStatusMessage } from "./Network/Protocol";
import { SetupWizard } from "./SetupWizard";
import { scaleIn, scaleOut } from "./UI/Shared/UIAnimations";
import { createIconButton, createText, setButtonStyle, SnapOS2Styles } from "./UI/Shared/UIBuilders";
import {
  BUTTON_HEIGHT,
  BUTTON_WIDTH,
  COLOR_ERROR,
  COLOR_SUCCESS,
  COLOR_WARN,
  COLOR_WHITE,
  FONT_CAPTION,
  FONT_HUD_TITLE,
  Z_BUTTONS,
  Z_CONTENT,
} from "./UI/Shared/UIConstants";
import { bindFrameLayout, UIFrameMetrics } from "./UI/Shared/UIFrameMetrics";

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
  private _titleText: Text | null = null;
  private _statusText: Text | null = null;
  private _debugMode = false;
  private _showLidar = true;

  onAwake() {
    this.createEvent("OnStartEvent").bind(() => {
      this._buildMainUI();
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

  private _buildMainUI(): void {
    const panel = this._panelRoot();
    if (!panel) {
      print("UIManager: mainUIFrame not set — assign MainUI in Lens Studio");
      return;
    }

    this._titleText = createText({
      parent: panel,
      name: "MainTitle",
      text: "DimOS AR",
      fontSize: FONT_HUD_TITLE,
      color: COLOR_WHITE,
      horizontalAlignment: HorizontalAlignment.Center,
    });
    this._statusText = createText({
      parent: panel,
      name: "MainStatus",
      text: "Bridge disconnected",
      fontSize: FONT_CAPTION,
      color: COLOR_ERROR,
      horizontalAlignment: HorizontalAlignment.Center,
    });

    const restart = createIconButton(
      panel,
      "RestartSetup",
      "Restart Setup",
      BUTTON_WIDTH + 1.5,
      BUTTON_HEIGHT * 0.72,
      vec3.zero(),
      SnapOS2Styles.Ghost,
    );
    this._restartBtn = restart.button;
    this._restartObj = restart.sceneObject;
    this._restartLabel = restart.labelText;
    this._restartBtn.onTriggerUp.add(() => {
      this.setUIState(0);
      if (this.setupWizard) {
        this.setupWizard.startSetupWizard();
      }
    });

    const debug = createIconButton(
      panel,
      "DebugMode",
      "Debug Mode: Off",
      BUTTON_WIDTH + 1.5,
      BUTTON_HEIGHT * 0.72,
      vec3.zero(),
      SnapOS2Styles.Ghost,
    );
    this._debugBtn = debug.button;
    this._debugObj = debug.sceneObject;
    this._debugLabel = debug.labelText;
    this._debugBtn.onTriggerUp.add(() => this._toggleDebugMode());

    const lidar = createIconButton(
      panel,
      "ShowLidar",
      "Show LiDAR: On",
      BUTTON_WIDTH + 1.5,
      BUTTON_HEIGHT * 0.72,
      vec3.zero(),
      SnapOS2Styles.Ghost,
    );
    this._lidarBtn = lidar.button;
    this._lidarObj = lidar.sceneObject;
    this._lidarLabel = lidar.labelText;
    this._lidarBtn.onTriggerUp.add(() => this._toggleLidar());

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

    bindFrameLayout(panel, () => this._applyLayout());
    this._applyLayout();
  }

  private _applyLayout(): void {
    const panel = this._panelRoot();
    if (
      !panel ||
      !this._titleText ||
      !this._statusText ||
      !this._restartObj ||
      !this._restartBtn ||
      !this._debugObj ||
      !this._debugBtn ||
      !this._lidarObj ||
      !this._lidarBtn
    ) {
      return;
    }
    const metrics = UIFrameMetrics.fromSceneObject(panel);
    const sidePad = 1.2;
    const gap = 0.8;
    const availableButtonWidth = metrics.contentWidth - sidePad * 2 - gap * 2;
    const buttonWidth = Math.min(BUTTON_WIDTH + 1.0, availableButtonWidth / 3);
    const buttonHeight = BUTTON_HEIGHT * 0.72;
    const titleY = metrics.contentTopY - 0.8;
    const statusY = titleY - 1.8;
    const buttonY = statusY - 2.5;

    this._titleText.getSceneObject().getTransform().setLocalPosition(
      new vec3(0, titleY, Z_CONTENT),
    );
    this._titleText.worldSpaceRect = Rect.create(
      -metrics.contentWidth / 2,
      metrics.contentWidth / 2,
      -1.4,
      1.4,
    );
    this._statusText.getSceneObject().getTransform().setLocalPosition(
      new vec3(0, statusY, Z_CONTENT),
    );
    this._statusText.worldSpaceRect = Rect.create(
      -metrics.contentWidth / 2,
      metrics.contentWidth / 2,
      -1.0,
      1.0,
    );

    const leftX = -metrics.contentWidth / 2 + sidePad + buttonWidth / 2;
    const centerX = 0;
    const rightX = metrics.contentWidth / 2 - sidePad - buttonWidth / 2;
    this._restartObj.getTransform().setLocalPosition(new vec3(leftX, buttonY, Z_BUTTONS));
    this._debugObj.getTransform().setLocalPosition(new vec3(centerX, buttonY, Z_BUTTONS));
    this._lidarObj.getTransform().setLocalPosition(new vec3(rightX, buttonY, Z_BUTTONS));
    this._restartBtn.size = new vec3(buttonWidth, buttonHeight, 0.5);
    this._debugBtn.size = new vec3(buttonWidth, buttonHeight, 0.5);
    this._lidarBtn.size = new vec3(buttonWidth, buttonHeight, 0.5);
    this._setButtonLabelRect(this._restartLabel, buttonWidth, buttonHeight);
    this._setButtonLabelRect(this._debugLabel, buttonWidth, buttonHeight);
    this._setButtonLabelRect(this._lidarLabel, buttonWidth, buttonHeight);
  }

  public setUIState(state: number): void {
    this._uiState = state;
    if (state === 0) {
      const panel = this._panelRoot();
      if (panel) {
        scaleOut(panel, 0.35);
      }
      if (this.dimosManager) {
        this.dimosManager.setIsActive(false);
        this.dimosManager.disconnect();
      }
    } else if (state === 1) {
      const panel = this._panelRoot();
      if (panel) {
        scaleIn(panel, 0.35);
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
      const serial = msg.robot_serial ?? msg.robot_id;
      this._titleText.text = `${model} (${serial})`;
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

  private _toggleDebugMode(): void {
    this._debugMode = !this._debugMode;
    if (this._debugLabel) {
      this._debugLabel.text = this._debugMode ? "Debug Mode: On" : "Debug Mode: Off";
    }
    if (this.dimosManager) {
      this.dimosManager.setDebugMode(this._debugMode);
    }
    if (this._debugBtn) {
      setButtonStyle(this._debugBtn, SnapOS2Styles.Ghost);
    }
  }

  private _toggleLidar(): void {
    this._showLidar = !this._showLidar;
    if (this._lidarLabel) {
      this._lidarLabel.text = this._showLidar ? "Show LiDAR: On" : "Show LiDAR: Off";
    }
    if (this.dimosManager) {
      this.dimosManager.setShowLidar(this._showLidar);
    }
    if (this._lidarBtn) {
      setButtonStyle(this._lidarBtn, SnapOS2Styles.Ghost);
    }
  }

  private _formatRobotModel(raw: string): string {
    const normalized = raw.replace("unitree_", "");
    if (normalized.toLowerCase() === "go2") {
      return "Unitree Go2";
    }
    return `Unitree ${normalized.toUpperCase()}`;
  }
}
