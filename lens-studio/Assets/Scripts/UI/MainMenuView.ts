import { LidarDisplayMode, LIDAR_MODE_LABELS, OperatingMode } from "../AppState";
import {
  applyCapabilityButtonPresentation,
  bindToggleButton,
  configureButtonToggle,
  setButtonEnabled,
  setButtonStyle,
  setButtonToggleState,
  SnapOS2Styles,
} from "./Shared/UIBuilders";
import { animateScaleTo, scaleIn, scaleOut } from "./Shared/UIAnimations";
import {
  FONT_BUTTON,
  FONT_CAPTION,
} from "./Shared/UICore";
import {
  ButtonBinding,
  findButtonBinding,
  findChildRecursive,
  findText,
} from "./Shared/UICore";

// ================================================================
/** Main HUD panel for restart, emergency stop, LiDAR toggle, and mode controls. */
// ================================================================

interface ModePanelConfig {
  mode: OperatingMode;
  button: ButtonBinding;
  menu: SceneObject;
  baseLabel: string;
}

interface MainMenuCallbacks {
  onRestart: () => void;
  onLidarModeCycle: () => void;
  onModeButtonPressed: (mode: OperatingMode) => void;
  onNavigationPlacementChanged: (enabled: boolean) => void;
  onEmergencyStop: () => void;
  onDebugModeChanged: (enabled: boolean) => void;
  getLidarMode: () => LidarDisplayMode;
  getNavigationPlacementValue: () => boolean;
  getOperatingMode: () => OperatingMode;
  getExpandedSettingsMode: () => OperatingMode | null;
  getDebugModeValue: () => boolean;
}

export class MainMenuView {
  private readonly _statusText: Text;
  private readonly _restart: ButtonBinding;
  private readonly _emergencyStop: ButtonBinding;
  private readonly _navigationPlacement: ButtonBinding;
  private readonly _showLiDAR: ButtonBinding;
  private readonly _debugMode: ButtonBinding;
  private readonly _subMenu: SceneObject;
  private readonly _modePanels: ModePanelConfig[];
  private _operatingMode: OperatingMode;
  private _expandedSettingsMode: OperatingMode | null;
  private _navigationPlacementEnabled = false;
  private _debugModeEnabled = false;
  private readonly _emergencyStopBaseScale: vec3;
  private readonly _emergencyStopHoverScale: vec3;

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
    const navigationPlacement = findButtonBinding(
      panel,
      "EnableNavigation",
      "EnableNavigationLabel",
    );
    const subMenu = findChildRecursive(panel, "SubMenu");
    const manualMenu = findChildRecursive(panel, "ModeManualMenu");
    const agentMenu = findChildRecursive(panel, "ModeAgentMenu");

    if (
      !statusText ||
      !restart ||
      !emergencyStop ||
      !manualMode ||
      !agentMode ||
      !navigationPlacement ||
      !showLiDAR ||
      !debugMode ||
      !subMenu ||
      !manualMenu ||
      !agentMenu
    ) {
      throw new Error("MainMenuView: MainUI scene hierarchy incomplete");
    }

    this._statusText = statusText;
    this._restart = restart;
    this._emergencyStop = emergencyStop;
    this._emergencyStopBaseScale =
      emergencyStop.sceneObject.getTransform().getLocalScale();
    this._emergencyStopHoverScale =
      this._emergencyStopBaseScale.uniformScale(1.05);
    this._navigationPlacement = navigationPlacement;
    this._showLiDAR = showLiDAR;
    this._debugMode = debugMode;
    this._subMenu = subMenu;
    this._modePanels = [
      {
        mode: "manual",
        button: manualMode,
        menu: manualMenu,
        baseLabel: manualMode.labelText?.text ?? "Manual",
      },
      {
        mode: "agent",
        button: agentMode,
        menu: agentMenu,
        baseLabel: agentMode.labelText?.text ?? "Agent",
      },
    ];
    this._operatingMode = callbacks.getOperatingMode();
    this._expandedSettingsMode = callbacks.getExpandedSettingsMode();
    this._debugModeEnabled = callbacks.getDebugModeValue();

