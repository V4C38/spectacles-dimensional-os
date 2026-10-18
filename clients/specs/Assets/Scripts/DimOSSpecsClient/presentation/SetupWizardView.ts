import { TextInputField } from "SpectaclesUIKit.lspkg/Scripts/Components/TextInputField/TextInputField";
import {
  ButtonBinding,
  COLOR_WHITE,
  createIconButton,
  createTextInput,
  findButtonBinding,
  findChildRecursive,
  findText,
  type IconButtonResult,
  FONT_WIZARD_INPUT,
  setButtonEnabled,
  setButtonStyle,
  SnapOS2Styles,
  SLOT_INPUT,
  SPACE_XS,
  UIFrameMetrics,
  Z_CONTENT,
} from "./UIKit";

export enum SetupWizardStep {
  StartRobot = 0,
  Connect = 1,
  Localization = 2,
}

export interface SetupWizardFooterState {
  footerNextLabel: string;
  footerNextEnabled: boolean;
  footerShowPrev: boolean;
}

interface SetupWizardPanelHandlers {
  onNext: () => void;
  onPrevious: () => void;
  onInputSubmit: () => void;
  onConnectionToggle: () => void;
}

const setupWizardPanelHandlers = new WeakMap<SceneObject, SetupWizardPanelHandlers>();
const setupWizardBoundPanels = new WeakSet<SceneObject>();

export class SetupWizardView {
  private readonly _titleText: Text;
  private readonly _descriptionText: Text;
  private readonly _statusText: Text;
  private readonly _next: ButtonBinding;
  private readonly _prev: ButtonBinding;
  private readonly _inputField: TextInputField;
  private readonly _inputObj: SceneObject;
  private readonly _connectionToggle: IconButtonResult;
  private readonly _statusObj: SceneObject;
  private readonly _statusBaseLocalX: number;
  private readonly _statusBaseLocalZ: number;
  private readonly _descriptionObj: SceneObject;
  private readonly _descriptionBaseLocalX: number;
  private readonly _descriptionBaseLocalZ: number;

  private static readonly STATUS_Y_LOCALIZATION = 0;
  private static readonly STATUS_Y_DEFAULT = -2;
  private static readonly DESCRIPTION_Y_START = 1;
  private static readonly DESCRIPTION_Y_DEFAULT = 3;

  constructor(private readonly _panel: SceneObject) {
    const titleText = findText(_panel, "StepTitle");
    const descriptionText = findText(_panel, "StepDescription");
    const statusText = findText(_panel, "StepStatus");
    const next = findButtonBinding(_panel, "NextBtn", "NextBtnLabel");
    const prev = findButtonBinding(_panel, "PrevBtn", "PrevBtnLabel");

    if (!titleText || !descriptionText || !statusText || !next || !prev) {
      throw new Error("SetupWizardView: scene hierarchy incomplete");
    }

    this._titleText = titleText;
    this._descriptionText = descriptionText;
    this._statusText = statusText;
    this._descriptionObj = descriptionText.getSceneObject();
    const descriptionLocal = this._descriptionObj.getTransform().getLocalPosition();
    this._descriptionBaseLocalX = descriptionLocal.x;
    this._descriptionBaseLocalZ = descriptionLocal.z;
    this._statusObj = statusText.getSceneObject();
    const statusLocal = this._statusObj.getTransform().getLocalPosition();
    this._statusBaseLocalX = statusLocal.x;
    this._statusBaseLocalZ = statusLocal.z;
    this._next = next;
    this._prev = prev;

    const inputParent = findChildRecursive(_panel, "IpInputFieldAnchor") ?? _panel;
    const rowGap = SPACE_XS;
    const inputHeight = SLOT_INPUT;
    const toggleWidth = 8;
    const rowWidth = UIFrameMetrics.fromSceneObject(_panel).innerWidth - SPACE_XS * 2;
    const inputWidth = rowWidth - toggleWidth - rowGap;
    const inputX = -(toggleWidth + rowGap) / 2;
    const toggleX = (inputWidth + rowGap) / 2;
    const existingInput = findChildRecursive(inputParent, "IpInputField");
    if (existingInput) {
      const field = existingInput.getComponent(TextInputField.getTypeName()) as TextInputField;
      if (!field) {
        throw new Error("SetupWizardView: IpInputField missing TextInputField component");
      }
      this._inputField = field;
    } else {
      this._inputField = createTextInput(
        inputParent,
        "IpInputField",
        inputWidth,
        inputHeight,
        new vec3(inputX, 0, Z_CONTENT),
        FONT_WIZARD_INPUT,
        HorizontalAlignment.Center,
      );
    }
    this._inputObj = this._inputField.getSceneObject();
    this._inputField.size = new vec3(inputWidth, inputHeight, 0.5);
    this._inputObj.getTransform().setLocalPosition(new vec3(inputX, 0, Z_CONTENT));
    this._connectionToggle = createIconButton(
      inputParent,
      "ConnectionMethod",
      "Mode: PIN",
      toggleWidth,
      inputHeight,
      new vec3(toggleX, 0, Z_CONTENT),
    );
    this.fitConnectionToggleLabel(toggleWidth, inputHeight);
    this._connectionToggle.sceneObject.enabled = false;
  }

