require("LensStudio:TextInputModule");

import { RectangleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton";
import { TextInputField } from "SpectaclesUIKit.lspkg/Scripts/Components/TextInputField/TextInputField";
import { AlignmentController } from "./Alignment/AlignmentController";
import { BridgeClient } from "./Network/BridgeClient";
import { DimosManager } from "./DimosManager";
import { UIManager } from "./UIManager";
import { AlignStatusMessage, formatBridgeStatus } from "./Network/Protocol";
import { scaleIn, scaleOut } from "./UI/Shared/UIAnimations";
import { createIconButton, createText, createTextInput, setButtonStyle, SnapOS2Styles } from "./UI/Shared/UIBuilders";
import {
  BUTTON_HEIGHT,
  BUTTON_WIDTH,
  COLOR_ERROR,
  COLOR_MUTED,
  COLOR_SUCCESS,
  COLOR_WARN,
  COLOR_WHITE,
  CONTENT_PAD_X,
  FONT_BODY,
  FONT_BUTTON,
  FONT_CAPTION,
  FONT_HEADLINE,
  FOOTER_BUTTON_GAP,
  FOOTER_TOP_GAP,
  PANEL_WIDTH,
  SLOT_BODY,
  SLOT_FOOTER,
  SLOT_HEADLINE,
  SLOT_INPUT,
  SLOT_STATUS,
  SPACE_MD,
  SPACE_SM,
  Z_BUTTONS,
  Z_CONTENT,
} from "./UI/Shared/UIConstants";

const STEP_START = 0;
const STEP_CONNECT = 1;
const STEP_CALIBRATE = 2;
const LAST_STEP = STEP_CALIBRATE;
const NAV_DEBOUNCE_S = 0.35;
const ACCURACY_SLOT = 1.8;
const TITLE_BOTTOM_GAP = 1.45;
const BODY_FONT = 48;
const STATUS_FONT = 38;
const CALIBRATE_STATUS_SHIFT_Y = SLOT_INPUT * 0.72;
const FOOTER_BUTTON_WIDTH = 9.6;
const FOOTER_THREE_BUTTON_GAP = 0.8;
const MANUAL_BUTTON_WIDTH = FOOTER_BUTTON_WIDTH;
const MANUAL_BUTTON_HEIGHT = BUTTON_HEIGHT;
const MANUAL_BUTTON_FONT = FONT_BUTTON;

type AlignmentMode = "auto" | "manual";

interface CalibrationViewState {
  mode: AlignmentMode;
  spectaclesTracking: boolean;
  robotTracking: boolean;
  currentQuality: number | null;
  bestQuality: number | null;
  hasCandidate: boolean;
  candidateCount: number;
  pendingCommit: boolean;
  statusMessage: string;
  statusColor: vec4;
}

@component
export class SetupWizard extends BaseScriptComponent {
  @input
  defaultBridgeIp: string = "192.168.1.166";

  @input
  dimosManager: DimosManager;

  @input
  uiManager: UIManager;

  @input
  alignmentController: AlignmentController;

  private _currentStep = 0;
  private _stepOperationId = 0;
  private _connected = false;
  private _aligned = false;
  private _connectCompleted = false;
  private _calibrationCompleted = false;
  private _setupFinished = false;
  private _lastNavigationTime = -1;
  private _alignmentHandlersBound = false;
  private _bridgeHandlersBound = false;
  private _calibrationState: CalibrationViewState = this._createCalibrationViewState();

  private _titleText: Text;
  private _descriptionText: Text;
  private _accuracyText: Text;
  private _statusText: Text;
  private _detailStatusText: Text;
  private _nextBtn: RectangleButton;
  private _prevBtn: RectangleButton;
  private _nextLabel: Text;
  private _prevLabel: Text;
  private _nextObj: SceneObject;
  private _prevObj: SceneObject;
  private _inputField: TextInputField;
  private _inputObj: SceneObject;
  private _manualBtn: RectangleButton;
  private _manualLabel: Text;
  private _manualObj: SceneObject;
  private _statusBaseY = 0;
  private _detailStatusBaseY = 0;

  private readonly _steps = [
    "Start Robot & DimOS",
    "Connect DimOS WebSocket",
    "Calibrate coordinates",
  ];

  private readonly _descriptions = [
    "Power up your robot (Go2 / G1) and wait for it to boot.\nOn your PC, run /dimos-ar/start.sh to launch DimOS.",
    "Enter your PC's local IP to connect.\nKeep the robot, your PC, and Spectacles on the same local network.",
    "Open the DimOS QR code on your phone.\nHold the marker where the robot camera and Spectacles can both see it.",
  ];

  onAwake() {
    this._buildInnerUI();
    this.createEvent("OnStartEvent").bind(() => {
      if (this._nextBtn) {
        this._nextBtn.onTriggerUp.add(() => this._onNext());
      }
      if (this._prevBtn) {
        this._prevBtn.onTriggerUp.add(() => this._onPrevious());
      }
      if (this._manualBtn) {
        this._manualBtn.onTriggerUp.add(() => this._toggleManualAlignment());
      }
      if (this._inputField && this.dimosManager) {
        this._inputField.onReturnKeyPressed.add(() => this._startAutoconnect());
        this._inputField.onKeyboardStateChanged.add((open: boolean) => {
          if (!open) {
            this._startAutoconnect();
          }
        });
      }
      this._bindAlignmentHandlers();
      this._bindBridgeHandlers();
      this.startSetupWizard();
    });
  }

  public startSetupWizard(): void {
    this._logSetup("start");
    this._connected = false;
    this._aligned = false;
    this._connectCompleted = false;
    this._calibrationCompleted = false;
    this._setupFinished = false;
    this._lastNavigationTime = -1;
    this._calibrationState = this._createCalibrationViewState();
    if (this.alignmentController) {
      this.alignmentController.setCalibrationGizmoEnabled(false);
      this.alignmentController.stop();
    }
    if (this.dimosManager) {
      this.dimosManager.disconnect();
      this.dimosManager.setIsActive(false);
      this.dimosManager.hideRobotMarkerPreview();
    }
    if (this.uiManager) {
      this.uiManager.setUIState(0);
    }
    const panel = this._panelRoot();
    if (panel) {
      panel.enabled = true;
      scaleIn(panel, 0.5);
    }
    this.setStep(0);
  }

  private _panelRoot(): SceneObject {
    return this.getSceneObject();
  }

  private _showBridgeConnectionStatus(): void {
    const client = this.dimosManager?.bridgeClient;
    if (client?.lastBridgeStatus) {
      this._setStatus(formatBridgeStatus(client.lastBridgeStatus), COLOR_WHITE);
      return;
    }
    this._setStatus("Connected to bridge", COLOR_WHITE);
    client?.requestStatus();
  }

  private _buildInnerUI(): void {
    const panel = this._panelRoot();
    if (!panel) {
      return;
    }
    const innerWidth = PANEL_WIDTH - CONTENT_PAD_X * 2;
    const statusSlotHeight = SLOT_STATUS * 2.2;

    const totalContent =
      SLOT_HEADLINE + TITLE_BOTTOM_GAP +
      SLOT_BODY + SPACE_SM +
      ACCURACY_SLOT + SPACE_SM +
      SLOT_INPUT + SPACE_SM +
      statusSlotHeight + FOOTER_TOP_GAP +
      SLOT_FOOTER;
    let cursorY = totalContent / 2;

    cursorY -= SLOT_HEADLINE / 2;
    this._titleText = createText({
      parent: panel,
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
      parent: panel,
      name: "StepDescription",
      text: "",
      fontSize: BODY_FONT,
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
      parent: panel,
      name: "StepAccuracy",
      text: "",
      fontSize: BODY_FONT,
      color: COLOR_ERROR,
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
      panel,
      "IpInputField",
      innerWidth - 2,
      SLOT_INPUT,
      new vec3(0, cursorY, Z_CONTENT),
    );
    this._inputObj = this._inputField.getSceneObject();
    cursorY -= SLOT_INPUT / 2 + SPACE_SM;

    cursorY -= statusSlotHeight / 2;
    this._statusText = createText({
      parent: panel,
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
      parent: panel,
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
      panel,
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
    this._manualLabel.size = MANUAL_BUTTON_FONT;
    this._manualLabel.worldSpaceRect = Rect.create(
      -MANUAL_BUTTON_WIDTH / 2 + 0.25,
      MANUAL_BUTTON_WIDTH / 2 - 0.25,
      -MANUAL_BUTTON_HEIGHT / 2,
      MANUAL_BUTTON_HEIGHT / 2,
    );

    const prev = createIconButton(
      panel,
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
      panel,
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
    this._setButtonLabelRect(this._prevLabel, FOOTER_BUTTON_WIDTH, BUTTON_HEIGHT);
    this._setButtonLabelRect(this._nextLabel, FOOTER_BUTTON_WIDTH, BUTTON_HEIGHT);
  }

  private _createCalibrationViewState(): CalibrationViewState {
    return {
      mode: "auto",
      spectaclesTracking: false,
      robotTracking: false,
      currentQuality: null,
      bestQuality: null,
      hasCandidate: false,
      candidateCount: 0,
      pendingCommit: false,
      statusMessage: "Searching for calibration marker",
      statusColor: COLOR_WHITE,
    };
  }

  private _applyStepLayout(): void {
    if (this._statusText) {
      const statusY = this._currentStep === STEP_CALIBRATE
        ? this._statusBaseY + CALIBRATE_STATUS_SHIFT_Y
        : this._statusBaseY;
      this._statusText.getSceneObject().getTransform().setLocalPosition(
        new vec3(0, statusY, Z_CONTENT),
      );
    }
    if (this._detailStatusText) {
      const detailY = this._currentStep === STEP_CALIBRATE
        ? this._detailStatusBaseY + CALIBRATE_STATUS_SHIFT_Y
        : this._detailStatusBaseY;
      this._detailStatusText.getSceneObject().getTransform().setLocalPosition(
        new vec3(0, detailY, Z_CONTENT),
      );
    }
  }

  private _bindAlignmentHandlers(): void {
    if (this._alignmentHandlersBound || !this.alignmentController) {
      return;
    }
    this._alignmentHandlersBound = true;
    this.alignmentController.ensureEventHandlers?.();
    this.alignmentController.onAlignStatus.push((msg) => this._onAlignStatus(msg));
    this.alignmentController.onMarkerTrackingChanged.push((tracking) => {
      if (this._currentStep !== STEP_CALIBRATE || this._calibrationState.mode !== "auto") {
        return;
      }
      this._calibrationState.spectaclesTracking = tracking;
      this._renderCalibrationState();
    });
  }

  private _bindBridgeHandlers(): void {
    const bridgeClient = this.dimosManager?.bridgeClient;
    if (this._bridgeHandlersBound || !bridgeClient) {
      return;
    }
    this._bridgeHandlersBound = true;
    bridgeClient.ensureEventHandlers();
    bridgeClient.onHello.push(() => {
      if (this._currentStep === STEP_CONNECT) {
        this._connected = true;
        this._connectCompleted = true;
        this._showBridgeConnectionStatus();
        this._refreshFooterButtons();
      }
    });
    bridgeClient.onBridgeStatus.push((msg) => {
      if (this._currentStep === STEP_CONNECT) {
        this._setStatus(formatBridgeStatus(msg), COLOR_WHITE);
      }
    });
  }

  private setStep(step: number): void {
    const previousStep = this._currentStep;
    this._stepOperationId++;
    this._currentStep = Math.max(0, Math.min(step, LAST_STEP));
    if (previousStep !== this._currentStep) {
      this._logSetup(`step ${this._stepName(previousStep)} -> ${this._stepName(this._currentStep)}`);
    }

    if (this._titleText && this._currentStep < this._steps.length) {
      this._titleText.text = this._steps[this._currentStep];
    }
    if (this._descriptionText && this._currentStep < this._descriptions.length) {
      this._descriptionText.text = this._descriptions[this._currentStep];
    }
    this._applyStepLayout();

    if (this.alignmentController && this._currentStep !== STEP_CALIBRATE) {
      this.alignmentController.setCalibrationGizmoEnabled(false);
      this.alignmentController.stop();
    }
    if (this._currentStep !== STEP_CALIBRATE) {
      this.dimosManager?.cancelManualAlignmentPlacement();
      this.dimosManager?.stopManualAlignmentSession();
      this.dimosManager?.hideRobotMarkerPreview();
    }

    switch (this._currentStep) {
      case STEP_START:
        if (this._inputObj) {
          this._inputObj.enabled = false;
        }
        if (this._inputField) {
          this._inputField.enabled = false;
        }
        this._setAccuracyText("");
        this._setStatus("", COLOR_WHITE);
        this._clearDetailStatus();
        this._refreshFooterButtons();
        break;

      case STEP_CONNECT:
        this._aligned = false;
        this._calibrationCompleted = false;
        this._clearDetailStatus();
        this._setAccuracyText("");
        if (this._inputObj) {
          this._inputObj.enabled = true;
        }
        if (this._inputField) {
          const saved = this.dimosManager ? this.dimosManager.loadIp() : null;
          const rawFallback =
            this.defaultBridgeIp ||
            (this.dimosManager ? this.dimosManager.getBaseUrl() : "");
          const fallback = BridgeClient.normalizeIp(rawFallback);
          const ip = saved || fallback;
          this._inputField.enabled = true;
          this._inputField.initialize();
          this._inputField.text = ip;
          if (!saved && this.dimosManager && ip) {
            this.dimosManager.setBaseUrl(ip);
          }
        }
        this._refreshFooterButtons();
        if (this._connected) {
          this._showBridgeConnectionStatus();
        } else {
          this._setStatus("Enter IP and connect", COLOR_WHITE);
          this._startAutoconnect();
        }
        break;

      case STEP_CALIBRATE:
        this._aligned = false;
        this._calibrationCompleted = false;
        this._calibrationState = this._createCalibrationViewState();
        if (this._inputObj) {
          this._inputObj.enabled = false;
        }
        if (this._inputField) {
          this._inputField.enabled = false;
        }
        this._refreshFooterButtons();
        this._renderCalibrationState();
        if (this.alignmentController) {
          this.alignmentController.setCalibrationGizmoEnabled(true);
          this.alignmentController.start();
        }
        break;
    }
  }

  private _onNext(): void {
    if (!this._canNavigate()) {
      return;
    }

    if (this._currentStep === STEP_START) {
      this._logSetup("startup step completed");
      this.setStep(STEP_CONNECT);
      return;
    }

    if (this._currentStep === STEP_CONNECT) {
      const raw = this._inputField?.text.trim();
      if (!this._connected && raw && this.dimosManager) {
        this.dimosManager.setBaseUrl(BridgeClient.normalizeIp(raw));
      }
      if (!this._connected) {
        this._cancelConnectAttempt("connect step skipped");
      } else {
        this._logSetup("connect step completed");
      }
      this.setStep(STEP_CALIBRATE);
      return;
    }

    if (this._currentStep === STEP_CALIBRATE) {
      if (this._aligned) {
        this._finishSetup();
        return;
      }
      if (this._calibrationState.pendingCommit) {
        return;
      }
      if (this._calibrationState.mode === "manual" && this._calibrationState.hasCandidate) {
        const captured = this.dimosManager?.captureManualAlignmentCandidate() ?? false;
        if (!captured) {
          this._calibrationState.statusMessage = "Could not read manual marker pose - try again";
          this._calibrationState.statusColor = COLOR_ERROR;
          this._renderCalibrationState();
          this._refreshFooterButtons();
          return;
        }
        if (!this.dimosManager?.hasBridgeConnection()) {
          this._aligned = true;
          this._calibrationCompleted = true;
          this._calibrationState.statusMessage = "Manual alignment ready";
          this._calibrationState.statusColor = COLOR_SUCCESS;
          this._renderCalibrationState();
          this._refreshFooterButtons();
          this._logSetup("manual local-only calibration accepted");
          return;
        }
        if (this.dimosManager?.bridgeClient?.sendAlignCommit()) {
          this._calibrationState.pendingCommit = true;
          this._calibrationState.statusMessage = "Applying manual alignment…";
          this._calibrationState.statusColor = COLOR_WHITE;
          this._renderCalibrationState();
          this._refreshFooterButtons();
          this._logSetup("manual calibration commit requested");
        } else {
          this._calibrationState.statusMessage = "Manual alignment commit failed - try again";
          this._calibrationState.statusColor = COLOR_ERROR;
          this._renderCalibrationState();
          this._refreshFooterButtons();
        }
        return;
      }
      if (this._calibrationState.hasCandidate && this.alignmentController?.commitBestAlignment()) {
        this._calibrationState.pendingCommit = true;
        this._calibrationState.statusMessage = "Applying best alignment…";
        this._calibrationState.statusColor = COLOR_WHITE;
        this._renderCalibrationState();
        this._refreshFooterButtons();
        this._logSetup("calibration commit requested");
        return;
      }
      this.alignmentController?.setCalibrationGizmoEnabled(false);
      this.alignmentController?.stop();
      this._logSetup("calibration step skipped");
      this._finishSetup();
    }
  }

  private _onPrevious(): void {
    if (!this._canNavigate()) {
      return;
    }
    if (this._currentStep <= 0) {
      return;
    }
    this.setStep(this._currentStep - 1);
  }

  private _canNavigate(): boolean {
    const now = getTime();
    if (this._lastNavigationTime >= 0 && now - this._lastNavigationTime < NAV_DEBOUNCE_S) {
      return false;
    }
    this._lastNavigationTime = now;
    return true;
  }

  private _finishSetup(): void {
    this._setupFinished = true;
    this._logSetup(
      `finish connect=${this._connectCompleted ? "done" : "skipped"} calibration=${
        this._calibrationCompleted ? "done" : "skipped"
      }`,
    );
    const panel = this._panelRoot();
    if (panel) {
      scaleOut(panel, 0.5);
    }
    if (this.uiManager) {
      this.uiManager.setUIState(1);
    }
    if (this.alignmentController) {
      this.alignmentController.setCalibrationGizmoEnabled(false);
      this.alignmentController.stop();
    }
    if (this.dimosManager) {
      this.dimosManager.stopManualAlignmentSession();
      this.dimosManager.cancelManualAlignmentPlacement();
      this.dimosManager.setIsActive(true);
    }
  }

  private _isStepComplete(step: number): boolean {
    if (step === STEP_START) {
      return true;
    }
    if (step === STEP_CONNECT) {
      return this._connected;
    }
    if (step === STEP_CALIBRATE) {
      return this._aligned;
    }
    return true;
  }

  private _refreshFooterButtons(): void {
    let nextLabel = "Skip";
    let nextStyle = SnapOS2Styles.Ghost;
    let nextInactive = false;
    if (this._currentStep === STEP_START) {
      nextLabel = "Complete";
      nextStyle = SnapOS2Styles.Primary;
    } else if (this._currentStep === STEP_CONNECT) {
      if (this._connected) {
        nextLabel = "Complete";
        nextStyle = SnapOS2Styles.Primary;
      }
    } else if (this._currentStep === STEP_CALIBRATE) {
      if (this._calibrationState.pendingCommit) {
        nextLabel = "Completing...";
        nextStyle = SnapOS2Styles.Ghost;
        nextInactive = true;
      } else if (this._aligned || this._calibrationState.hasCandidate) {
        nextLabel = "Complete";
        nextStyle = SnapOS2Styles.Primary;
      }
    }

    if (this._nextBtn) {
      setButtonStyle(this._nextBtn, nextStyle);
      this._nextBtn.inactive = nextInactive;
    }
    if (this._nextLabel) {
      this._nextLabel.text = nextLabel;
    }
    if (this._nextObj) {
      const nextX = this._currentStep === STEP_START
        ? 0
        : this._currentStep === STEP_CALIBRATE
          ? 0
          : FOOTER_BUTTON_WIDTH / 2 + FOOTER_BUTTON_GAP;
      this._nextObj.getTransform().setLocalPosition(
        new vec3(nextX, this._nextObj.getTransform().getLocalPosition().y, Z_BUTTONS),
      );
      this._nextBtn.size = new vec3(FOOTER_BUTTON_WIDTH, BUTTON_HEIGHT, 0.5);
    }
    if (this._prevObj) {
      this._prevObj.enabled = this._currentStep > STEP_START;
      const prevX = this._currentStep === STEP_CALIBRATE
        ? -(FOOTER_BUTTON_WIDTH + FOOTER_THREE_BUTTON_GAP)
        : -(FOOTER_BUTTON_WIDTH / 2 + FOOTER_BUTTON_GAP);
      this._prevObj.getTransform().setLocalPosition(
        new vec3(prevX, this._prevObj.getTransform().getLocalPosition().y, Z_BUTTONS),
      );
      this._prevBtn.size = new vec3(FOOTER_BUTTON_WIDTH, BUTTON_HEIGHT, 0.5);
    }
    if (this._prevBtn) {
      setButtonStyle(this._prevBtn, SnapOS2Styles.Ghost);
    }
    if (this._manualObj) {
      this._manualObj.enabled = this._currentStep === STEP_CALIBRATE && !this._calibrationState.pendingCommit;
      if (this._currentStep === STEP_CALIBRATE) {
        this._manualObj.getTransform().setLocalPosition(
          new vec3(
            FOOTER_BUTTON_WIDTH + FOOTER_THREE_BUTTON_GAP,
            this._nextObj.getTransform().getLocalPosition().y,
            Z_BUTTONS,
          ),
        );
      }
    }
    if (this._manualLabel && this._currentStep === STEP_CALIBRATE) {
      this._manualLabel.text = this._calibrationState.mode === "manual"
        ? "Use marker align"
        : "Align manually";
      this._setButtonLabelRect(this._manualLabel, MANUAL_BUTTON_WIDTH, MANUAL_BUTTON_HEIGHT);
    }
  }

  private _setButtonLabelRect(label: Text | null, width: number, height: number): void {
    if (!label) {
      return;
    }
    label.worldSpaceRect = Rect.create(
      -width / 2 + 0.25,
      width / 2 - 0.25,
      -height / 2,
      height / 2,
    );
  }

  private _setStatus(text: string, color: vec4): void {
    if (!this._statusText) {
      return;
    }
    this._statusText.text = text;
    this._statusText.textFill.color = color;
  }

  private _setDetailStatus(text: string): void {
    if (!this._detailStatusText) {
      return;
    }
    this._detailStatusText.text = text;
    this._detailStatusText.textFill.color = COLOR_MUTED;
  }

  private _clearDetailStatus(): void {
    this._setDetailStatus("");
  }

  private _setAccuracyText(text: string, color: vec4 = COLOR_MUTED): void {
    if (!this._accuracyText) {
      return;
    }
    this._accuracyText.text = text;
    this._accuracyText.textFill.color = color;
  }

  private _qualityColor(quality: number | null): vec4 {
    if (quality === null || quality <= 0) {
      return COLOR_ERROR;
    }
    if (quality >= 0.9) {
      return COLOR_SUCCESS;
    }
    return COLOR_WARN;
  }

  private _renderCalibrationState(): void {
    if (this._currentStep !== STEP_CALIBRATE) {
      return;
    }
    if (this._calibrationState.mode === "manual") {
      this._setAccuracyText(
        this._calibrationState.hasCandidate ? "Manual alignment ready" : "Manual alignment",
        COLOR_WARN,
      );
      this._setStatus(this._calibrationState.statusMessage, this._calibrationState.statusColor);
      this._setDetailStatus(
        this._calibrationState.hasCandidate
          ? this.dimosManager?.hasBridgeConnection()
            ? "Grab and move the robot marker.\nComplete to commit the assumed pose."
            : "Grab and move the robot marker.\nComplete to continue with the local pose."
          : "Grab the robot marker below the panel to position it.",
      );
      return;
    }
    const displayQuality =
      this._calibrationState.currentQuality !== null
        ? this._calibrationState.currentQuality
        : this._calibrationState.bestQuality;
    const percent = displayQuality !== null ? Math.round(displayQuality * 100) : 0;
    this._setAccuracyText(`Accuracy ${percent}%`, this._qualityColor(displayQuality));
    this._setStatus(this._calibrationState.statusMessage, this._calibrationState.statusColor);
    const bestLabel = this._calibrationState.bestQuality !== null
      ? `${Math.round(this._calibrationState.bestQuality * 100)}%`
      : "none yet";
    this._setDetailStatus(
      `Spectacles: ${this._markerVisibilityLabel(this._calibrationState.spectaclesTracking)}\n` +
      `Robot: ${this._markerVisibilityLabel(this._calibrationState.robotTracking)}\n` +
      `Best: ${bestLabel}`,
    );
  }

  private _markerVisibilityLabel(tracking: boolean): string {
    return tracking ? "✅ visible" : "❌ not visible";
  }

  private _compactAlignMessage(message: string): string {
    if (message === "Searching for calibration marker") {
      return "Searching for marker";
    }
    if (message === "Searching for marker on both devices…") {
      return "Searching on both devices";
    }
    if (message === "Spectacles sees marker — point phone at Go2 front camera") {
      return "Spectacles sees marker - show it to Go2";
    }
    if (message === "Robot sees marker — show marker to Spectacles") {
      return "Robot sees marker - show it to Spectacles";
    }
    if (message === "Alignment improved — hold steady for best result") {
      return "Alignment improved - hold steady";
    }
    if (message === "Tracking marker — refining best alignment") {
      return "Tracking marker - refining";
    }
    if (message === "Tracking marker — best alignment 0% ready") {
      return "Tracking marker";
    }
    return message;
  }

  private _toggleManualAlignment(): void {
    if (this._currentStep !== STEP_CALIBRATE) {
      return;
    }
    if (this._calibrationState.mode === "manual") {
      this._logSetup("manual alignment disabled");
      this._aligned = false;
      this._calibrationCompleted = false;
      this._calibrationState = this._createCalibrationViewState();
      this.dimosManager?.cancelManualAlignmentPlacement();
      this.dimosManager?.stopManualAlignmentSession();
      this.dimosManager?.hideRobotMarkerPreview();
      this.alignmentController?.setCalibrationGizmoEnabled(true);
      this.alignmentController?.start();
      this._renderCalibrationState();
      this._refreshFooterButtons();
      return;
    }
    this._logSetup("manual alignment enabled");
    this.alignmentController?.setCalibrationGizmoEnabled(false);
    this.alignmentController?.stop();
    this._aligned = false;
    this._calibrationCompleted = false;
    this._calibrationState = {
      ...this._createCalibrationViewState(),
      mode: "manual",
        hasCandidate: true,
        statusMessage: "Move the robot marker into place, then complete",
      statusColor: COLOR_WHITE,
    };
    if (!this.dimosManager?.startManualAlignmentSession()) {
      this._calibrationState = this._createCalibrationViewState();
      this._setStatus("Connect to bridge before manual alignment", COLOR_ERROR);
      this.alignmentController?.setCalibrationGizmoEnabled(true);
      this.alignmentController?.start();
      this._refreshFooterButtons();
      return;
    }
    this.dimosManager?.beginManualAlignmentPlacement(this._panelRoot());
    this._renderCalibrationState();
    this._refreshFooterButtons();
  }

  private _onAlignStatus(msg: AlignStatusMessage): void {
    if (this._currentStep !== STEP_CALIBRATE) {
      return;
    }
    if (this._calibrationState.mode === "auto") {
      this._calibrationState.robotTracking = msg.robot_marker_detected;
      this._calibrationState.spectaclesTracking = this.alignmentController
        ? this.alignmentController.isMarkerTracked()
        : msg.spectacles_marker_detected;
    }
    this._calibrationState.currentQuality =
      msg.quality !== undefined ? msg.quality : this._calibrationState.currentQuality;
    this._calibrationState.bestQuality =
      msg.best_quality !== undefined
        ? msg.best_quality
        : this._calibrationState.bestQuality;
    this._calibrationState.hasCandidate =
      msg.has_candidate !== undefined
        ? msg.has_candidate
        : this._calibrationState.hasCandidate;
    this._calibrationState.candidateCount =
      msg.candidate_count !== undefined
        ? msg.candidate_count
        : this._calibrationState.candidateCount;

    if (msg.state === "aligned") {
      this._aligned = true;
      this._calibrationCompleted = true;
      this._calibrationState.pendingCommit = false;
      this._calibrationState.robotTracking = true;
      this._calibrationState.spectaclesTracking = true;
      this._calibrationState.statusMessage = msg.quality !== undefined
        ? `Alignment locked at ${Math.round(msg.quality * 100)}%`
        : "Alignment successful";
      this._calibrationState.statusColor = COLOR_SUCCESS;
      this._renderCalibrationState();
      this._logSetup(
        `alignment succeeded (${Math.round((msg.quality ?? 0) * 100)}%)`,
      );
      this._refreshFooterButtons();
      return;
    }
    if (msg.state === "failed") {
      this._aligned = false;
      this._calibrationState.pendingCommit = false;
      this._calibrationState.statusMessage = msg.message || "Alignment failed - try again";
      this._calibrationState.statusColor = COLOR_ERROR;
      this._renderCalibrationState();
      this._logSetup(`alignment failed: ${msg.message || "unknown"}`);
      this._refreshFooterButtons();
      return;
    }
    this._aligned = false;
    this._calibrationState.statusMessage = this._calibrationState.mode === "manual"
      ? (msg.message || "Manual robot pose ready")
      : this._compactAlignMessage(msg.message || "Searching for calibration marker");
    this._calibrationState.statusColor = this._calibrationState.mode === "manual"
      ? (this._calibrationState.hasCandidate ? COLOR_SUCCESS : COLOR_WHITE)
      : this._calibrationState.hasCandidate
        ? COLOR_SUCCESS
        : (this._calibrationState.spectaclesTracking || this._calibrationState.robotTracking)
          ? COLOR_WARN
          : COLOR_WHITE;
    this._renderCalibrationState();
    this._refreshFooterButtons();
  }

  private _startAutoconnect(): void {
    if (this._currentStep !== STEP_CONNECT) {
      return;
    }
    this._stepOperationId++;
    const opId = this._stepOperationId;
    if (!this.dimosManager || !this._inputField) {
      return;
    }
    const raw = this._inputField.text.trim();
    if (!raw) {
      return;
    }
    const ip = BridgeClient.normalizeIp(raw);
    if (ip !== raw) {
      this._inputField.text = ip;
    }
    this.dimosManager.setBaseUrl(ip);
    this._setStatus("Connecting...", COLOR_WHITE);
    this._logSetup(`connect attempt ${ip}`);

    this.dimosManager.checkConnection().then((ok) => {
      if (opId !== this._stepOperationId || this._currentStep !== STEP_CONNECT) {
        return;
      }
      if (ok) {
        this._connected = true;
        this._connectCompleted = true;
        this.dimosManager.saveIp(ip);
        this._showBridgeConnectionStatus();
        this._logSetup("connect succeeded");
        this._refreshFooterButtons();
      } else {
        this._setStatus("Not connected — retrying...", COLOR_ERROR);
        this._logSetup("connect failed, retrying");
        this._scheduleRetry(opId);
      }
    });
  }

  private _scheduleRetry(opId: number): void {
    const retry = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
    retry.bind(() => {
      if (opId !== this._stepOperationId || this._currentStep !== STEP_CONNECT) {
        return;
      }
      this.dimosManager.checkConnection().then((ok) => {
        if (opId !== this._stepOperationId || this._currentStep !== STEP_CONNECT) {
          return;
        }
        if (ok) {
          this._connected = true;
          this._connectCompleted = true;
          if (this._inputField) {
            this.dimosManager.saveIp(
              BridgeClient.normalizeIp(this._inputField.text.trim()),
            );
          }
          this._showBridgeConnectionStatus();
          this._logSetup("connect retry succeeded");
          this._refreshFooterButtons();
        } else {
          this._setStatus("Not connected — retrying...", COLOR_ERROR);
          this._scheduleRetry(opId);
        }
      });
    });
    retry.reset(2.0);
  }

  private _cancelConnectAttempt(reason: string): void {
    this._stepOperationId++;
    if (this.dimosManager) {
      this.dimosManager.disconnect();
    }
    this._logSetup(reason);
  }

  private _stepName(step: number): string {
    if (step === STEP_START) {
      return "start";
    }
    if (step === STEP_CONNECT) {
      return "connect";
    }
    if (step === STEP_CALIBRATE) {
      return "calibrate";
    }
    return "unknown";
  }

  private _logSetup(message: string): void {
    print(`SetupWizard: ${message}`);
  }
}
