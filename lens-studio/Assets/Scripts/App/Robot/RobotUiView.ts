import animate from "SpectaclesInteractionKit.lspkg/Utils/animate";
import {
  AppStateData,
  OperatingMode,
  agentBusyVfxActive,
  robotActivityPresentation,
} from "../AppState";
import { formatRegistrationProgressText } from "../Registration/RegistrationFlow";
import { RectangleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton";
import { RoundButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton";
import {
  applyCapabilityButtonPresentation,
  bindHoverScale,
  COLOR_WHITE,
  configureButtonToggle,
  findChildRecursive,
  findText,
  FONT_BUTTON,
  FONT_CALIBRATE_PROGRESS,
  requireChild,
  requireRectangleButton,
  requireRoundButton,
  requireText,
  setButtonToggleState,
  SnapOS2Styles,
} from "../UI/UIKit";
import { UILogEntry } from "../UI/UILogger";
import { scaleIn, scaleOut } from "../Utilities/AnimationUtilities";

// ================================================================
/** Binds and updates the floating robot menu / marker HUD (toggle, stop, registration overlay). */
// ================================================================

const REGISTRATION_PROGRESS_ANIM_S = 0.35;

export interface RobotUiAssistOverlay {
  titleText: string;
  statusText: string;
  statusColor: vec4;
  progressPercent: number | null;
  showStop: boolean;
}

export interface RobotUiCallbacks {
  onToggle: () => void;
  onStop: () => void;
  onContinue?: () => void;
}

export class RobotUiView {
  private readonly markerRoot: SceneObject;
  private readonly toggleBtn: RoundButton;
  private readonly toggleVisual: RenderMeshVisual | null;
  private readonly menuObj: SceneObject;
  private readonly hudTitleText: Text | null;
  private readonly menuTitleText: Text;
  private readonly hudStateInfoText: Text | null;
  private readonly menuStateInfoText: Text;
  private readonly stopLabel: Text;
  private readonly stopObj: SceneObject;
  private readonly stopBtn: RectangleButton;
  private readonly manualModeMenu: SceneObject | null;
  private readonly agentModeMenu: SceneObject | null;
  private readonly registrationModeMenu: SceneObject | null;
  private readonly buttonVfxBusy: SceneObject | null;
  private readonly buttonVfxIdle: SceneObject | null;
  private readonly registrationProgressText: Text | null;
  private readonly _debugInfoText: Text | null;
  private _operatingMode: OperatingMode = "manual";
  private _inRegistrationMode = false;
  private _debugMode = false;
  private _uiLogEntry: UILogEntry | null = null;
  private _callbacks: RobotUiCallbacks | null = null;
  private _registrationPreviewActive = false;
  private _displayedProgressPercent: number | null = null;
  private _progressAnimToken = 0;

  constructor(markerRoot: SceneObject, menuRoot: SceneObject) {
    this.markerRoot = markerRoot;
    const toggleObj = requireChild(
      this.markerRoot,
      "RobotToggleButton",
      "RobotUiView",
    );
    this.menuObj = menuRoot;
    this.menuTitleText = requireText(this.menuObj, "RobotTitleText", "RobotUiView");
    this.hudTitleText = findText(this.markerRoot, "RobotTitleText");
    this.menuStateInfoText = requireText(this.menuObj, "StateInfoText", "RobotUiView");
    this.hudStateInfoText = findText(this.markerRoot, "StateInfoText");
    this.stopObj = requireChild(this.menuObj, "RobotMenuStop", "RobotUiView");
    this.manualModeMenu = findChildRecursive(this.menuObj, "ManualModeMenu");
    this.agentModeMenu = findChildRecursive(this.menuObj, "AgentModeMenu");
    this.registrationModeMenu = findChildRecursive(this.menuObj, "RegistrationModeMenu");
    this.buttonVfxBusy = findChildRecursive(this.markerRoot, "ButtonVFX_Busy");
    this.buttonVfxIdle = findChildRecursive(this.markerRoot, "ButtonVFX_Idle");
    this.registrationProgressText = this.registrationModeMenu
      ? findText(this.registrationModeMenu, "RegistrationProgressText")
      : null;
    if (this.registrationProgressText) {
      this.registrationProgressText.size = FONT_CALIBRATE_PROGRESS;
      this.registrationProgressText.getSceneObject().enabled = false;
    }
    this.stopBtn = requireRectangleButton(this.stopObj, "RobotUiView");
    this.stopLabel = requireText(this.stopObj, "RobotMenuStopLabel", "RobotUiView");
    this.toggleBtn = requireRoundButton(toggleObj, "RobotUiView");
    this.toggleVisual = toggleObj.getComponent(
      "Component.RenderMeshVisual",
    ) as RenderMeshVisual;
    this._debugInfoText = findText(this.markerRoot, "DebugInfoText");
    this.toggleBtn.onTriggerUp.add(() => this._callbacks?.onToggle());
    this.stopBtn.onTriggerUp.add(() => {
      this._callbacks?.onStop();
      setButtonToggleState(this.stopBtn, true);
    });
    bindHoverScale(this.stopBtn, this.stopObj);

    const goalModeObj = findChildRecursive(this.menuObj, "RobotMenuModeSwitch");
    if (goalModeObj) {
      goalModeObj.enabled = false;
    }

    this.stopLabel.size = FONT_BUTTON;
    configureButtonToggle(this.stopBtn, true);
    setButtonToggleState(this.stopBtn, true);
    this.stopObj.enabled = true;

    this.setMenuVisible(false);
    this.setOperatingMode(this._operatingMode);
    this._refreshDebugInfoText();
  }

  public bindCallbacks(callbacks: RobotUiCallbacks): void {
    this._callbacks = callbacks;
  }

  public setRegistrationPreviewActive(active: boolean): void {
    this._registrationPreviewActive = active;
  }

  public hide(): void {
    this.setMenuVisible(false);
  }

  public toggleVisible(): void {
    this.setMenuVisible(!this.isMenuVisible());
  }

  public isMenuVisible(): boolean {
    if (!this.menuObj.enabled) {
      return false;
    }
    const scale = this.menuObj.getTransform().getLocalScale();
    return scale.x > 0.001 || scale.y > 0.001 || scale.z > 0.001;
  }

  public setMenuVisible(visible: boolean): void {
    if (visible) {
      scaleIn(this.menuObj, 0.25);
    } else {
      scaleOut(this.menuObj, 0.2);
    }
    this._setMarkerHudVisible(!visible);
    this._setToggleVisualSaturation(1.0);
  }

  public setOperatingMode(mode: OperatingMode): void {
    this._operatingMode = mode;
    this._inRegistrationMode = mode === "registrationMode";
    if (this.manualModeMenu) {
      this.manualModeMenu.enabled = mode === "manual";
    }
    if (this.agentModeMenu) {
      this.agentModeMenu.enabled = mode === "agent";
    }
    if (this.registrationModeMenu) {
      this.registrationModeMenu.enabled = mode === "registrationMode";
    }
    if (mode !== "registrationMode") {
      this._setRegistrationProgressPercent(null);
    }
  }

  public syncFromState(state: AppStateData, uiLogEntry: UILogEntry | null = null): void {
    if (this._registrationPreviewActive) {
      return;
    }
    this._debugMode = state.debugMode;
    this._uiLogEntry = uiLogEntry;
    this.setOperatingMode(state.operatingMode);

    const title = state.robotRuntime.displayName;
    const activity = robotActivityPresentation(state);
    if (state.operatingMode !== "registrationMode") {
      this._applyTitle(title);
      this._applyActivity(activity.text, activity.color);
    }

    const stopAvailable = state.robotRuntime.capabilities.emergency_stop?.available ?? false;
    if (state.operatingMode !== "registrationMode") {
      this.stopObj.enabled = true;
    }
    applyCapabilityButtonPresentation(this.stopBtn, this.stopLabel, {
      available: stopAvailable,
      availableLabel: "Emergency Stop",
      unavailableLabel: "Emergency Stop\nUnavailable",
      availableStyle: SnapOS2Styles.Special,
      unavailableStyle: SnapOS2Styles.Special,
    });
    if (stopAvailable) {
      setButtonToggleState(this.stopBtn, true);
    }
    this.stopLabel.text = stopAvailable ? "Emergency Stop" : "Stop";

    this._syncAgentButtonVfx(state);

    this._refreshDebugInfoText();
  }

  private _syncAgentButtonVfx(state: AppStateData): void {
    const busyActive = agentBusyVfxActive(state);
    if (this.buttonVfxBusy) {
      this.buttonVfxBusy.enabled = busyActive;
    }
    if (this.buttonVfxIdle) {
      this.buttonVfxIdle.enabled = !busyActive;
    }
  }

  public applyAssistOverlay(overlay: RobotUiAssistOverlay): void {
    this._applyTitle(overlay.titleText);
    this._applyActivity(overlay.statusText, overlay.statusColor);
    this._setRegistrationProgressPercent(overlay.progressPercent);
    this.stopObj.enabled = overlay.showStop;
  }

  private _applyTitle(title: string): void {
    this.menuTitleText.text = title;
    if (this.hudTitleText) {
      this.hudTitleText.text = title;
    }
  }

  private _applyActivity(text: string, color: vec4): void {
    this.menuStateInfoText.text = text;
    this.menuStateInfoText.textFill.color = color;
    if (this.hudStateInfoText) {
      this.hudStateInfoText.text = text;
      this.hudStateInfoText.textFill.color = color;
    }
  }

  private _setRegistrationProgressPercent(target: number | null): void {
    if (!this.registrationProgressText) {
      return;
    }
    const textObj = this.registrationProgressText.getSceneObject();
    if (target === null) {
      this._progressAnimToken += 1;
      this._displayedProgressPercent = null;
      textObj.enabled = false;
      this.registrationProgressText.text = "";
      return;
    }

    textObj.enabled = true;
    if (
      this._displayedProgressPercent === null ||
      target < this._displayedProgressPercent
    ) {
      this._progressAnimToken += 1;
      this._displayedProgressPercent = target;
      this.registrationProgressText.text = formatRegistrationProgressText(target);
      return;
    }
    if (target === this._displayedProgressPercent) {
      return;
    }

    const start = this._displayedProgressPercent;
    const token = ++this._progressAnimToken;
    animate({
      duration: REGISTRATION_PROGRESS_ANIM_S,
      easing: "ease-out-quad",
      update: (t: number) => {
        if (token !== this._progressAnimToken) {
          return;
        }
        const value = start + (target - start) * t;
        this._displayedProgressPercent = value;
        this.registrationProgressText!.text = formatRegistrationProgressText(value);
      },
      ended: () => {
        if (token !== this._progressAnimToken) {
          return;
        }
        this._displayedProgressPercent = target;
        this.registrationProgressText!.text = formatRegistrationProgressText(target);
      },
    });
  }

  private _refreshDebugInfoText(): void {
    if (!this._debugInfoText) {
      return;
    }
    const presentation = this._debugMode ? this._uiLogEntry : null;
    const shouldShow = !!presentation && presentation.text.length > 0;
    this._debugInfoText.text = presentation?.text ?? "";
    this._debugInfoText.textFill.color = presentation?.color ?? COLOR_WHITE;
    this._debugInfoText.getSceneObject().enabled = shouldShow;
  }

  private _setMarkerHudVisible(visible: boolean): void {
    const markerTitleObj = this.hudTitleText?.getSceneObject?.() ?? null;
    if (markerTitleObj) {
      markerTitleObj.enabled = visible;
    }
    const stateInfoObj = this.hudStateInfoText?.getSceneObject?.() ?? null;
    if (stateInfoObj) {
      stateInfoObj.enabled = visible;
    }
  }

  private _setToggleVisualSaturation(value: number): void {
    const pass = (this.toggleVisual?.mainMaterial?.mainPass as any) ?? null;
    if (!pass) {
      return;
    }
    if ("Saturation" in pass) {
      pass.Saturation = value;
    }
  }
}
