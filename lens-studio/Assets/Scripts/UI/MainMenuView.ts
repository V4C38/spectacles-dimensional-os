import { OperatingMode } from "../AppState";
import {
  bindToggleButton,
  configureButtonToggle,
  setButtonStyle,
  setButtonToggleState,
  SnapOS2Styles,
} from "./Shared/UIBuilders";
import { scaleIn, scaleOut } from "./Shared/UIAnimations";
import {
  FONT_BUTTON,
  FONT_CAPTION,
  FONT_HUD_TITLE,
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

interface MainMenuCallbacks {
  onRestart: () => void;
  onShowLiDARChanged: (enabled: boolean) => void;
  onOperatingModeSelected: (mode: OperatingMode) => void;
  onNavigationPlacementChanged: (enabled: boolean) => void;
  onEmergencyStop: () => void;
  onToggleSubMenu: () => void;
  getShowLiDARValue: () => boolean;
  getNavigationPlacementValue: () => boolean;
  getOperatingMode: () => OperatingMode;
  getSubMenuExpanded: () => boolean;
}

export class MainMenuView {
  private readonly _titleText: Text;
  private readonly _statusText: Text;
  private readonly _restart: ButtonBinding;
  private readonly _emergencyStop: ButtonBinding;
  private readonly _subMenuToggle: ButtonBinding;
  private readonly _manualMode: ButtonBinding;
  private readonly _agentMode: ButtonBinding;
  private readonly _navigationPlacement: ButtonBinding;
  private readonly _showLiDAR: ButtonBinding;
  private readonly _subMenu: SceneObject;
  private readonly _manualMenu: SceneObject;
  private readonly _agentMenu: SceneObject;
  private _operatingMode: OperatingMode;
  private _subMenuExpanded: boolean;

  constructor(
    panel: SceneObject,
    callbacks: MainMenuCallbacks,
  ) {
    const titleText = findText(panel, "MainTitle");
    const statusText = findText(panel, "MainStatus");
    const restart = findButtonBinding(panel, "RestartSetup", "RestartSetupLabel");
    const emergencyStop = findButtonBinding(
      panel,
      "EmergencyStop",
      "EmergencyStopLabel",
    );
    const subMenuToggle = findButtonBinding(
      panel,
      "SubMenuToggle",
      "SubMenuToggleLabel",
    );
    const manualMode = findButtonBinding(panel, "ModeManual", "TextModeManual");
    const agentMode = findButtonBinding(panel, "ModeAgent", "TextModeAgent");
    const showLiDAR = findButtonBinding(panel, "ShowLiDAR", "ShowLiDARLabel");
    const navigationPlacement = findButtonBinding(
      panel,
      "EnableNavigation",
      "EnableNavigationLabel",
    );
    const subMenu = findChildRecursive(panel, "SubMenu");
    const manualMenu = findChildRecursive(panel, "ModeManualMenu");
    const agentMenu = findChildRecursive(panel, "ModeAgentMenu");

    if (
      !titleText ||
      !statusText ||
      !restart ||
      !emergencyStop ||
      !subMenuToggle ||
      !manualMode ||
      !agentMode ||
      !navigationPlacement ||
      !showLiDAR ||
      !subMenu ||
      !manualMenu ||
      !agentMenu
    ) {
      throw new Error("MainMenuView: MainUI scene hierarchy incomplete");
    }

    this._titleText = titleText;
    this._statusText = statusText;
    this._restart = restart;
    this._emergencyStop = emergencyStop;
    this._subMenuToggle = subMenuToggle;
    this._manualMode = manualMode;
    this._agentMode = agentMode;
    this._navigationPlacement = navigationPlacement;
    this._showLiDAR = showLiDAR;
    this._subMenu = subMenu;
    this._manualMenu = manualMenu;
    this._agentMenu = agentMenu;
    this._operatingMode = callbacks.getOperatingMode();
    this._subMenuExpanded = callbacks.getSubMenuExpanded();

    this._restart.button.onTriggerUp.add(callbacks.onRestart);
    this._manualMode.button.onTriggerUp.add(() =>
      callbacks.onOperatingModeSelected("manual"),
    );
    this._agentMode.button.onTriggerUp.add(() =>
      callbacks.onOperatingModeSelected("agent"),
    );
    bindToggleButton(
      this._navigationPlacement.button,
      callbacks.onNavigationPlacementChanged,
      callbacks.getNavigationPlacementValue,
    );
    bindToggleButton(
      this._showLiDAR.button,
      callbacks.onShowLiDARChanged,
      callbacks.getShowLiDARValue,
    );
    this._emergencyStop.button.onTriggerUp.add(callbacks.onEmergencyStop);
    this._subMenuToggle.button.onTriggerUp.add(callbacks.onToggleSubMenu);

    this._initializeStyles();
    this.setOperatingMode(this._operatingMode);
    this.setNavigationPlacementToggle(callbacks.getNavigationPlacementValue());
    this.setShowLiDARToggle(callbacks.getShowLiDARValue());
    this.setSubMenuExpanded(this._subMenuExpanded);
  }

  public setTitle(text: string): void {
    this._titleText.text = text;
  }

  public setStatus(text: string, color: vec4): void {
    this._statusText.text = text;
    this._statusText.textFill.color = color;
  }

  public setOperatingMode(mode: OperatingMode): void {
    this._operatingMode = mode;
    setButtonToggleState(this._manualMode.button, mode === "manual");
    setButtonToggleState(this._agentMode.button, mode === "agent");
    setButtonStyle(
      this._manualMode.button,
      mode === "manual" ? SnapOS2Styles.Primary : SnapOS2Styles.Secondary,
    );
    setButtonStyle(
      this._agentMode.button,
      mode === "agent" ? SnapOS2Styles.Primary : SnapOS2Styles.Secondary,
    );
    this._syncModeMenuVisibility();
  }

  public setShowLiDARToggle(enabled: boolean): void {
    setButtonToggleState(this._showLiDAR.button, enabled);
  }

  public setNavigationPlacementToggle(enabled: boolean): void {
    setButtonToggleState(this._navigationPlacement.button, enabled);
  }

  public setSubMenuExpanded(expanded: boolean): void {
    this._subMenuExpanded = expanded;
    if (expanded) {
      scaleIn(this._subMenu, 0.25);
    } else {
      scaleOut(this._subMenu, 0.2);
    }
    this._syncModeMenuVisibility();
    if (this._subMenuToggle.labelText) {
      this._subMenuToggle.labelText.text = expanded ? "Hide Modes" : "Show Modes";
    }
  }

  private _syncModeMenuVisibility(): void {
    this._manualMenu.enabled = this._subMenuExpanded && this._operatingMode === "manual";
    this._agentMenu.enabled = this._subMenuExpanded && this._operatingMode === "agent";
  }

  private _initializeStyles(): void {
    this._restart.labelText && (this._restart.labelText.size = FONT_BUTTON);
    this._emergencyStop.labelText && (this._emergencyStop.labelText.size = FONT_BUTTON);
    this._subMenuToggle.labelText && (this._subMenuToggle.labelText.size = FONT_BUTTON);
    this._manualMode.labelText && (this._manualMode.labelText.size = FONT_BUTTON);
    this._agentMode.labelText && (this._agentMode.labelText.size = FONT_BUTTON);
    this._navigationPlacement.labelText &&
      (this._navigationPlacement.labelText.size = FONT_BUTTON);
    this._showLiDAR.labelText && (this._showLiDAR.labelText.size = FONT_BUTTON);

    this._titleText.size = FONT_HUD_TITLE;
    this._statusText.size = FONT_CAPTION;
    configureButtonToggle(this._manualMode.button, false);
    configureButtonToggle(this._agentMode.button, false);
    configureButtonToggle(this._navigationPlacement.button, false);
    configureButtonToggle(this._showLiDAR.button, false);
  }
}
