require("LensStudio:TextInputModule");

import { AlignmentController } from "../Alignment/AlignmentController";
import { DimosManager } from "../DimosManager";
import { UIManager } from "../UI/UIManager";
import { AlignStatusMessage, formatBridgeStatus } from "../Network/Protocol";
import { scaleIn } from "../UI/Shared/UIAnimations";
import {
  COLOR_ERROR,
  COLOR_SUCCESS,
  COLOR_WHITE,
} from "../UI/Shared/UICore";
import {
  applyAlignStatusToCalibrationState,
  buildCalibrationDisplay,
  createCalibrationViewState,
  createManualCalibrationState,
  getWizardFooterState,
} from "./CalibrationPresenter";
import {
  WizardStep,
  WIZARD_STEP_TITLES,
  CALIBRATE_DESCRIPTION_AUTO,
  CALIBRATE_DESCRIPTION_MANUAL,
  CalibrationViewState,
} from "./WizardStepData";
import { WizardConnectionController } from "./WizardConnectionController";
import { WizardStepController } from "./WizardStepController";
import { WizardView } from "../UI/WizardView";

// ================================================================
// ================================================================
/** Three-step setup component (start, connect, calibrate) that gates entry into runtime. */
@component
export class SetupWizard extends BaseScriptComponent {
  @input
  dimosManager: DimosManager;

  @input
  uiManager: UIManager;

  @input
  alignmentController: AlignmentController;

  private _currentStep = WizardStep.Start;
  private _connected = false;
  private _aligned = false;
  private _connectCompleted = false;
  private _calibrationCompleted = false;
  private _alignmentHandlersBound = false;
  private _bridgeHandlersBound = false;
  private _calibrationState: CalibrationViewState =
    createCalibrationViewState();
  private _view: WizardView | null = null;
  private _connectionController: WizardConnectionController | null = null;
  private _stepController: WizardStepController | null = null;

