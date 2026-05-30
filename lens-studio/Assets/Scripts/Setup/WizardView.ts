import { RectangleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton";
import { TextInputField } from "SpectaclesUIKit.lspkg/Scripts/Components/TextInputField/TextInputField";
import {
  createIconButton,
  createText,
  createTextInput,
  setButtonLabelRect,
  setButtonStyle,
  SnapOS2Styles,
} from "../UI/Shared/UIBuilders";
import {
  BUTTON_HEIGHT,
  BUTTON_WIDTH,
  COLOR_MUTED,
  COLOR_WHITE,
  CONTENT_PAD_X,
  FONT_BODY,
  FONT_BUTTON,
  FONT_HEADLINE,
  FOOTER_BUTTON_GAP,
  FOOTER_TOP_GAP,
  PANEL_WIDTH,
  SLOT_BODY,
  SLOT_FOOTER,
  SLOT_HEADLINE,
  SLOT_INPUT,
  SLOT_STATUS,
  SPACE_SM,
  Z_BUTTONS,
  Z_CONTENT,
} from "../UI/Shared/UIConstants";
import { WizardFooterState, WizardStep } from "./WizardTypes";

const ACCURACY_SLOT = 1.8;
const TITLE_BOTTOM_GAP = 1.45;
const STATUS_FONT = 38;
const CALIBRATE_STATUS_SHIFT_Y = SLOT_INPUT * 0.72;
const FOOTER_BUTTON_WIDTH = 9.6;
const FOOTER_THREE_BUTTON_GAP = 0.8;
const MANUAL_BUTTON_WIDTH = FOOTER_BUTTON_WIDTH;
const MANUAL_BUTTON_HEIGHT = BUTTON_HEIGHT;

export class WizardView {
  private readonly _titleText: Text;
  private readonly _descriptionText: Text;
  private readonly _accuracyText: Text;
  private readonly _statusText: Text;
  private readonly _detailStatusText: Text;
  private readonly _nextBtn: RectangleButton;
  private readonly _prevBtn: RectangleButton;
  private readonly _nextLabel: Text;
  private readonly _prevLabel: Text;
  private readonly _nextObj: SceneObject;
  private readonly _prevObj: SceneObject;
  private readonly _inputField: TextInputField;
  private readonly _inputObj: SceneObject;
  private readonly _manualBtn: RectangleButton;
  private readonly _manualLabel: Text;
  private readonly _manualObj: SceneObject;
  private readonly _statusBaseY: number;
  private readonly _detailStatusBaseY: number;

  constructor(private readonly _panel: SceneObject) {
    const innerWidth = PANEL_WIDTH - CONTENT_PAD_X * 2;
    const statusSlotHeight = SLOT_STATUS * 2.2;
    const totalContent =
      SLOT_HEADLINE +
      TITLE_BOTTOM_GAP +
      SLOT_BODY +
      SPACE_SM +
      ACCURACY_SLOT +
      SPACE_SM +
      SLOT_INPUT +
      SPACE_SM +
      statusSlotHeight +
      FOOTER_TOP_GAP +
      SLOT_FOOTER;
    let cursorY = totalContent / 2;

    cursorY -= SLOT_HEADLINE / 2;
    this._titleText = createText({
      parent: this._panel,
      name: "StepTitle",
      text: "",
      fontSize: FONT_HEADLINE,
      color: COLOR_WHITE,
      position: new vec3(0, cursorY, Z_CONTENT),
      horizontalAlignment: HorizontalAlignment.Center,
      worldSpaceRect: Rect.create(
        -innerWidth / 2,
        innerWidth / 2,
        -SLOT_HEADLINE / 2,
        SLOT_HEADLINE / 2,
      ),
    });

    cursorY -= SLOT_HEADLINE / 2 + TITLE_BOTTOM_GAP;

    cursorY -= SLOT_BODY / 2;
    this._descriptionText = createText({
      parent: this._panel,
      name: "StepDescription",
      text: "",
      fontSize: FONT_BODY,
      color: COLOR_MUTED,
      position: new vec3(0, cursorY, Z_CONTENT),
      horizontalAlignment: HorizontalAlignment.Center,
      worldSpaceRect: Rect.create(
        -innerWidth / 2,
        innerWidth / 2,
        -SLOT_BODY / 2,
        SLOT_BODY / 2,
      ),
    });

    cursorY -= SLOT_BODY / 2 + SPACE_SM;

    cursorY -= ACCURACY_SLOT / 2;
    this._accuracyText = createText({
      parent: this._panel,
      name: "StepAccuracy",
      text: "",
      fontSize: FONT_BODY,
      color: COLOR_MUTED,
      position: new vec3(0, cursorY, Z_CONTENT),
      horizontalAlignment: HorizontalAlignment.Center,
      worldSpaceRect: Rect.create(
        -innerWidth / 2,
        innerWidth / 2,
        -ACCURACY_SLOT / 2,
        ACCURACY_SLOT / 2,
      ),
    });

    cursorY -= ACCURACY_SLOT / 2 + SPACE_SM;

    cursorY -= SLOT_INPUT / 2;
    this._inputField = createTextInput(
      this._panel,
      "IpInputField",
      innerWidth - 2,
      SLOT_INPUT,
      new vec3(0, cursorY, Z_CONTENT),
    );
    this._inputObj = this._inputField.getSceneObject();

    cursorY -= SLOT_INPUT / 2 + SPACE_SM;

    cursorY -= statusSlotHeight / 2;
    this._statusText = createText({
      parent: this._panel,
      name: "StepStatus",
      text: "",
      fontSize: STATUS_FONT,
      color: COLOR_MUTED,
      position: new vec3(0, cursorY + SLOT_STATUS / 2, Z_CONTENT),
      horizontalAlignment: HorizontalAlignment.Center,
      worldSpaceRect: Rect.create(
        -innerWidth / 2,
        innerWidth / 2,
        -SLOT_STATUS / 2,
        SLOT_STATUS / 2,
      ),
    });
    this._statusBaseY = cursorY + SLOT_STATUS / 2;

    this._detailStatusText = createText({
      parent: this._panel,
      name: "StepDetailStatus",
      text: "",
      fontSize: STATUS_FONT,
      color: COLOR_MUTED,
      position: new vec3(0, cursorY - SLOT_STATUS / 2, Z_CONTENT),
      horizontalAlignment: HorizontalAlignment.Center,
      worldSpaceRect: Rect.create(
        -innerWidth / 2,
        innerWidth / 2,
        -SLOT_STATUS / 2,
        SLOT_STATUS / 2,
      ),
    });
    this._detailStatusBaseY = cursorY - SLOT_STATUS / 2;

    cursorY -= statusSlotHeight / 2 + FOOTER_TOP_GAP;
    const btnY = cursorY - BUTTON_HEIGHT / 2;

    const manual = createIconButton(
      this._panel,
      "ManualAlignBtn",
      "Align manually",
      MANUAL_BUTTON_WIDTH,
      MANUAL_BUTTON_HEIGHT,
      new vec3(0, 0, Z_BUTTONS),
      SnapOS2Styles.Ghost,
    );
    this._manualBtn = manual.button;
    this._manualLabel = manual.labelText;
    this._manualObj = manual.sceneObject;
    this._manualLabel.size = FONT_BUTTON;
    setButtonLabelRect(
      this._manualLabel,
      MANUAL_BUTTON_WIDTH,
      MANUAL_BUTTON_HEIGHT,
      0.25,
    );

    const prev = createIconButton(
      this._panel,
      "PrevBtn",
      "Back",
      FOOTER_BUTTON_WIDTH,
      BUTTON_HEIGHT,
      new vec3(-BUTTON_WIDTH / 2 - FOOTER_BUTTON_GAP, btnY, Z_BUTTONS),
      SnapOS2Styles.Ghost,
    );
    this._prevBtn = prev.button;
    this._prevLabel = prev.labelText;
    this._prevObj = prev.sceneObject;

    const next = createIconButton(
      this._panel,
      "NextBtn",
      "Skip",
      FOOTER_BUTTON_WIDTH,
      BUTTON_HEIGHT,
      new vec3(BUTTON_WIDTH / 2 + FOOTER_BUTTON_GAP, btnY, Z_BUTTONS),
      SnapOS2Styles.PrimaryNeutral,
    );
    this._nextBtn = next.button;
    this._nextLabel = next.labelText;
    this._nextObj = next.sceneObject;
    setButtonLabelRect(this._prevLabel, FOOTER_BUTTON_WIDTH, BUTTON_HEIGHT, 0.25);
    setButtonLabelRect(this._nextLabel, FOOTER_BUTTON_WIDTH, BUTTON_HEIGHT, 0.25);
  }

  public bindHandlers(
    onNext: () => void,
    onPrevious: () => void,
    onToggleManual: () => void,
    onInputSubmit: () => void,
  ): void {
    this._nextBtn.onTriggerUp.add(onNext);
    this._prevBtn.onTriggerUp.add(onPrevious);
    this._manualBtn.onTriggerUp.add(onToggleManual);
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

  public setAccuracy(text: string, color: vec4 = COLOR_MUTED): void {
    this._accuracyText.text = text;
    this._accuracyText.textFill.color = color;
  }

  public applyStepLayout(step: WizardStep): void {
    const shiftY =
      step === WizardStep.Calibrate ? CALIBRATE_STATUS_SHIFT_Y : 0;
    this._statusText
      .getSceneObject()
      .getTransform()
      .setLocalPosition(new vec3(0, this._statusBaseY + shiftY, Z_CONTENT));
    this._detailStatusText
      .getSceneObject()
      .getTransform()
      .setLocalPosition(
        new vec3(0, this._detailStatusBaseY + shiftY, Z_CONTENT),
      );
  }

  public applyFooterState(
    step: WizardStep,
    state: WizardFooterState,
  ): void {
    setButtonStyle(this._nextBtn, state.nextStyle);
    this._nextBtn.inactive = state.nextInactive;
    this._nextLabel.text = state.nextLabel;

    const nextX = state.centerNext
      ? 0
      : FOOTER_BUTTON_WIDTH / 2 + FOOTER_BUTTON_GAP;
    this._nextObj.getTransform().setLocalPosition(
      new vec3(
        nextX,
        this._nextObj.getTransform().getLocalPosition().y,
        Z_BUTTONS,
      ),
    );
    this._nextBtn.size = new vec3(FOOTER_BUTTON_WIDTH, BUTTON_HEIGHT, 0.5);

    this._prevObj.enabled = state.showPrev;
    const prevX = state.widePrevOffset
      ? -(FOOTER_BUTTON_WIDTH + FOOTER_THREE_BUTTON_GAP)
      : -(FOOTER_BUTTON_WIDTH / 2 + FOOTER_BUTTON_GAP);
    this._prevObj.getTransform().setLocalPosition(
      new vec3(
        prevX,
        this._prevObj.getTransform().getLocalPosition().y,
        Z_BUTTONS,
      ),
    );
    this._prevBtn.size = new vec3(FOOTER_BUTTON_WIDTH, BUTTON_HEIGHT, 0.5);
    setButtonStyle(this._prevBtn, SnapOS2Styles.Ghost);

    this._manualObj.enabled = state.showManual;
    if (step === WizardStep.Calibrate) {
      this._manualObj.getTransform().setLocalPosition(
        new vec3(
          FOOTER_BUTTON_WIDTH + FOOTER_THREE_BUTTON_GAP,
          this._nextObj.getTransform().getLocalPosition().y,
          Z_BUTTONS,
        ),
      );
    }
    this._manualLabel.text = state.manualLabel;
    setButtonLabelRect(
      this._manualLabel,
      MANUAL_BUTTON_WIDTH,
      MANUAL_BUTTON_HEIGHT,
      0.25,
    );
  }
}
