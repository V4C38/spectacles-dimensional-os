import {
  LidarDisplayMode,
  LIDAR_MODE_LABELS,
  OperatingMode,
} from "../AppState";
import { RoundButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton";
import { Frame } from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame";
import {
  applyCapabilityButtonPresentation,
  bindHoverScale,
  bindToggleButton,
  ButtonBinding,
  configureButtonToggle,
  findButtonBinding,
  findChildRecursive,
  findText,
  FONT_BUTTON,
  FONT_CAPTION,
  getFrameComponent,
  setButtonEnabled,
  setButtonToggleState,
  SnapOS2Styles,
} from "./UIKit";

// ================================================================
/** Main HUD panel for restart, emergency stop, LiDAR toggle, and mode controls. */
// ================================================================

interface ModeButtonPair {
  mode: OperatingMode;
  primary: ButtonBinding;
  secondary: ButtonBinding;
}

interface MainMenuCallbacks {
  onRestart: () => void;
  onLidarModeCycle: () => void;
  onModeButtonPressed: (mode: OperatingMode) => void;
  onEmergencyStop: () => void;
  onDebugModeChanged: (enabled: boolean) => void;
  getLidarMode: () => LidarDisplayMode;
  getOperatingMode: () => OperatingMode;
  getDebugModeValue: () => boolean;
}

export class MainMenuView {
  private readonly _panel: SceneObject;
  private readonly _statusText: Text;
  private readonly _restart: ButtonBinding;
  private readonly _emergencyStop: ButtonBinding;
  private readonly _showLiDAR: ButtonBinding;
  private readonly _debugMode: ButtonBinding;
  private readonly _debugLogRoot: SceneObject | null;
  private readonly _modePairs: ModeButtonPair[];
  private readonly _onModeButtonPressed: (mode: OperatingMode) => void;
  private _operatingMode: OperatingMode;
  private _debugModeEnabled = false;
  private _lidarMode: LidarDisplayMode = "off";

  constructor(
    panel: SceneObject,
    callbacks: MainMenuCallbacks,
  ) {
    const statusText = findText(panel, "MainStatus");
    const restart = findButtonBinding(panel, "RestartRegistration", "RestartRegistrationLabel");
    const emergencyStop = findButtonBinding(
      panel,
      "EmergencyStop",
      "EmergencyStopLabel",
    );
    const manualPrimary = findButtonBinding(panel, "ModeManualPrimary", "TextModeManual");
    const manualSecondary = findButtonBinding(
      panel,
      "ModeManualSecondary",
      "TextModeManual",
    );
    const agentPrimary = findButtonBinding(panel, "ModeAgentPrimary", "TextModeAgent");
    const agentSecondary = findButtonBinding(
      panel,
      "ModeAgentSecondary",
      "TextModeAgent",
    );
    const showLiDAR = findButtonBinding(panel, "ShowLiDAR", "ShowLiDARLabel");
    const debugMode = findButtonBinding(panel, "DebugMode", "DebugModeLabel");

    if (
      !statusText ||
      !restart ||
      !emergencyStop ||
      !manualPrimary ||
      !manualSecondary ||
      !agentPrimary ||
      !agentSecondary ||
      !showLiDAR ||
      !debugMode
    ) {
      throw new Error("MainMenuView: MainUI scene hierarchy incomplete");
    }

    this._panel = panel;
    this._statusText = statusText;
    this._restart = restart;
    this._emergencyStop = emergencyStop;
    this._showLiDAR = showLiDAR;
    this._debugMode = debugMode;
    this._debugLogRoot = findChildRecursive(panel, "DebugLog");
    this._modePairs = [
      {
        mode: "manual",
        primary: manualPrimary,
        secondary: manualSecondary,
      },
      {
        mode: "agent",
        primary: agentPrimary,
        secondary: agentSecondary,
      },
    ];
    this._operatingMode = callbacks.getOperatingMode();
    this._debugModeEnabled = callbacks.getDebugModeValue();
    this._onModeButtonPressed = callbacks.onModeButtonPressed;

    this._initializeStyles();
    for (const pair of this._modePairs) {
      pair.primary.button.onTriggerUp.add(() => this._onModeButtonPressed(pair.mode));
      pair.secondary.button.onTriggerUp.add(() => this._onModeButtonPressed(pair.mode));
    }
    this._syncModeButtonPresentation();

    this._restart.button.onTriggerUp.add(callbacks.onRestart);
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
    bindHoverScale(this._emergencyStop.button, this._emergencyStop.sceneObject);

    this.setDebugModeToggle(callbacks.getDebugModeValue());
    this.setLidarModeDisplay(callbacks.getLidarMode());
  }

  public setStatus(text: string, color: vec4): void {
    this._statusText.text = text;
    this._statusText.textFill.color = color;
  }

  public setFrameFollowEnabled(enabled: boolean): void {
    const frame = getFrameComponent(this._panel);
    if (!frame) {
      return;
    }
    frame.setUseFollow(enabled);
    frame.setFollowing(enabled);
    this._syncFollowButton(frame, enabled);
  }

  public setFrameAllowTranslation(enabled: boolean): void {
    const frame = getFrameComponent(this._panel);
    if (!frame) {
      return;
    }
    frame.allowTranslation = enabled;
  }

  /** Spectacles wrist mode: disable Frame follow/translation after init completes. */
  public applySpectaclesFrameMotion(): void {
    this.setFrameAllowTranslation(false);
    this.setFrameFollowEnabled(false);
  }

  /** Editor mode: restore scene-authored Frame follow/translation behavior. */
  public applyEditorFrameMotion(): void {
    this.setFrameAllowTranslation(true);
    this.setFrameFollowEnabled(true);
  }

  private _syncFollowButton(frame: Frame, enabled: boolean): void {
    const followButton = frame.followButton as RoundButton | null;
    if (!followButton || typeof followButton.toggle !== "function") {
      return;
    }
    followButton.toggle(enabled);
  }

  public setOperatingMode(mode: OperatingMode): void {
    if (this._operatingMode === mode) {
      return;
    }
    this._operatingMode = mode;
    this._syncModeButtonPresentation();
  }

  public setLidarModeDisplay(mode: LidarDisplayMode): void {
    if (this._lidarMode === mode) {
      return;
    }
    this._lidarMode = mode;
    if (this._showLiDAR.labelText) {
      this._showLiDAR.labelText.text = LIDAR_MODE_LABELS[mode];
    }
    setButtonToggleState(this._showLiDAR.button, mode !== "off");
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
    if (available) {
      this._lidarMode = mode;
      setButtonToggleState(this._showLiDAR.button, mode !== "off");
    } else {
      setButtonToggleState(this._showLiDAR.button, false);
    }
  }

  public setDebugModeToggle(enabled: boolean): void {
    this._debugModeEnabled = enabled;
    if (this._debugMode.labelText) {
      this._debugMode.labelText.text = this._debugModeLabel(enabled);
    }
    setButtonToggleState(this._debugMode.button, enabled);
    if (this._debugLogRoot) {
      this._debugLogRoot.enabled = enabled;
    }
  }

  private _debugModeLabel(enabled: boolean): string {
    return enabled ? "⌕ Debug: on" : "⌕ Debug: off";
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

  private _syncModeButtonPresentation(): void {
    for (const pair of this._modePairs) {
      const active = this._operatingMode === pair.mode;
      pair.primary.sceneObject.enabled = active;
      pair.secondary.sceneObject.enabled = !active;
    }
  }

  private _initializeStyles(): void {
    this._restart.labelText && (this._restart.labelText.size = FONT_BUTTON);
    this._emergencyStop.labelText && (this._emergencyStop.labelText.size = FONT_BUTTON);
    configureButtonToggle(this._emergencyStop.button, true);
    setButtonToggleState(this._emergencyStop.button, true);
    for (const pair of this._modePairs) {
      for (const binding of [pair.primary, pair.secondary]) {
        binding.labelText && (binding.labelText.size = FONT_BUTTON);
        (binding.button as any)._toggleable = false;
      }
    }
    this._showLiDAR.labelText && (this._showLiDAR.labelText.size = FONT_BUTTON);
    configureButtonToggle(this._showLiDAR.button, false);
    this._debugMode.labelText && (this._debugMode.labelText.size = FONT_BUTTON);
    configureButtonToggle(this._debugMode.button, this._debugModeEnabled);

    this._statusText.size = FONT_CAPTION;
  }
}