  public bindHandlers(
    onNext: () => void,
    onPrevious: () => void,
    onInputSubmit: () => void,
    onConnectionToggle: () => void,
  ): void {
    setupWizardPanelHandlers.set(this._panel, {
      onNext,
      onPrevious,
      onInputSubmit,
      onConnectionToggle,
    });
    if (setupWizardBoundPanels.has(this._panel)) {
      return;
    }
    setupWizardBoundPanels.add(this._panel);
    this._next.button.onTriggerUp.add(() => setupWizardPanelHandlers.get(this._panel)?.onNext());
    this._prev.button.onTriggerUp.add(() => setupWizardPanelHandlers.get(this._panel)?.onPrevious());
    this._connectionToggle.button.onTriggerUp.add(() =>
      setupWizardPanelHandlers.get(this._panel)?.onConnectionToggle(),
    );
    this._inputField.onReturnKeyPressed.add(() => setupWizardPanelHandlers.get(this._panel)?.onInputSubmit());
    this._inputField.onKeyboardStateChanged.add((isOpen: boolean) => {
      if (!isOpen) {
        setupWizardPanelHandlers.get(this._panel)?.onInputSubmit();
      }
    });
  }

  public get panel(): SceneObject {
    return this._panel;
  }

  public setStepContent(title: string, description: string, descriptionColor?: vec4): void {
    this._titleText.text = title;
    this._descriptionText.text = description;
    this._descriptionText.textFill.color = descriptionColor ?? COLOR_WHITE;
  }

  public setInputEnabled(enabled: boolean): void {
    this._inputObj.enabled = enabled;
    this._inputField.enabled = enabled;
  }

  public setConnectionToggleVisible(visible: boolean): void {
    this._connectionToggle.sceneObject.enabled = visible;
  }

  public setConnectionToggleLabel(label: string): void {
    this._connectionToggle.labelText.text = label;
  }

  private fitConnectionToggleLabel(width: number, height: number): void {
    const label = this._connectionToggle.labelText;
    const innerWidth = width - 0.8;
    label.horizontalAlignment = HorizontalAlignment.Center;
    label.verticalAlignment = VerticalAlignment.Center;
    label.horizontalOverflow = HorizontalOverflow.Overflow;
    label.verticalOverflow = VerticalOverflow.Truncate;
    label.worldSpaceRect = Rect.create(-innerWidth / 2, innerWidth / 2, -height / 2, height / 2);
    label.getSceneObject().getTransform().setLocalPosition(new vec3(0, 0, 0.5));
    label.size = 20;
    const measuredWidth = label.getBoundingBox().getSize().x;
    if (measuredWidth > innerWidth) {
      label.size *= innerWidth / measuredWidth;
    }
  }

  public initializeInput(text: string, placeholder: string): void {
    this._inputField.initialize();
    this._inputField.placeholderText = placeholder;
    this._inputField.text = text;
  }

  public getInputText(): string {
    return this._inputField.text.trim();
  }

  public setStatus(text: string, color: vec4): void {
    this._statusText.text = text;
    this._statusText.textFill.color = color;
  }

  public applyStepLayout(step: SetupWizardStep): void {
    const statusY =
      step === SetupWizardStep.Localization
        ? SetupWizardView.STATUS_Y_LOCALIZATION
        : SetupWizardView.STATUS_Y_DEFAULT;
    this._statusObj.getTransform().setLocalPosition(
      new vec3(this._statusBaseLocalX, statusY, this._statusBaseLocalZ),
    );

    const descriptionY =
      step === SetupWizardStep.StartRobot
        ? SetupWizardView.DESCRIPTION_Y_START
        : SetupWizardView.DESCRIPTION_Y_DEFAULT;
    this._descriptionObj.getTransform().setLocalPosition(
      new vec3(this._descriptionBaseLocalX, descriptionY, this._descriptionBaseLocalZ),
    );
  }

  public applyFooterState(_step: SetupWizardStep, presentation: SetupWizardFooterState): void {
    setButtonStyle(
      this._next.button,
      presentation.footerNextLabel === "Complete"
        ? SnapOS2Styles.Primary
        : SnapOS2Styles.PrimaryNeutral,
    );
    setButtonEnabled(this._next.button, presentation.footerNextEnabled);
    if (this._next.labelText) {
      this._next.labelText.text = presentation.footerNextLabel;
    }
    this._prev.sceneObject.enabled = presentation.footerShowPrev;
  }
}
