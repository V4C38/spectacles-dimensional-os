import {
  LidarDisplayMode,
  LIDAR_MODE_LABELS,
  NAV_GOAL_MODE_LABELS,
  NavigationGoalMode,
  OperatingMode,
} from "../Core/AppState";
import { RectangleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton";
import { scaleIn, scaleOut } from "./kit/UIAnimations";
import {
  applyCapabilityButtonPresentation,
  bindHoverScale,
  bindToggleButton,
  bindToggleOnValueChange,
  ButtonBinding,
  configureButtonToggle,
  findButtonBinding,
  findChildRecursive,
  findFirstText,
  findText,
  FONT_BUTTON,
  FONT_CAPTION,
  requireRectangleButton,
  setButtonEnabled,
  setButtonStyle,
  setButtonToggleState,
  SnapOS2Styles,
} from "./kit/UIKit";

// ================================================================
/** Main HUD panel for restart, emergency stop, LiDAR toggle, and mode controls. */
// ================================================================

interface ModePanelConfig {
  mode: OperatingMode;
  button: ButtonBinding;
  menu: SceneObject;
}

interface MainMenuCallbacks {
  onRestart: () => void;
  onLidarModeCycle: () => void;
  onModeButtonPressed: (mode: OperatingMode) => void;
  onModeSettingsChanged: (enabled: boolean) => void;
  onNavigationGoalModeCycle: () => void;
  onEmergencyStop: () => void;
  onDebugModeChanged: (enabled: boolean) => void;
  getLidarMode: () => LidarDisplayMode;
  getNavigationGoalMode: () => NavigationGoalMode;
  getOperatingMode: () => OperatingMode;
  getExpandedSettingsMode: () => OperatingMode | null;
  getModeSettingsExpanded: () => boolean;
  getDebugModeValue: () => boolean;
}

export class MainMenuView {
  private readonly _statusText: Text;
  private readonly _restart: ButtonBinding;
  private readonly _emergencyStop: ButtonBinding;
  private readonly _modeSwitch: ButtonBinding;
  private readonly _showLiDAR: ButtonBinding;
  private readonly _debugMode: ButtonBinding;
  private readonly _subMenu: SceneObject;
  private readonly _modeSettings: RectangleButton;
  private readonly _modePanels: ModePanelConfig[];
  private _operatingMode: OperatingMode;
  private _expandedSettingsMode: OperatingMode | null;
  private _debugModeEnabled = false;
  private _navigationGoalMode: NavigationGoalMode = "single";
  private _suppressModeSettingsChange = false;

  constructor(
    panel: SceneObject,
    callbacks: MainMenuCallbacks,
  ) {
    const statusText = findText(panel, "MainStatus");
    const restart = findButtonBinding(panel, "RestartSetup", "RestartSetupLabel");
    const emergencyStop = findButtonBinding(
      panel,
      "EmergencyStop",
      "EmergencyStopLabel",
    );
    const manualMode = findButtonBinding(panel, "ModeManual", "TextModeManual");
    const agentMode = findButtonBinding(panel, "ModeAgent", "TextModeAgent");
    const showLiDAR = findButtonBinding(panel, "ShowLiDAR", "ShowLiDARLabel");
    const debugMode = findButtonBinding(panel, "DebugMode", "DebugModeLabel");
    const manualMenu = findChildRecursive(panel, "ModeManualMenu");
    const modeSwitch = manualMenu
      ? findButtonBinding(manualMenu, "ModeSwitch", "EnableNavigationLabel")
      : null;
    const subMenu = findChildRecursive(panel, "SubMenu");
    const agentMenu = findChildRecursive(panel, "ModeAgentMenu");
    const modeSettingsObj = findChildRecursive(panel, "ModeSettings");

    if (
      !statusText ||
      !restart ||
      !emergencyStop ||
      !manualMode ||
      !agentMode ||
      !modeSwitch ||
      !showLiDAR ||
      !debugMode ||
      !subMenu ||
      !manualMenu ||
      !agentMenu ||
      !modeSettingsObj
    ) {
      throw new Error("MainMenuView: MainUI scene hierarchy incomplete");
    }

    const modeSettings = requireRectangleButton(modeSettingsObj, "MainMenuView");

    this._statusText = statusText;
    this._restart = restart;
    this._emergencyStop = emergencyStop;
    this._modeSwitch = modeSwitch;
    this._showLiDAR = showLiDAR;
    this._debugMode = debugMode;
    this._subMenu = subMenu;
    this._modeSettings = modeSettings;
    this._modePanels = [
      {
        mode: "manual",
        button: manualMode,
        menu: manualMenu,
      },
      {
        mode: "agent",
        button: agentMode,
        menu: agentMenu,
      },
    ];
    this._operatingMode = callbacks.getOperatingMode();
    this._expandedSettingsMode = callbacks.getExpandedSettingsMode();
    this._debugModeEnabled = callbacks.getDebugModeValue();
    this._navigationGoalMode = callbacks.getNavigationGoalMode();

    this._restart.button.onTriggerUp.add(callbacks.onRestart);
    for (const panel of this._modePanels) {
      panel.button.button.onTriggerUp.add(() =>
        callbacks.onModeButtonPressed(panel.mode),
      );
    }
    bindToggleOnValueChange(this._modeSettings, (enabled) => {
      if (this._suppressModeSettingsChange) {
        return;
      }
      callbacks.onModeSettingsChanged(enabled);
    });
    bindToggleButton(
      this._debugMode.button,
      callbacks.onDebugModeChanged,
      callbacks.getDebugModeValue,
    );
    this._showLiDAR.button.onTriggerUp.add(callbacks.onLidarModeCycle);
    this._modeSwitch.button.onTriggerUp.add(callbacks.onNavigationGoalModeCycle);
    this._emergencyStop.button.onTriggerUp.add(() => {
      callbacks.onEmergencyStop();
      setButtonToggleState(this._emergencyStop.button, true);
    });
    bindHoverScale(this._emergencyStop.button, this._emergencyStop.sceneObject);

    this._initializeStyles();
    this.setOperatingMode(this._operatingMode);
    this.setDebugModeToggle(callbacks.getDebugModeValue());
    this.setLidarModeDisplay(callbacks.getLidarMode());
    this.setNavigationGoalModeDisplay(this._navigationGoalMode);
    this.setExpandedSettingsMode(this._expandedSettingsMode);
  }

  public setStatus(text: string, color: vec4): void {
    this._statusText.text = text;
    this._statusText.textFill.color = color;
  }

  public setOperatingMode(mode: OperatingMode): void {
    this._operatingMode = mode;
    this._syncModePresentation();
  }

  public setNavigationGoalModeDisplay(mode: NavigationGoalMode): void {
    this._navigationGoalMode = mode;
    if (this._modeSwitch.labelText) {
      this._modeSwitch.labelText.text = NAV_GOAL_MODE_LABELS[mode];
    }
  }

  public setLidarModeDisplay(mode: LidarDisplayMode): void {
    if (this._showLiDAR.labelText) {
      this._showLiDAR.labelText.text = LIDAR_MODE_LABELS[mode];
    }
  }

  public setLidarModeAvailability(
    available: boolean,
    mode: LidarDisplayMode,
  ): void {
    if (!this._showLiDAR.button || !this._showLiDAR.labelText) {
      return;
    }
    this._showLiDAR.labelText.text = available
      ? LIDAR_MODE_LABELS[mode]
      : "LiDAR\nUnavailable";
    setButtonEnabled(this._showLiDAR.button, available);
  }

  public setNavigationGoalModeAvailability(available: boolean): void {
    if (!this._modeSwitch.button || !this._modeSwitch.labelText) {
      return;
    }
    this._modeSwitch.labelText.text = available
      ? NAV_GOAL_MODE_LABELS[this._navigationGoalMode]
      : "Navigation\nUnavailable";
    setButtonEnabled(this._modeSwitch.button, available);
  }

  public setDebugModeToggle(enabled: boolean): void {
    this._debugModeEnabled = enabled;
    if (this._debugMode.labelText) {
      this._debugMode.labelText.text = this._debugModeLabel(enabled);
    }
    setButtonToggleState(this._debugMode.button, enabled);
  }

  private _debugModeLabel(enabled: boolean): string {
    return enabled ? "Debug: on" : "Debug: off";
  }

  public setEmergencyStopAvailability(
    available: boolean,
    _reason: string | null = null,
  ): void {
    applyCapabilityButtonPresentation(
      this._emergencyStop.button,
      this._emergencyStop.labelText,
      {
        available,
        availableLabel: "Emergency Stop",
        unavailableLabel: "Emergency Stop\nUnavailable",
        availableStyle: SnapOS2Styles.Special,
        unavailableStyle: SnapOS2Styles.Special,
      },
    );
    if (available) {
      setButtonToggleState(this._emergencyStop.button, true);
    }
  }

  public setExpandedSettingsMode(mode: OperatingMode | null): void {
    if (this._expandedSettingsMode === mode) {
      this._syncModePresentation();
      return;
    }
    const wasExpanded = this._expandedSettingsMode !== null;
    const willExpand = mode !== null;
    this._expandedSettingsMode = mode;
    if (willExpand && !wasExpanded) {
      scaleIn(this._subMenu, 0.25);
    } else if (!willExpand && wasExpanded) {
      scaleOut(this._subMenu, 0.2);
    }
    this._syncModePresentation();
  }

  private _syncModePresentation(): void {
    for (const panel of this._modePanels) {
      this._applyModeButtonPresentation(panel);
      this._syncModeMenuVisibility(panel);
    }
    this._syncModeSettingsPresentation();
  }

  private _syncModeMenuVisibility(panel: ModePanelConfig): void {
    panel.menu.enabled = this._expandedSettingsMode === panel.mode;
  }

  private _applyModeButtonPresentation(panel: ModePanelConfig): void {
    const active = this._operatingMode === panel.mode;
    setButtonStyle(
      panel.button.button,
      active ? SnapOS2Styles.Primary : SnapOS2Styles.Secondary,
    );
  }

  private _syncModeSettingsPresentation(): void {
    const expanded = this._expandedSettingsMode !== null;
    this._suppressModeSettingsChange = true;
    setButtonToggleState(this._modeSettings, expanded);
    this._suppressModeSettingsChange = false;
  }

  private _initializeStyles(): void {
    this._restart.labelText && (this._restart.labelText.size = FONT_BUTTON);
    this._emergencyStop.labelText && (this._emergencyStop.labelText.size = FONT_BUTTON);
    configureButtonToggle(this._emergencyStop.button, true);
    setButtonToggleState(this._emergencyStop.button, true);
    for (const panel of this._modePanels) {
      panel.button.labelText && (panel.button.labelText.size = FONT_BUTTON);
      (panel.button.button as any)._toggleable = false;
    }
    const modeSettingsLabel = findFirstText(this._modeSettings.getSceneObject());
    modeSettingsLabel && (modeSettingsLabel.size = FONT_BUTTON);
    configureButtonToggle(this._modeSettings, false);
    this._modeSwitch.labelText && (this._modeSwitch.labelText.size = FONT_BUTTON);
    this._showLiDAR.labelText && (this._showLiDAR.labelText.size = FONT_BUTTON);
    this._debugMode.labelText && (this._debugMode.labelText.size = FONT_BUTTON);
    configureButtonToggle(this._debugMode.button, this._debugModeEnabled);

    this._statusText.size = FONT_CAPTION;
  }
}
