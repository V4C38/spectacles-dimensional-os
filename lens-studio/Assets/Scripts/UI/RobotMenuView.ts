import { RectangleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton";
import { RoundButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton";
import { OperatingMode } from "../AppState";
import { scaleIn, scaleOut } from "./Shared/UIAnimations";
import { COLOR_ERROR, COLOR_WHITE } from "./Shared/UIConstants";
import {
  bindToggleButton,
  configureButtonToggle,
  setButtonToggleState,
} from "./Shared/UIBuilders";
import {
  requireChild,
  findText,
  requireRectangleButton,
  requireRoundButton,
  requireText,
  findChildRecursive,
} from "./Shared/SceneLookup";

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
    this.stopBtn.onTriggerUp.add(() => this.onStopRequested?.());
    bindToggleButton(
      this.navigationPlacementBtn,
      (enabled) => this.onNavigationPlacementRequested?.(enabled),
      () => this._navigationPlacementEnabled,
    );
    configureButtonToggle(this.navigationPlacementBtn, false);

    this.manualModeMenu = findChildRecursive(this.menuObj, "ManualModeMenu");
    this.agentModeMenu = findChildRecursive(this.menuObj, "AgentModeMenu");

    this.setMenuVisible(false);
    this.setNavigationPlacementVisible(true);
    this.setOperatingMode(this._operatingMode);
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

  public setStopEmphasis(emergency: boolean): void {
    this.stopLabel.text = emergency ? "Emergency stop" : "Stop";
    this.stopLabel.textFill.color = emergency ? COLOR_ERROR : COLOR_WHITE;
  }

  public setOperatingMode(mode: OperatingMode): void {
    this._operatingMode = mode;
    if (this.manualModeMenu) {
      this.manualModeMenu.enabled = mode === "manual";
    }
    if (this.agentModeMenu) {
      this.agentModeMenu.enabled = mode === "agent";
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
