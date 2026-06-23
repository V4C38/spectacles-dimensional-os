import { RectangleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton";
import { RoundButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton";
import {
  DimosAppState,
  NAV_GOAL_MODE_LABELS,
  OperatingMode,
  robotActivityPresentation,
} from "../Core/AppState";
import { UILogEntry } from "../UI/UILogger";
import { scaleIn, scaleOut } from "../UI/kit/UIAnimations";
import {
  applyCapabilityButtonPresentation,
  bindHoverScale,
  COLOR_WHITE,
  configureButtonToggle,
  findChildRecursive,
  findText,
  FONT_BUTTON,
  requireChild,
  requireRectangleButton,
  requireRoundButton,
  requireText,
  setButtonEnabled,
  setButtonToggleState,
  SnapOS2Styles,
} from "../UI/kit/UIKit";

// ================================================================
/** Scene-bound robot UI: floating menu, toggle, and marker HUD texts. */
// ================================================================

export interface RobotUiAssistOverlay {
  titleText: string;
  statusText: string;
  statusColor: vec4;
  showWizardMenu: boolean;
  showContinue: boolean;
  continueInactive: boolean;
  showStop: boolean;
}

export interface RobotUiCallbacks {
  onToggle: () => void;
  onStop: () => void;
  onGoalModeCycle: () => void;
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
  private readonly goalModeLabel: Text;
  private readonly stopObj: SceneObject;
  private readonly goalModeObj: SceneObject;
  private readonly stopBtn: RectangleButton;
  private readonly goalModeBtn: RectangleButton;
  private readonly manualModeMenu: SceneObject | null;
  private readonly agentModeMenu: SceneObject | null;
  private readonly setupWizardMenuObj: SceneObject | null;
  private readonly continueSetupObj: SceneObject | null;
  private readonly continueSetupBtn: RectangleButton | null;
  private readonly _debugInfoText: Text | null;
  private _operatingMode: OperatingMode = "manual";
  private _inSetupMode = false;
  private _debugMode = false;
  private _uiLogEntry: UILogEntry | null = null;
  private _callbacks: RobotUiCallbacks | null = null;
  private _menuContinueHandler: (() => void) | null = null;
  private _registrationContinueHandler: (() => void) | null = null;
  private _registrationPreviewActive = false;

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
    this.goalModeObj = findChildRecursive(this.menuObj, "RobotMenuModeSwitch");
    if (!this.goalModeObj) {
      throw new Error("RobotUiView: Missing scene object RobotMenuModeSwitch");
    }
    this.stopBtn = requireRectangleButton(this.stopObj, "RobotUiView");
    this.goalModeBtn = requireRectangleButton(this.goalModeObj, "RobotUiView");
    this.stopLabel = requireText(this.stopObj, "RobotMenuStopLabel", "RobotUiView");
    this.goalModeLabel = requireText(
      this.goalModeObj,
      "RobotMenuEnableNavigationLabel",
      "RobotUiView",
    );
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
    this.goalModeBtn.onTriggerUp.add(() => this._callbacks?.onGoalModeCycle());

    this.setupWizardMenuObj = findChildRecursive(this.menuObj, "SetupWizardMenu");
    this.continueSetupObj = this.setupWizardMenuObj
      ? findChildRecursive(this.setupWizardMenuObj, "ContinueSetupButton")
      : null;
    this.continueSetupBtn = this.continueSetupObj
      ? requireRectangleButton(this.continueSetupObj, "RobotUiView")
      : null;
    if (this.continueSetupBtn) {
      this.continueSetupBtn.onTriggerUp.add(() => this._invokeContinueHandler());
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
    if (callbacks.onContinue !== undefined) {
      this._menuContinueHandler = callbacks.onContinue;
    }
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
    this._inSetupMode = mode === "setup";
    if (this.manualModeMenu) {
      this.manualModeMenu.enabled = mode === "manual";
    }
    if (this.agentModeMenu) {
      this.agentModeMenu.enabled = mode === "agent";
    }
    if (this.setupWizardMenuObj) {
      this.setupWizardMenuObj.enabled = mode === "setup";
    }
  }

  public setOnContinue(handler: (() => void) | null): void {
    this._registrationContinueHandler = handler;
  }

  public syncFromState(state: DimosAppState, uiLogEntry: UILogEntry | null = null): void {
    if (this._registrationPreviewActive) {
      return;
    }
    this._debugMode = state.debugMode;
    this._uiLogEntry = uiLogEntry;
    this.setOperatingMode(state.operatingMode);

    const title = state.robotRuntime.displayName;
    const activity = robotActivityPresentation(state);
    if (state.operatingMode !== "setup") {
      this._applyTitle(title);
      this._applyActivity(activity.text, activity.color);
    }

    if (state.operatingMode !== "setup") {
      const navAvailable = state.robotRuntime.capabilities.nav?.available ?? false;
      this._syncGoalModeButton(state.navigationGoalMode, navAvailable);
    }

    const stopAvailable = state.robotRuntime.capabilities.emergency_stop?.available ?? false;
    if (state.operatingMode !== "setup") {
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

    this._refreshDebugInfoText();
  }

  public applyAssistOverlay(overlay: RobotUiAssistOverlay): void {
    this.menuTitleText.text = overlay.titleText;
    this.menuStateInfoText.text = overlay.statusText;
    this.menuStateInfoText.textFill.color = overlay.statusColor;
    if (this.setupWizardMenuObj) {
      this.setupWizardMenuObj.enabled = overlay.showWizardMenu;
    }
    this.menuTitleText.getSceneObject().enabled = !overlay.showWizardMenu;
    this.menuStateInfoText.getSceneObject().enabled = !overlay.showWizardMenu;
    if (this.continueSetupObj) {
      this.continueSetupObj.enabled =
        overlay.showContinue && !overlay.continueInactive;
    }
    this.stopObj.enabled = overlay.showStop;
  }

  private _invokeContinueHandler(): void {
    (this._registrationContinueHandler ?? this._menuContinueHandler)?.();
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

  private _syncGoalModeButton(
    mode: DimosAppState["navigationGoalMode"],
    available: boolean,
  ): void {
    if (!this.goalModeBtn || !this.goalModeLabel) {
      return;
    }
    this.goalModeLabel.text = available
      ? NAV_GOAL_MODE_LABELS[mode]
      : "Navigation\nUnavailable";
    setButtonEnabled(this.goalModeBtn, available);
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
