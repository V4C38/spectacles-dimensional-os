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
  findText,
  FONT_BUTTON,
  FONT_CAPTION,
  getFrameComponent,
  setButtonEnabled,
  setButtonStyle,
  setButtonToggleState,
  SnapOS2Styles,
} from "./kit/UIKit";

// ================================================================
/** Main HUD panel for restart, emergency stop, LiDAR toggle, and mode controls. */
// ================================================================

interface ModeButtonConfig {
  mode: OperatingMode;
  button: ButtonBinding;
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
  private readonly _modeButtons: ModeButtonConfig[];
  private readonly _onModeButtonPressed: (mode: OperatingMode) => void;
  private _operatingMode: OperatingMode;
  private _debugModeEnabled = false;

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
    const manualMode = findButtonBinding(panel, "ModeManual", "TextModeManual");
    const agentMode = findButtonBinding(panel, "ModeAgent", "TextModeAgent");
    const showLiDAR = findButtonBinding(panel, "ShowLiDAR", "ShowLiDARLabel");
    const debugMode = findButtonBinding(panel, "DebugMode", "DebugModeLabel");

    if (
      !statusText ||
      !restart ||
      !emergencyStop ||
      !manualMode ||
      !agentMode ||
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
    this._modeButtons = [
      {
        mode: "manual",
        button: manualMode,
      },
      {
        mode: "agent",
        button: agentMode,
      },
    ];
    this._operatingMode = callbacks.getOperatingMode();
    this._debugModeEnabled = callbacks.getDebugModeValue();
    this._onModeButtonPressed = callbacks.onModeButtonPressed;

    this._initializeStyles();
    for (const modeButton of this._modeButtons) {
      modeButton.button.button.onTriggerUp.add(() =>
        this._onModeButtonPressed(modeButton.mode),
      );
    }
    this.setOperatingMode(this._operatingMode);

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
    this._operatingMode = mode;
    this._syncModeButtonPresentation();
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

  private _syncModeButtonPresentation(): void {
    for (const modeButton of this._modeButtons) {
      const active = this._operatingMode === modeButton.mode;
      setButtonStyle(
        modeButton.button.button,
        active ? SnapOS2Styles.Primary : SnapOS2Styles.Secondary,
      );
    }
  }

  private _initializeStyles(): void {
    this._restart.labelText && (this._restart.labelText.size = FONT_BUTTON);
    this._emergencyStop.labelText && (this._emergencyStop.labelText.size = FONT_BUTTON);
    configureButtonToggle(this._emergencyStop.button, true);
    setButtonToggleState(this._emergencyStop.button, true);
    for (const modeButton of this._modeButtons) {
      modeButton.button.labelText && (modeButton.button.labelText.size = FONT_BUTTON);
      (modeButton.button.button as any)._toggleable = false;
    }
    this._showLiDAR.labelText && (this._showLiDAR.labelText.size = FONT_BUTTON);
    this._debugMode.labelText && (this._debugMode.labelText.size = FONT_BUTTON);
    configureButtonToggle(this._debugMode.button, this._debugModeEnabled);

    this._statusText.size = FONT_CAPTION;
  }
}
