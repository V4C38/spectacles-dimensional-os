import { TextInputField } from "SpectaclesUIKit.lspkg/Scripts/Components/TextInputField/TextInputField";
import {
  ButtonBinding,
  COLOR_MUTED,
  CONTENT_PAD_X,
  createTextInput,
  FALLBACK_FRAME_INNER_WIDTH,
  findButtonBinding,
  findChildRecursive,
  findText,
  FONT_WIZARD_INPUT,
  setButtonStyle,
  SLOT_INPUT,
  Z_CONTENT,
} from "../UI/kit/UIKit";
import { WizardFooterState, WizardStep } from "./CalibrationFlow";

// ================================================================
/** Binds and updates the setup wizard panel UI (title, IP input, calibration status, footer). */
// ================================================================

export class WizardView {
  private readonly _titleText: Text;
  private readonly _descriptionText: Text;
  private readonly _statusText: Text;
  private readonly _detailStatusText: Text;
  private readonly _next: ButtonBinding;
  private readonly _prev: ButtonBinding;
  private readonly _manual: ButtonBinding;
  private readonly _inputField: TextInputField;
  private readonly _inputObj: SceneObject;

  constructor(private readonly _panel: SceneObject) {
    const titleText = findText(_panel, "StepTitle");
    const descriptionText = findText(_panel, "StepDescription");
    const statusText = findText(_panel, "StepStatus");
    const detailStatusText = findText(_panel, "StepDetailStatus");
    const next = findButtonBinding(_panel, "NextBtn", "NextBtnLabel");
    const prev = findButtonBinding(_panel, "PrevBtn", "PrevBtnLabel");
    const manual = findButtonBinding(_panel, "ManualAlignBtn", "ManualAlignBtnLabel");

    if (
      !titleText ||
      !descriptionText ||
      !statusText ||
      !detailStatusText ||
      !next ||
      !prev ||
      !manual
    ) {
      throw new Error("WizardView: scene hierarchy incomplete");
    }

    this._titleText = titleText;
    this._descriptionText = descriptionText;
    this._statusText = statusText;
    this._detailStatusText = detailStatusText;
    this._next = next;
    this._prev = prev;
    this._manual = manual;

    const inputParent = findChildRecursive(_panel, "IpInputFieldAnchor") ?? _panel;
    const inputWidth = FALLBACK_FRAME_INNER_WIDTH - CONTENT_PAD_X * 2 - 2;
    this._inputField = createTextInput(
      inputParent,
      "IpInputField",
      inputWidth,
      SLOT_INPUT,
      new vec3(0, 0, Z_CONTENT),
      FONT_WIZARD_INPUT,
      HorizontalAlignment.Center,
    );
    this._inputObj = this._inputField.getSceneObject();
  }

  public bindHandlers(
    onNext: () => void,
    onPrevious: () => void,
    onToggleManual: () => void,
    onInputSubmit: () => void,
  ): void {
    this._next.button.onTriggerUp.add(onNext);
    this._prev.button.onTriggerUp.add(onPrevious);
    this._manual.button.onTriggerUp.add(onToggleManual);
    this._inputField.onReturnKeyPressed.add(onInputSubmit);
    this._inputField.onKeyboardStateChanged.add((open: boolean) => {
      if (!open) {
        onInputSubmit();
      }
    });
  }

  public get panel(): SceneObject {
    return this._panel;
  }

  public get inputField(): TextInputField {
    return this._inputField;
  }

  public setStepContent(title: string, description: string): void {
    this._titleText.text = title;
    this._descriptionText.text = description;
  }

  public setInputEnabled(enabled: boolean): void {
    this._inputObj.enabled = enabled;
    this._inputField.enabled = enabled;
  }

  public initializeInput(text: string): void {
    this._inputField.initialize();
    this._inputField.text = text;
  }

  public getInputText(): string {
    return this._inputField.text.trim();
  }

  public setInputText(text: string): void {
    this._inputField.text = text;
  }

  public setStatus(text: string, color: vec4): void {
    this._statusText.text = text;
    this._statusText.textFill.color = color;
  }

  public setDetailStatus(text: string, color: vec4 = COLOR_MUTED): void {
    this._detailStatusText.text = text;
    this._detailStatusText.textFill.color = color;
  }

  public clearDetailStatus(): void {
    this.setDetailStatus("");
  }

  public applyStepLayout(_step: WizardStep): void {
    // Layout is authored in the scene; no runtime repositioning.
  }

  public applyFooterState(_step: WizardStep, state: WizardFooterState): void {
    setButtonStyle(this._next.button, state.nextStyle);
    this._next.button.inactive = state.nextInactive;
    if (this._next.labelText) {
      this._next.labelText.text = state.nextLabel;
    }

    this._prev.sceneObject.enabled = state.showPrev;

    this._manual.sceneObject.enabled = state.showManual;
    if (this._manual.labelText) {
      this._manual.labelText.text = state.manualLabel;
    }
    setButtonStyle(this._manual.button, state.manualStyle);
  }
}