    this._restart.button.onTriggerUp.add(callbacks.onRestart);
    for (const panel of this._modePanels) {
      // Use triggerDown so submenu scale-in on release cannot re-hit the button.
      panel.button.button.onTriggerDown.add(() =>
        callbacks.onModeButtonPressed(panel.mode),
      );
    }
    bindToggleButton(
      this._navigationPlacement.button,
      callbacks.onNavigationPlacementChanged,
      callbacks.getNavigationPlacementValue,
    );
    bindToggleButton(
      this._debugMode.button,
      callbacks.onDebugModeChanged,
      callbacks.getDebugModeValue,
    );
    this._showLiDAR.button.onTriggerUp.add(callbacks.onLidarModeCycle);
    this._emergencyStop.button.onTriggerUp.add(() => {
      callbacks.onEmergencyStop();
      setButtonToggleState(this._emergencyStop.button, true);
    });
    this._bindEmergencyStopHoverScale();

    this._initializeStyles();
    this.setOperatingMode(this._operatingMode);
    this.setNavigationPlacementToggle(callbacks.getNavigationPlacementValue());
    this.setDebugModeToggle(callbacks.getDebugModeValue());
    this.setLidarModeDisplay(callbacks.getLidarMode());
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

  public setNavigationPlacementToggle(enabled: boolean): void {
    this._navigationPlacementEnabled = enabled;
    if (this._navigationPlacement.labelText) {
      this._navigationPlacement.labelText.text = this._navigationPlacementLabel(enabled);
    }
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

  public setNavigationPlacementAvailability(available: boolean): void {
    if (!this._navigationPlacement.button || !this._navigationPlacement.labelText) {
      return;
    }
    this._navigationPlacement.labelText.text = available
      ? this._navigationPlacementLabel(this._navigationPlacementEnabled)
      : "Navigation Marker\nUnavailable";
    setButtonEnabled(this._navigationPlacement.button, available);
  }

  private _navigationPlacementLabel(enabled: boolean): string {
    return enabled ? "Navigation Marker: on" : "Navigation Marker: off";
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
  }

  private _syncModeMenuVisibility(panel: ModePanelConfig): void {
    panel.menu.enabled = this._expandedSettingsMode === panel.mode;
  }

  private _applyModeButtonPresentation(panel: ModePanelConfig): void {
    const active = this._operatingMode === panel.mode;
    const settingsOpen = this._expandedSettingsMode === panel.mode;
    setButtonStyle(
      panel.button.button,
      active ? SnapOS2Styles.Primary : SnapOS2Styles.Secondary,
    );
    if (!panel.button.labelText) {
      return;
    }
    panel.button.labelText.text =
      active && settingsOpen
        ? `${panel.baseLabel} (Settings)`
        : panel.baseLabel;
  }

  private _bindEmergencyStopHoverScale(): void {
    const sceneObject = this._emergencyStop.sceneObject;
    this._emergencyStop.button.onHoverEnter.add(() => {
      animateScaleTo(sceneObject, this._emergencyStopHoverScale);
    });
    this._emergencyStop.button.onHoverExit.add(() => {
      animateScaleTo(sceneObject, this._emergencyStopBaseScale);
    });
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
    this._navigationPlacement.labelText &&
      (this._navigationPlacement.labelText.size = FONT_BUTTON);
    this._showLiDAR.labelText && (this._showLiDAR.labelText.size = FONT_BUTTON);
    this._debugMode.labelText && (this._debugMode.labelText.size = FONT_BUTTON);
    configureButtonToggle(this._debugMode.button, this._debugModeEnabled);

    this._statusText.size = FONT_CAPTION;
  }
}
