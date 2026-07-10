import { TextInputField } from "SpectaclesUIKit.lspkg/Scripts/Components/TextInputField/TextInputField";
import {
  RegistrationPhase,
  RegistrationStatusMessage,
} from "../../ARBridge/Network/Protocol";
import { AppStateStore } from "../AppState";
import { LidarDisplayMode, OperatingMode } from "../AppState";
import { RobotPresenter } from "../Robot/RobotPresenter";
import {
  ButtonBinding,
  COLOR_ERROR,
  COLOR_MUTED,
  COLOR_SUCCESS,
  COLOR_WHITE,
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
} from "../UI/UIKit";
import {
  buildAlignmentProgressPercent,
  buildAlignmentTitle,
  isRegistrationPreviewPhase,
  RegistrationViewState,
  WizardFooterState,
  WizardStep,
} from "./RegistrationFlow";

// ================================================================
/** Binds and updates the registration wizard panel UI (title, IP input, registration status, footer). */
// ================================================================

export class RegistrationWizardView {
  private readonly _titleText: Text;
  private readonly _descriptionText: Text;
  private readonly _statusText: Text;
  private readonly _next: ButtonBinding;
  private readonly _prev: ButtonBinding;
  private readonly _manual: ButtonBinding;
  private readonly _inputField: TextInputField;
  private readonly _inputObj: SceneObject;
  private readonly _statusObj: SceneObject;
  private readonly _statusBaseLocalX: number;
  private readonly _statusBaseLocalZ: number;
  private readonly _descriptionObj: SceneObject;
  private readonly _descriptionBaseLocalX: number;
  private readonly _descriptionBaseLocalZ: number;

  private static readonly STATUS_Y_CALIBRATE = 0;
  private static readonly STATUS_Y_DEFAULT = -2;
  private static readonly DESCRIPTION_Y_START = 1;
  private static readonly DESCRIPTION_Y_DEFAULT = 3;

