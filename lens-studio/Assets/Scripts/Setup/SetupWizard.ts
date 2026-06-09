require("LensStudio:TextInputModule");

import { AlignmentController } from "../Alignment/AlignmentController";
import { DimosManager } from "../DimosManager";
import { UIManager } from "../UI/UIManager";
import { AlignStatusMessage } from "../Network/Protocol";
import { scaleIn } from "../UI/Shared/UIAnimations";
import {
  COLOR_WHITE,
} from "../UI/Shared/UICore";
import {
  buildCalibrationDisplay,
  createCalibrationViewState,
  getWizardFooterState,
} from "./CalibrationPresenter";
import {
  WizardStep,
  WIZARD_STEP_TITLES,
  CALIBRATE_DESCRIPTION_AUTO,
  CALIBRATE_DESCRIPTION_MANUAL,
} from "./WizardStepData";
import { WizardConnectionController } from "./WizardConnectionController";
import { WizardStepController } from "./WizardStepController";
import { WizardView } from "../UI/WizardView";
import { getBridgeStatusPresentationForConnect } from "../UI/Shared/BridgeStatusPresentation";
import { CalibrationSession } from "./CalibrationSession";

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
  private _connectCompleted = false;
  private _alignmentHandlersBound = false;
  private _bridgeHandlersBound = false;
  private _view: WizardView | null = null;
  private _connectionController: WizardConnectionController | null = null;
  private _stepController: WizardStepController | null = null;
  private _calibrationSession: CalibrationSession | null = null;
  private _isConnecting = false;

  onAwake() {
    this._view = new WizardView(this.getSceneObject());
    this.createEvent("OnStartEvent").bind(() => {
      this._connectionController = new WizardConnectionController(
        this,
        this.dimosManager,
        () => this._currentStep === WizardStep.Connect,
        (message: string) => this._logSetup(message),
      );
      this._calibrationSession = new CalibrationSession(
        this.dimosManager,
        this.alignmentController,
        {
          beginManualAlignmentPlacementFromWizard: () =>
            this._beginManualAlignmentPlacementFromWizard(),
          render: () => this._renderCalibrationState(),
          refreshFooter: () => this._refreshFooterButtons(),
          refreshDescription: () => this._refreshCalibrationDescription(),
          log: (message) => this._logSetup(message),
          finishSetup: () => this._finishSetup(),
        },
      );
      this._stepController = new WizardStepController({
        getCurrentStep: () => this._currentStep,
        setCurrentStep: (step) => {
          this._currentStep = step;
        },
        getConnected: () =>
          (this.dimosManager?.bridgeLinkState ?? "disconnected") !== "disconnected",
        getCalibrationState: () =>
          this._calibrationSession?.state ?? createCalibrationViewState(),
        getView: () => this._view,
        getDimosManager: () => this.dimosManager,
        getAlignmentController: () => this.alignmentController,
        getConnectionController: () => this._connectionController,
        log: (message) => this._logSetup(message),
        showBridgeConnectionStatus: () => this._showBridgeConnectionStatus(),
        refreshFooterButtons: () => this._refreshFooterButtons(),
        enterCalibration: () => this._calibrationSession?.enter(),
        leaveCalibration: () => this._calibrationSession?.leave(),
        completeCalibrationStep: () =>
          this._calibrationSession?.completeStep() ?? false,
        finishSetup: () => this._finishSetup(),
        startAutoconnect: () => this._startAutoconnect(),
      });
      this._view?.bindHandlers(
        () => this._stepController?.onNext(),
        () => this._stepController?.onPrevious(),
        () => this._toggleManualAlignment(),
        () => this._startAutoconnect(),
      );
      this.createEvent("UpdateEvent").bind(() => this._calibrationSession?.tick());
      this._bindAlignmentHandlers();
      this._bindBridgeHandlers();
      this.startSetupWizard();
    });
  }

  public startSetupWizard(): void {
    this._logSetup("start");
    this._connectCompleted = false;
    this._isConnecting = false;
    this._stepController?.resetNavigationDebounce();
    this._calibrationSession?.leave();
    this._calibrationSession?.setState(createCalibrationViewState());
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
    const presentation = getBridgeStatusPresentationForConnect(
      this.dimosManager?.bridgeLinkState ?? "disconnected",
      this._isConnecting,
    );
    this._view?.setStatus(presentation.text, presentation.color);
    if (this.dimosManager?.hasBridgeConnection()) {
      this.dimosManager.requestBridgeStatus();
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
      if (
        this._currentStep !== WizardStep.Calibrate ||
        this._calibrationSession?.state.mode !== "auto"
      ) {
        return;
      }
      this._calibrationSession?.updateSpectaclesTracking(tracking);
    });
  }

  private _bindBridgeHandlers(): void {
    if (this._bridgeHandlersBound || !this.dimosManager) {
      return;
    }
    this._bridgeHandlersBound = true;
    this.dimosManager.onBridgeReady.push(() => {
      if (this._currentStep === WizardStep.Connect) {
        this._connectCompleted = true;
        this._isConnecting = false;
        this._showBridgeConnectionStatus();
        this._refreshFooterButtons();
      }
      if (
        this._currentStep === WizardStep.Calibrate &&
        this._calibrationSession?.state.mode === "auto" &&
        this.alignmentController
      ) {
        if (this.alignmentController.ensureBridgeSession()) {
          this._renderCalibrationState();
        }
      }
    });
    this.dimosManager.onBridgeConnectionChanged.push((connected) => {
      if (!connected) {
        this._isConnecting = false;
      }
      if (this._currentStep === WizardStep.Connect) {
        this._showBridgeConnectionStatus();
        this._refreshFooterButtons();
      }
      if (this._currentStep === WizardStep.Calibrate) {
        this._calibrationSession?.handleBridgeConnectionChanged(connected);
      }
    });
    this.dimosManager.onBridgeStatusChanged.push((msg) => {
      if (this._currentStep === WizardStep.Connect) {
        this._showBridgeConnectionStatus();
      }
      if (this._currentStep === WizardStep.Calibrate) {
        this._calibrationSession?.handleBridgeStatus(msg);
      }
    });
  }

  private _finishSetup(): void {
    this._logSetup(
      `finish connect=${this._connectCompleted ? "done" : "skipped"} calibration=${
        this._calibrationSession?.isComplete() ? "done" : "skipped"
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
      (this.dimosManager?.bridgeLinkState ?? "disconnected") !== "disconnected",
      this._calibrationSession?.state ?? createCalibrationViewState(),
    );
    if (
      this._currentStep === WizardStep.Calibrate &&
      this._calibrationSession?.isManualOnly()
    ) {
      footerState.showManual = false;
    }
    this._view?.applyFooterState(this._currentStep, footerState);
  }

  private _renderCalibrationState(): void {
    if (this._currentStep !== WizardStep.Calibrate) {
      return;
    }
    const display = buildCalibrationDisplay(
      this._calibrationSession?.state ?? createCalibrationViewState(),
      this.dimosManager?.hasBridgeConnection() ?? false,
    );
    this._view?.setAccuracy("");
    if (display.statusText) {
      this._view?.setStatus(display.statusText, display.statusColor);
    } else {
      this._view?.setStatus("", COLOR_WHITE);
    }
    this._view?.clearDetailStatus();
  }

  private _refreshCalibrationDescription(): void {
    const description =
      this._calibrationSession?.state.mode === "manual"
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
    this._calibrationSession?.toggleMode();
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
    this._calibrationSession?.handleAlignStatus(msg, spectaclesTracking);
    if (msg.state === "aligned") {
      this._logSetup(
        `alignment succeeded (${Math.round((msg.quality ?? 0) * 100)}%)`,
      );
    } else if (msg.state === "failed") {
      this._logSetup(`alignment failed: ${msg.message || "unknown"}`);
    }
  }

  private _startAutoconnect(): void {
    if (!this._connectionController || !this._view) {
      return;
    }
    this._connectionController.startAutoconnect(this._view.inputField, {
      onConnecting: (ip: string) => {
        this._isConnecting = true;
        this._view?.setInputText(ip);
        this._showBridgeConnectionStatus();
      },
      onConnected: () => {
        this._connectCompleted = true;
        this._isConnecting = false;
        this._showBridgeConnectionStatus();
        this._refreshFooterButtons();
      },
      onRetrying: () => {
        this._isConnecting = false;
        this._showBridgeConnectionStatus();
      },
    });
  }

  private _logSetup(message: string): void {
    print(`SetupWizard: ${message}`);
  }
}
