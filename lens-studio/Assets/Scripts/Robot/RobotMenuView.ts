import { RectangleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton";
import { RoundButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton";
import { BridgeLinkState, OperatingMode } from "../Core/AppState";
import { getBridgeStatusPresentation } from "../UI/BridgeStatusPresentation";
import { scaleIn, scaleOut } from "../UI/kit/UIAnimations";
import {
  applyCapabilityButtonPresentation,
  bindHoverScale,
  bindToggleButton,
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
/** Scene-bound robot menu UI for toggle, stop, navigation placement, and mode panels. */
// ================================================================

export class RobotMenuView {
  public onToggleRequested: (() => void) | null = null;
  public onStopRequested: (() => void) | null = null;
  public onNavigationPlacementRequested: ((enabled: boolean) => void) | null = null;

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
  private _navigationPlacementEnabled = false;
  private _operatingMode: OperatingMode = "manual";

  constructor(markerRoot: SceneObject, menuRoot: SceneObject) {
    this.markerRoot = markerRoot;
    const toggleObj = requireChild(
      this.markerRoot,
      "RobotToggleButton",
      "RobotMenuView",
    );
    this.menuObj = menuRoot;
    this.titleText = requireText(this.menuObj, "RobotMenuTitle", "RobotMenuView");
    this.markerTitleText = findText(this.markerRoot, "Text_Title");
    this.statusText = requireText(this.menuObj, "RobotMenuStatus", "RobotMenuView");
    this.stopObj = requireChild(this.menuObj, "RobotMenuStop", "RobotMenuView");
    this.navigationPlacementObj = requireChild(
      this.menuObj,
      "RobotMenuEnableNavigation",
      "RobotMenuView",
    );
    this.stopBtn = requireRectangleButton(this.stopObj, "RobotMenuView");
    this.navigationPlacementBtn = requireRectangleButton(
      this.navigationPlacementObj,
      "RobotMenuView",
    );
    this.stopLabel = requireText(this.stopObj, "RobotMenuStopLabel", "RobotMenuView");
    this.navigationPlacementLabel = requireText(
      this.navigationPlacementObj,
      "RobotMenuEnableNavigationLabel",
      "RobotMenuView",
    );
    this.toggleBtn = requireRoundButton(toggleObj, "RobotMenuView");
    this.toggleVisual = toggleObj.getComponent(
      "Component.RenderMeshVisual",
    ) as RenderMeshVisual;
    this.toggleBtn.onTriggerUp.add(() => this.onToggleRequested?.());
    this.stopBtn.onTriggerUp.add(() => {
      this.onStopRequested?.();
      setButtonToggleState(this.stopBtn, true);
    });
    bindHoverScale(this.stopBtn, this.stopObj);
    bindToggleButton(
      this.navigationPlacementBtn,
      (enabled) => this.onNavigationPlacementRequested?.(enabled),
      () => this._navigationPlacementEnabled,
    );
    configureButtonToggle(this.navigationPlacementBtn, false);

    this.manualModeMenu = findChildRecursive(this.menuObj, "ManualModeMenu");
    this.agentModeMenu = findChildRecursive(this.menuObj, "AgentModeMenu");

    this.stopLabel.size = FONT_BUTTON;
    configureButtonToggle(this.stopBtn, true);
    setButtonToggleState(this.stopBtn, true);

    this.setStopEmphasis(true);
    this.setMenuVisible(false);
    this.setNavigationPlacementVisible(true);
    this.setOperatingMode(this._operatingMode);
  }

  public hide(): void {
    this.setMenuVisible(false);
  }

  public toggleVisible(): void {
    this.setMenuVisible(!this.isMenuVisible());
  }

  public applyBridgeLinkState(state: BridgeLinkState): void {
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
    this._navigationPlacementEnabled = enabled;
    setButtonToggleState(this.navigationPlacementBtn, enabled);
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
    if (this.manualModeMenu) {
      this.manualModeMenu.enabled = mode === "manual";
    }
    if (this.agentModeMenu) {
      this.agentModeMenu.enabled = mode === "agent";
    }
    if (mode === "manual") {
      this.hide();
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