  constructor(private readonly _panel: SceneObject) {
    const titleText = findText(_panel, "StepTitle");
    const descriptionText = findText(_panel, "StepDescription");
    const statusText = findText(_panel, "StepStatus");
    const next = findButtonBinding(_panel, "NextBtn", "NextBtnLabel");
    const prev = findButtonBinding(_panel, "PrevBtn", "PrevBtnLabel");
    const manual = findButtonBinding(_panel, "ManualAlignBtn", "ManualAlignBtnLabel");

    if (
      !titleText ||
      !descriptionText ||
      !statusText ||
      !next ||
      !prev ||
      !manual
    ) {
      throw new Error("RegistrationWizardView: scene hierarchy incomplete");
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
  }

  public get panel(): SceneObject {
    return this._panel;
  }

  public get inputField(): TextInputField {
    return this._inputField;
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

  public applyStepLayout(step: WizardStep): void {
    const statusY =
      step === WizardStep.Register
        ? RegistrationWizardView.STATUS_Y_CALIBRATE
        : RegistrationWizardView.STATUS_Y_DEFAULT;
    this._statusObj.getTransform().setLocalPosition(
      new vec3(this._statusBaseLocalX, statusY, this._statusBaseLocalZ),
    );

    const descriptionY =
      step === WizardStep.Start
        ? RegistrationWizardView.DESCRIPTION_Y_START
        : RegistrationWizardView.DESCRIPTION_Y_DEFAULT;
    this._descriptionObj.getTransform().setLocalPosition(
      new vec3(this._descriptionBaseLocalX, descriptionY, this._descriptionBaseLocalZ),
    );
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

export interface RegistrationPreviewPresentation {
  titleText: string;
  statusText: string;
  statusColor: vec4;
  progressPercent: number | null;
}

export function buildRegistrationPreviewPresentation(
  state: RegistrationViewState,
): RegistrationPreviewPresentation {
  return {
    titleText: buildAlignmentTitle(state),
    statusText: state.tagVisible
      ? "✅ Tag detected - move around"
      : "❌ Tag not visible",
    statusColor: state.tagVisible ? COLOR_SUCCESS : COLOR_ERROR,
    progressPercent: buildAlignmentProgressPercent(state),
  };
}

/** Registration assist preview (robot marker overlay during AprilTag scanning). */
export class RegistrationPreviewPresenter {
  private _active = false;

  constructor(
    private readonly appState: AppStateStore,
    private readonly robotPresenter: RobotPresenter,
  ) {}
  private _tagVisible = false;
  private _message = "";
  private _progress: number | undefined = undefined;
  private _phase: RegistrationPhase = "scanning";
  private _priorRuntimeMode: OperatingMode = "manual";
  private _priorLidarMode: LidarDisplayMode = "off";

  public begin(): void {
    this._priorRuntimeMode = this.appState.snapshot.operatingMode !== "registration"
      ? this.appState.snapshot.operatingMode
      : "manual";
    this._priorLidarMode = this.appState.snapshot.lidarMode;
    this.appState.update({ operatingMode: "registration", lidarMode: "off" });

    this._active = true;
    this._tagVisible = false;
    this._message = "";
    this._progress = undefined;
    this._phase = "scanning";
    const ui = this.robotPresenter?.robotMarker?.ui;
    ui?.setRegistrationPreviewActive(true);
    this.robotPresenter?.robotMarker?.setVisible(false);
    ui?.setMenuVisible(false);
  }

  public updateFromRegistrationStatus(msg: RegistrationStatusMessage): void {
    if (!this._active) {
      return;
    }
    this._tagVisible = msg.tag_visible ?? this._tagVisible;
    this._message = msg.message || this._message;
    if (typeof msg.progress === "number") {
      this._progress = msg.progress;
    }
    this._phase = msg.phase;
    const previewPose = msg.preview_pose ?? null;
    const previewStageActive = isRegistrationPreviewPhase(msg.phase);
    const showMarker = previewStageActive && !!previewPose;
    const ui = this.robotPresenter?.robotMarker?.ui;
    const wasMenuVisible = ui?.isMenuVisible() ?? false;
    const marker = this.robotPresenter?.robotMarker;

    if (showMarker && previewPose) {
      const pos = new vec3(
        previewPose.position[0] * 100,
        previewPose.position[1] * 100,
        previewPose.position[2] * 100,
      );
      const rot = new quat(
        previewPose.orientation[3],
        previewPose.orientation[0],
        previewPose.orientation[1],
        previewPose.orientation[2],
      );
      marker?.setVisible(true);
      marker?.applyRuntimeLensPose(pos, rot);
      if (!wasMenuVisible) {
        ui?.setMenuVisible(true);
      }
    } else {
      marker?.setVisible(false);
    }

    if (previewStageActive) {
      const presentation = buildRegistrationPreviewPresentation({
        mode: "auto",
        phase: this._phase,
        message: this._message,
        tagVisible: this._tagVisible,
        progress: this._progress,
      });
      ui?.applyAssistOverlay({
        titleText: presentation.titleText,
        statusText: presentation.statusText,
        statusColor: presentation.statusColor,
        progressPercent: presentation.progressPercent,
        showStop: false,
      });
    }
  }

  public setComplete(): void {
    if (!this._active) {
      return;
    }
    const GREEN = new vec4(0.2, 0.8, 0.2, 1);
    this.robotPresenter?.robotMarker?.ui?.applyAssistOverlay({
      titleText: "Registration complete",
      statusText: "Registration complete",
      statusColor: GREEN,
      progressPercent: 100,
      showStop: false,
    });
  }

  public end(): void {
    if (!this._active) {
      return;
    }
    this._active = false;
    this.robotPresenter?.robotMarker?.setVisible(false);
    const ui = this.robotPresenter?.robotMarker?.ui;
    ui?.setRegistrationPreviewActive(false);
    ui?.applyAssistOverlay({
      titleText: "",
      statusText: "",
      statusColor: COLOR_SUCCESS,
      progressPercent: null,
      showStop: false,
    });
    ui?.setMenuVisible(false);

    const prior = this._priorRuntimeMode;
    this.appState.update({ operatingMode: prior, lidarMode: this._priorLidarMode });
  }

  public endIfActive(): void {
    if (this._active) {
      this.end();
    }
  }

  public get isActive(): boolean {
    return this._active;
  }
}