  onAwake() {
    this._view = new WizardView(this.getSceneObject());
    this.createEvent("OnStartEvent").bind(() => {
      this._connectionController = new WizardConnectionController(
        this,
        this.dimosManager,
        () => this._currentStep === WizardStep.Connect,
        (message: string) => this._logSetup(message),
      );
      this._stepController = new WizardStepController({
        getCurrentStep: () => this._currentStep,
        setCurrentStep: (step) => {
          this._currentStep = step;
        },
        getConnected: () => this._connected,
        getAligned: () => this._aligned,
        setAligned: (aligned) => {
          this._aligned = aligned;
        },
        setCalibrationCompleted: (completed) => {
          this._calibrationCompleted = completed;
        },
        getCalibrationState: () => this._calibrationState,
        setCalibrationState: (state) => {
          this._calibrationState = state;
        },
        getView: () => this._view,
        getDimosManager: () => this.dimosManager,
        getAlignmentController: () => this.alignmentController,
        getConnectionController: () => this._connectionController,
        log: (message) => this._logSetup(message),
        showBridgeConnectionStatus: () => this._showBridgeConnectionStatus(),
        refreshFooterButtons: () => this._refreshFooterButtons(),
        renderCalibrationState: () => this._renderCalibrationState(),
        refreshCalibrationDescription: () =>
          this._refreshCalibrationDescription(),
        finishSetup: () => this._finishSetup(),
        startAutoconnect: () => this._startAutoconnect(),
      });
      this._view?.bindHandlers(
        () => this._stepController?.onNext(),
        () => this._stepController?.onPrevious(),
        () => this._toggleManualAlignment(),
        () => this._startAutoconnect(),
      );
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
    this._stepController?.resetNavigationDebounce();
    this._calibrationState = createCalibrationViewState();
    this._connectionController?.invalidatePending();
    if (this.alignmentController) {
      this.alignmentController.setCalibrationGizmoEnabled(false);
      this.alignmentController.stop();
    }
    this.dimosManager?.enterSetup();
    const panel = this.getSceneObject();
    if (panel) {
      panel.enabled = true;
      scaleIn(panel, 0.5);
    }
    this._stepController?.setStep(WizardStep.Start);
  }

  private _showBridgeConnectionStatus(): void {
    const bridgeStatus = this.dimosManager?.lastBridgeStatus;
    if (bridgeStatus) {
      this._view?.setStatus(
        formatBridgeStatus(bridgeStatus),
        COLOR_WHITE,
      );
      return;
    }
    this._view?.setStatus("Connected to bridge", COLOR_WHITE);
    this.dimosManager?.requestBridgeStatus();
  }

  private _bindAlignmentHandlers(): void {
    if (this._alignmentHandlersBound || !this.alignmentController) {
      return;
    }
    this._alignmentHandlersBound = true;
    this.alignmentController.ensureEventHandlers?.();
    this.alignmentController.onAlignStatus.push((msg) => this._onAlignStatus(msg));
    this.alignmentController.onMarkerTrackingChanged.push((tracking) => {
      if (
        this._currentStep !== WizardStep.Calibrate ||
        this._calibrationState.mode !== "auto"
      ) {
        return;
      }
      this._calibrationState.spectaclesTracking = tracking;
      this._renderCalibrationState();
    });
  }

  private _bindBridgeHandlers(): void {
    if (this._bridgeHandlersBound || !this.dimosManager) {
      return;
    }
    this._bridgeHandlersBound = true;
    this.dimosManager.onBridgeReady.push(() => {
      if (this._currentStep === WizardStep.Connect) {
        this._connected = true;
        this._connectCompleted = true;
        this._showBridgeConnectionStatus();
        this._refreshFooterButtons();
      }
    });
    this.dimosManager.onBridgeConnectionChanged.push((connected) => {
      this._connected = connected;
      if (this._currentStep === WizardStep.Connect) {
        this._showBridgeConnectionStatus();
        this._refreshFooterButtons();
      }
      if (this._currentStep === WizardStep.Calibrate && !connected) {
        if (this._calibrationState.pendingCommit) {
          this._calibrationState.pendingCommit = false;
          this._calibrationState.statusMessage =
            "Bridge disconnected during alignment - try again or use local manual placement";
          this._calibrationState.statusColor = COLOR_ERROR;
          this._renderCalibrationState();
          this._refreshFooterButtons();
        }
      }
    });
    this.dimosManager.onBridgeStatusChanged.push((msg) => {
      if (this._currentStep === WizardStep.Connect) {
        this._view?.setStatus(formatBridgeStatus(msg), COLOR_WHITE);
      }
      if (
        this._currentStep === WizardStep.Calibrate &&
        this._calibrationState.pendingCommit &&
        msg.registered
      ) {
        this._calibrationState.pendingCommit = false;
        this.dimosManager?.cancelManualAlignmentPlacement();
        this._aligned = true;
        this._calibrationCompleted = true;
        this._calibrationState.statusMessage = "Alignment confirmed via bridge status";
        this._calibrationState.statusColor = COLOR_SUCCESS;
        this._renderCalibrationState();
        this._logSetup("alignment confirmed via bridge_status fallback");
        this._refreshFooterButtons();
        this._finishSetup();
      }
    });
  }

  private _finishSetup(): void {
    this._logSetup(
      `finish connect=${this._connectCompleted ? "done" : "skipped"} calibration=${
        this._calibrationCompleted ? "done" : "skipped"
      }`,
    );
    const panel = this.getSceneObject();
    if (panel) {
      panel.enabled = false;
    }
    if (this.alignmentController) {
      this.alignmentController.setCalibrationGizmoEnabled(false);
      this.alignmentController.stop();
    }
    this.dimosManager?.enterRuntime();
  }

  private _refreshFooterButtons(): void {
    const footerState = getWizardFooterState(
      this._currentStep,
      this._connected,
      this._aligned,
      this._calibrationState,
    );
    this._view?.applyFooterState(this._currentStep, footerState);
  }

  private _renderCalibrationState(): void {
    if (this._currentStep !== WizardStep.Calibrate) {
      return;
    }
    const display = buildCalibrationDisplay(
      this._calibrationState,
      this.dimosManager?.hasBridgeConnection() ?? false,
    );
    this._view?.setAccuracy(display.accuracyText, display.accuracyColor);
    this._view?.setStatus(display.statusText, display.statusColor);
    this._view?.setDetailStatus(display.detailText);
  }

  private _refreshCalibrationDescription(): void {
    const description =
      this._calibrationState.mode === "manual"
        ? CALIBRATE_DESCRIPTION_MANUAL
        : CALIBRATE_DESCRIPTION_AUTO;
    this._view?.setStepContent(
      WIZARD_STEP_TITLES[WizardStep.Calibrate],
      description,
    );
  }

  private _toggleManualAlignment(): void {
    if (this._currentStep !== WizardStep.Calibrate) {
      return;
    }
    if (this._calibrationState.mode === "manual") {
      this._logSetup("manual alignment disabled");
      this._aligned = false;
      this._calibrationCompleted = false;
      this._calibrationState = createCalibrationViewState();
      this.dimosManager?.cancelManualAlignmentPlacement();
      this.dimosManager?.stopManualAlignmentSession();
      this.dimosManager?.clearManualAlignmentPose();
      this.dimosManager?.hideRobotMarkerPreview();
      this.alignmentController?.setCalibrationGizmoEnabled(true);
      this.alignmentController?.start();
      this._refreshCalibrationDescription();
      this._renderCalibrationState();
      this._refreshFooterButtons();
      return;
    }
    this._logSetup("manual alignment enabled");
    this.alignmentController?.setCalibrationGizmoEnabled(false);
    this.alignmentController?.stop();
    this._aligned = false;
    this._calibrationCompleted = false;
    this._calibrationState = createManualCalibrationState();
    this._refreshCalibrationDescription();
    if (!this._beginManualAlignmentPlacementFromWizard()) {
      this._calibrationState.hasCandidate = false;
      this._calibrationState.statusMessage =
        "Could not determine a stable marker spawn pose";
      this._calibrationState.statusColor = COLOR_ERROR;
      this.dimosManager?.cancelManualAlignmentPlacement();
      this.dimosManager?.stopManualAlignmentSession();
      this.dimosManager?.clearManualAlignmentPose();
      this._renderCalibrationState();
      this._refreshFooterButtons();
      return;
    }
    if (this.dimosManager?.hasBridgeConnection()) {
      if (!this.dimosManager.startManualAlignmentSession()) {
        this._calibrationState.statusMessage =
          "Manual placement started, but bridge debug session could not start";
        this._calibrationState.statusColor = COLOR_WHITE;
      }
    } else {
      this._calibrationState.statusMessage =
        "Manual placement started locally - bridge connection is only needed for live debugging";
      this._calibrationState.statusColor = COLOR_WHITE;
    }
    this._renderCalibrationState();
    this._refreshFooterButtons();
  }

  private _beginManualAlignmentPlacementFromWizard(): boolean {
    const panel = this.getSceneObject();
    if (!panel) {
      return false;
    }
    const transform = panel.getTransform();
    const position = transform.getWorldPosition();
    const rotation = transform.getWorldRotation();
    this.dimosManager?.beginManualAlignmentPlacementAt(
      new vec3(position.x, position.y, position.z),
      rotation,
    );
    return true;
  }

  private _onAlignStatus(msg: AlignStatusMessage): void {
    if (this._currentStep !== WizardStep.Calibrate) {
      return;
    }
    const spectaclesTracking = this.alignmentController
      ? this.alignmentController.isMarkerTracked()
      : msg.spectacles_marker_detected;
    this._calibrationState = applyAlignStatusToCalibrationState(
      this._calibrationState,
      msg,
      spectaclesTracking,
    );

    if (msg.state === "aligned") {
      this.dimosManager?.cancelManualAlignmentPlacement();
      this._aligned = true;
      this._calibrationCompleted = true;
      this._renderCalibrationState();
      this._logSetup(
        `alignment succeeded (${Math.round((msg.quality ?? 0) * 100)}%)`,
      );
      
      this._refreshFooterButtons();
      return;
    }
    if (msg.state === "failed") {
      if (this._calibrationState.mode === "manual") {
        this.dimosManager?.hideRobotMarkerPreview();
      }
      this._aligned = false;
      this._renderCalibrationState();
      this._logSetup(`alignment failed: ${msg.message || "unknown"}`);
      this._refreshFooterButtons();
      return;
    }
    this._aligned = false;
    this._renderCalibrationState();
    this._refreshFooterButtons();
  }

  private _startAutoconnect(): void {
    if (!this._connectionController || !this._view) {
      return;
    }
    this._connectionController.startAutoconnect(this._view.inputField, {
      onConnecting: (ip: string) => {
        this._view?.setInputText(ip);
        this._view?.setStatus("Connecting...", COLOR_WHITE);
      },
      onConnected: () => {
        this._connected = true;
        this._connectCompleted = true;
        this._showBridgeConnectionStatus();
        this._refreshFooterButtons();
      },
      onRetrying: () => {
        this._view?.setStatus("Not connected — retrying...", COLOR_ERROR);
      },
    });
  }

  private _logSetup(message: string): void {
    print(`SetupWizard: ${message}`);
  }
}
