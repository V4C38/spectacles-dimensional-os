import { RectangleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton";
import { RoundButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton";
import {
  AppStateListener,
  BridgeLinkState,
  DimosAppState,
  navigationOutcomePresentation,
  OperatingMode,
  robotMarkerSteadyStatePresentation,
} from "../Core/AppState";
import { UILogEntry, UILogger } from "../UI/UILogger";
import { getBridgeStatusPresentation } from "../UI/BridgeStatusPresentation";
import { scaleIn, scaleOut } from "../UI/kit/UIAnimations";
import {
  applyCapabilityButtonPresentation,
  bindHoverScale,
  bindToggleButton,
  COLOR_WHITE,
  configureButtonToggle,
  findChildRecursive,
  findText,
  FONT_BUTTON,
  requireChild,
  requireRectangleButton,
  requireRoundButton,
  requireText,
  setButtonToggleState,
  SnapOS2Styles,
} from "../UI/kit/UIKit";

// ================================================================
/** Scene-bound robot marker UI: floating menu, toggle, and marker HUD texts. */
// ================================================================

export class RobotMarkerView {
  public onToggleRequested: (() => void) | null = null;
  public onStopRequested: (() => void) | null = null;
  public onNavigationPlacementRequested: ((enabled: boolean) => void) | null = null;
  public onContinueRequested: (() => void) | null = null;

  private readonly markerRoot: SceneObject;
  private readonly toggleBtn: RoundButton;
  private readonly toggleVisual: RenderMeshVisual | null;
  private readonly menuObj: SceneObject;
  private readonly titleText: Text;
  private readonly markerTitleText: Text | null;
  private readonly statusText: Text;
  private readonly stopLabel: Text;
  private readonly navigationPlacementLabel: Text;
  private readonly stopObj: SceneObject;
  private readonly navigationPlacementObj: SceneObject;
  private readonly stopBtn: RectangleButton;
  private readonly navigationPlacementBtn: RectangleButton;
  private readonly manualModeMenu: SceneObject | null;
  private readonly agentModeMenu: SceneObject | null;
  private readonly setupWizardMenuObj: SceneObject | null;
  private readonly continueSetupObj: SceneObject | null;
  private readonly continueSetupBtn: RectangleButton | null;
  private readonly _stateInfoText: Text | null;
  private readonly _debugInfoText: Text | null;
  private _navigationPlacementEnabled = false;
  private _suppressNavigationPlacementCallback = false;
  private _operatingMode: OperatingMode = "manual";
  private _inSetupMode = false;
  private _debugMode = false;
  private _uiLogEntry: UILogEntry | null = null;
  private _unsubscribeAppState: (() => void) | null = null;
  private _unsubscribeUILog: (() => void) | null = null;

  constructor(markerRoot: SceneObject, menuRoot: SceneObject) {
    this.markerRoot = markerRoot;
    const toggleObj = requireChild(
      this.markerRoot,
      "RobotToggleButton",
      "RobotMarkerView",
    );
    this.menuObj = menuRoot;
    this.titleText = requireText(this.menuObj, "RobotMenuTitle", "RobotMarkerView");
    this.markerTitleText = findText(this.markerRoot, "Text_Title");
    this.statusText = requireText(this.menuObj, "RobotMenuStatus", "RobotMarkerView");
    this.stopObj = requireChild(this.menuObj, "RobotMenuStop", "RobotMarkerView");
    this.navigationPlacementObj = requireChild(
      this.menuObj,
      "RobotMenuEnableNavigation",
      "RobotMarkerView",
    );
    this.stopBtn = requireRectangleButton(this.stopObj, "RobotMarkerView");
    this.navigationPlacementBtn = requireRectangleButton(
      this.navigationPlacementObj,
      "RobotMarkerView",
    );
    this.stopLabel = requireText(this.stopObj, "RobotMenuStopLabel", "RobotMarkerView");
    this.navigationPlacementLabel = requireText(
      this.navigationPlacementObj,
      "RobotMenuEnableNavigationLabel",
      "RobotMarkerView",
    );
    this.toggleBtn = requireRoundButton(toggleObj, "RobotMarkerView");
    this.toggleVisual = toggleObj.getComponent(
      "Component.RenderMeshVisual",
    ) as RenderMeshVisual;
    this._stateInfoText = findText(this.markerRoot, "StateInfoText");
    this._debugInfoText = findText(this.markerRoot, "DebugInfoText");
    this.toggleBtn.onTriggerUp.add(() => this.onToggleRequested?.());
    this.stopBtn.onTriggerUp.add(() => {
      this.onStopRequested?.();
      setButtonToggleState(this.stopBtn, true);
    });
    bindHoverScale(this.stopBtn, this.stopObj);
    bindToggleButton(
      this.navigationPlacementBtn,
      (enabled) => {
        if (this._suppressNavigationPlacementCallback) {
          return;
        }
        this.onNavigationPlacementRequested?.(enabled);
      },
      () => this._navigationPlacementEnabled,
    );
    configureButtonToggle(this.navigationPlacementBtn, false);

    this.manualModeMenu = findChildRecursive(this.menuObj, "ManualModeMenu");
    this.agentModeMenu = findChildRecursive(this.menuObj, "AgentModeMenu");

    this.setupWizardMenuObj = findChildRecursive(this.menuObj, "SetupWizardMenu");
    this.continueSetupObj = this.setupWizardMenuObj
      ? findChildRecursive(this.setupWizardMenuObj, "ContinueSetupButton")
      : null;
    this.continueSetupBtn = this.continueSetupObj
      ? (this.continueSetupObj.getComponent("ScriptComponent") as any as RectangleButton | null)
      : null;
    if (this.continueSetupBtn) {
      this.continueSetupBtn.onTriggerUp.add(() => this.onContinueRequested?.());
    }

    this.stopLabel.size = FONT_BUTTON;
    configureButtonToggle(this.stopBtn, true);
    setButtonToggleState(this.stopBtn, true);

    this.setStopEmphasis(true);
    this.setMenuVisible(false);
    this.setNavigationPlacementVisible(true);
    this.setOperatingMode(this._operatingMode);
    this._refreshDebugInfoText();
  }

  public initialize(deps: {
    subscribeAppState: (listener: AppStateListener) => () => void;
    uiLogger: UILogger;
  }): void {
    this._unsubscribeAppState?.();
    this._unsubscribeAppState = deps.subscribeAppState((state) =>
      this._applyStateInfo(state),
    );
    this._unsubscribeUILog?.();
    this._unsubscribeUILog = deps.uiLogger.subscribe((entry) =>
      this._applyUILogEntry(entry),
    );
  }

  public dispose(): void {
    this._unsubscribeAppState?.();
    this._unsubscribeAppState = null;
    this._unsubscribeUILog?.();
    this._unsubscribeUILog = null;
  }

  public hide(): void {
    this.setMenuVisible(false);
  }

  public toggleVisible(): void {
    this.setMenuVisible(!this.isMenuVisible());
  }

  public applyBridgeLinkState(state: BridgeLinkState): void {
    if (this._inSetupMode) {
      return;
    }
    const presentation = getBridgeStatusPresentation(state);
    this.setStatus(presentation.text, presentation.color);
  }

  public setRobotLabel(label: string): void {
    this.titleText.text = label;
    if (this.markerTitleText) {
      this.markerTitleText.text = label;
    }
  }

  public setStatus(text: string, color: vec4): void {
    this.statusText.text = text;
    this.statusText.textFill.color = color;
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
    const markerTitleObj = this.markerTitleText?.getSceneObject?.() ?? null;
    if (markerTitleObj) {
      markerTitleObj.enabled = !visible;
    }
    this._setToggleVisualSaturation(1.0);
  }

  public setNavigationPlacementVisible(visible: boolean): void {
    this.navigationPlacementObj.enabled = visible;
  }

  public setNavigationPlacementToggle(enabled: boolean): void {
    if (this._navigationPlacementEnabled === enabled) {
      return;
    }
    this._navigationPlacementEnabled = enabled;
    this._suppressNavigationPlacementCallback = true;
    setButtonToggleState(this.navigationPlacementBtn, enabled);
    this._suppressNavigationPlacementCallback = false;
  }

  public setNavigationPlacementAvailability(available: boolean): void {
    applyCapabilityButtonPresentation(
      this.navigationPlacementBtn,
      this.navigationPlacementLabel,
      {
        available,
        availableLabel: "Enable Navigation",
        unavailableLabel: "Enable Navigation\nUnavailable",
      },
    );
  }

  public setStopEmphasis(emergency: boolean): void {
    this.stopLabel.text = emergency ? "Emergency Stop" : "Stop";
  }

  public setEmergencyStopAvailability(
    available: boolean,
    _reason: string | null = null,
  ): void {
    applyCapabilityButtonPresentation(this.stopBtn, this.stopLabel, {
      available,
      availableLabel: "Emergency Stop",
      unavailableLabel: "Emergency Stop\nUnavailable",
      availableStyle: SnapOS2Styles.Special,
      unavailableStyle: SnapOS2Styles.Special,
    });
    if (available) {
      setButtonToggleState(this.stopBtn, true);
    }
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
    if (mode === "manual") {
      this.hide();
    }
  }

  public setSetupWizardMenuVisible(visible: boolean): void {
    if (this.setupWizardMenuObj) {
      this.setupWizardMenuObj.enabled = visible;
    }
  }

  public setSetupTitle(text: string): void {
    this.titleText.text = text;
  }

  public setSetupStatus(text: string, color: vec4): void {
    this.statusText.text = text;
    this.statusText.textFill.color = color;
  }

  public setContinueVisible(visible: boolean): void {
    if (this.continueSetupObj) {
      this.continueSetupObj.enabled = visible;
    }
  }

  public setSetupStopVisible(visible: boolean): void {
    this.stopObj.enabled = visible;
  }

  private _applyStateInfo(state: DimosAppState): void {
    this._debugMode = state.debugMode;
    this._refreshStateInfoText(state);
    this._refreshDebugInfoText();
  }

  private _refreshStateInfoText(state: DimosAppState): void {
    if (!this._stateInfoText) {
      return;
    }
    const outcomePresentation = navigationOutcomePresentation(state.navigationOutcome);
    const presentation = outcomePresentation ?? robotMarkerSteadyStatePresentation(state);
    this._stateInfoText.text = presentation.text;
    this._stateInfoText.textFill.color = presentation.color;
  }

  private _applyUILogEntry(entry: UILogEntry | null): void {
    this._uiLogEntry = entry;
    this._refreshDebugInfoText();
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
