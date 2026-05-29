import { RectangleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton";
import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { scaleIn, scaleOut } from "./Shared/UIAnimations";
import { setButtonStyle, SnapOS2Styles } from "./Shared/UIBuilders";
import {
  COLOR_ERROR,
  COLOR_MUTED,
  COLOR_SUCCESS,
  COLOR_WARN,
  COLOR_WHITE,
  FONT_BODY,
  FONT_CAPTION,
  FONT_BUTTON,
} from "./Shared/UIConstants";

export class RobotMenuView {
  public onToggleRequested: (() => void) | null = null;
  public onStopRequested: (() => void) | null = null;
  public onConfirmRequested: (() => void) | null = null;

  private readonly root: SceneObject;
  private readonly toggleObj: SceneObject;
  private readonly toggleInteractable: Interactable | null;
  private readonly toggleVisual: RenderMeshVisual | null;
  private readonly menuObj: SceneObject;
  private readonly titleText: Text;
  private readonly statusText: Text;
  private readonly stopLabel: Text;
  private readonly confirmLabel: Text;
  private readonly stopObj: SceneObject;
  private readonly confirmObj: SceneObject;
  private readonly stopBtn: RectangleButton;
  private readonly confirmBtn: RectangleButton;

  constructor(parent: SceneObject) {
    this.root = parent;
    this.toggleObj = this._requireChild(this.root, "RobotToggleButton");
    this.menuObj = this._requireChild(this.root, "RobotUIRoot");
    this.titleText = this._requireText(this.menuObj, "RobotMenuTitle");
    this.statusText = this._requireText(this.menuObj, "RobotMenuStatus");
    this.stopObj = this._requireChild(this.menuObj, "RobotMenuStop");
    this.confirmObj = this._requireChild(this.menuObj, "RobotMenuConfirm");
    this.stopBtn = this._requireButton(this.stopObj);
    this.confirmBtn = this._requireButton(this.confirmObj);
    this.stopLabel = this._requireText(this.stopObj, "RobotMenuStopLabel");
    this.confirmLabel = this._requireText(this.confirmObj, "RobotMenuConfirmLabel");
    this.toggleVisual = this.toggleObj.getComponent(
      "Component.RenderMeshVisual",
    ) as RenderMeshVisual;

    let interactable = this.toggleObj.getComponent(
      Interactable.getTypeName(),
    ) as Interactable;
    if (!interactable) {
      interactable = this.toggleObj.createComponent(
        Interactable.getTypeName(),
      ) as Interactable;
    }
    const collider = this.toggleObj.getComponent(
      "Component.ColliderComponent",
    ) as ColliderComponent;
    if (interactable && collider) {
      interactable.colliders = [collider];
      (interactable as any).enableInstantDrag = false;
      (interactable as any).useFilteredPinch = false;
      (interactable as any).keepHoverOnTrigger = false;
    }
    this.toggleInteractable = interactable ?? null;

    const interactableAny = this.toggleInteractable as any;
    const toggleSignal =
      interactableAny?.onTriggerEnd ??
      interactableAny?.onTriggerUp ??
      interactableAny?.onTriggerStart ??
      null;
    if (toggleSignal && typeof toggleSignal.add === "function") {
      toggleSignal.add(() => this.onToggleRequested?.());
    }
    this.stopBtn.onTriggerUp.add(() => this.onStopRequested?.());
    this.confirmBtn.onTriggerUp.add(() => this.onConfirmRequested?.());

    this.titleText.size = FONT_BODY;
    this.titleText.textFill.color = COLOR_WHITE;
    this.statusText.size = FONT_CAPTION;
    this.stopLabel.size = FONT_BUTTON;
    this.confirmLabel.size = FONT_BUTTON;
    this.stopLabel.text = "Emergency stop";
    this.confirmLabel.text = "Confirm move";

    this.setMenuVisible(false);
    this.setPendingConfirmation(false);
  }

  public setRobotLabel(label: string): void {
    this.titleText.text = label;
  }

  public setStatus(text: string, approximate: boolean): void {
    this.statusText.text = approximate ? `${text} · approximate` : text;
    this.statusText.textFill.color = approximate ? COLOR_WARN : COLOR_SUCCESS;
  }

  public setMenuVisible(visible: boolean): void {
    if (visible) {
      scaleIn(this.menuObj, 0.25);
    } else {
      scaleOut(this.menuObj, 0.2);
    }
    this._setToggleVisualSaturation(1.0);
  }

  public setPendingConfirmation(pending: boolean): void {
    this.confirmObj.enabled = pending;
  }

  public setStopEmphasis(emergency: boolean): void {
    setButtonStyle(this.stopBtn, emergency ? SnapOS2Styles.Primary : SnapOS2Styles.Ghost);
    this.stopLabel.text = emergency ? "Emergency stop" : "Stop";
    this.stopLabel.textFill.color = emergency ? COLOR_ERROR : COLOR_WHITE;
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

  private _findChild(root: SceneObject, name: string): SceneObject | null {
    for (let i = 0; i < root.getChildrenCount(); i++) {
      const child = root.getChild(i);
      if (child.name === name) {
        return child;
      }
      const nested = this._findChild(child, name);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  private _requireChild(root: SceneObject, name: string): SceneObject {
    const child = this._findChild(root, name);
    if (!child) {
      throw new Error(`RobotMenuView: Missing scene object ${name}`);
    }
    return child;
  }

  private _requireText(root: SceneObject, name: string): Text {
    const obj = this._requireChild(root, name);
    const text = obj.getComponent("Component.Text") as Text;
    if (!text) {
      throw new Error(`RobotMenuView: Missing text component on ${name}`);
    }
    return text;
  }

  private _requireButton(root: SceneObject): RectangleButton {
    const button = root.getComponent(RectangleButton.getTypeName()) as RectangleButton;
    if (!button) {
      throw new Error(`RobotMenuView: Missing RectangleButton on ${root.name}`);
    }
    return button;
  }
}
