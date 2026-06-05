import { AlignmentController } from "../Alignment/AlignmentController";
import { BridgeClient } from "../Network/BridgeClient";
import { DimosManager } from "../DimosManager";
import {
  createCalibrationViewState,
  createManualCalibrationState,
} from "./CalibrationPresenter";
import {
  CALIBRATE_DESCRIPTION_AUTO,
  CALIBRATE_DESCRIPTION_MANUAL,
  CalibrationViewState,
  LAST_WIZARD_STEP,
  WIZARD_STEP_DESCRIPTIONS,
  WIZARD_STEP_TITLES,
  WizardStep,
  wizardStepName,
} from "./WizardStepData";
import { WizardConnectionController } from "./WizardConnectionController";
import {
  COLOR_ERROR,
  COLOR_SUCCESS,
  COLOR_WHITE,
} from "../UI/Shared/UICore";
import { WizardView } from "../UI/WizardView";

const NAV_DEBOUNCE_S = 0.35;

export interface WizardStepControllerHost {
  getCurrentStep: () => WizardStep;
  setCurrentStep: (step: WizardStep) => void;
  getConnected: () => boolean;
  getAligned: () => boolean;
  setAligned: (aligned: boolean) => void;
  setCalibrationCompleted: (completed: boolean) => void;
  getCalibrationState: () => CalibrationViewState;
  setCalibrationState: (state: CalibrationViewState) => void;
  getView: () => WizardView | null;
  getDimosManager: () => DimosManager | null;
  getAlignmentController: () => AlignmentController | null;
  getConnectionController: () => WizardConnectionController | null;
  log: (message: string) => void;
  showBridgeConnectionStatus: () => void;
  refreshFooterButtons: () => void;
  renderCalibrationState: () => void;
  refreshCalibrationDescription: () => void;
  beginManualAlignmentPlacementFromWizard: () => boolean;
  finishSetup: () => void;
  startAutoconnect: () => void;
}

export class WizardStepController {
  private _lastNavigationTime = -1;

  constructor(private readonly _host: WizardStepControllerHost) {}

  public resetNavigationDebounce(): void {
    this._lastNavigationTime = -1;
  }

  public setStep(step: WizardStep): void {
    const previousStep = this._host.getCurrentStep();
    const clampedStep = Math.max(
      WizardStep.Start,
      Math.min(step, LAST_WIZARD_STEP),
    ) as WizardStep;
    this._host.getConnectionController()?.invalidatePending();
    this._host.setCurrentStep(clampedStep);

    if (previousStep !== clampedStep) {
      this._host.log(
        `step ${wizardStepName(previousStep)} -> ${wizardStepName(clampedStep)}`,
      );
    }

    const view = this._host.getView();
    view?.setStepContent(
      WIZARD_STEP_TITLES[clampedStep],
      WIZARD_STEP_DESCRIPTIONS[clampedStep],
    );
    view?.applyStepLayout(clampedStep);

    const alignmentController = this._host.getAlignmentController();
    if (alignmentController && clampedStep !== WizardStep.Calibrate) {
      alignmentController.setCalibrationGizmoEnabled(false);
      alignmentController.stop();
    }

    const dimosManager = this._host.getDimosManager();
    if (clampedStep !== WizardStep.Calibrate) {
      dimosManager?.cancelManualAlignmentPlacement();
      dimosManager?.stopManualAlignmentSession();
      dimosManager?.clearManualAlignmentPose();
      dimosManager?.hideRobotMarkerPreview();
    }

    switch (clampedStep) {
      case WizardStep.Start:
        view?.setInputEnabled(false);
        view?.setAccuracy("");
        view?.setStatus("", COLOR_WHITE);
        view?.clearDetailStatus();
        this._host.refreshFooterButtons();
        break;

      case WizardStep.Connect: {
        this._host.setAligned(false);
        this._host.setCalibrationCompleted(false);
        view?.clearDetailStatus();
        view?.setAccuracy("");
        view?.setInputEnabled(true);

        const saved = dimosManager ? dimosManager.loadIp() : null;
        const rawFallback =
          (dimosManager ? dimosManager.getDefaultBridgeIp() : "") ||
          (dimosManager ? dimosManager.getBaseUrl() : "");
        const fallback = BridgeClient.normalizeIp(rawFallback);
        const ip = saved || fallback;

        if (view) {
          view.initializeInput(ip);
        }
        if (!saved && dimosManager && ip) {
          dimosManager.setBaseUrl(ip);
        }

        this._host.refreshFooterButtons();
        if (this._host.getConnected()) {
          this._host.showBridgeConnectionStatus();
        } else {
          view?.setStatus("Enter IP and connect", COLOR_WHITE);
          this._host.startAutoconnect();
        }
        break;
      }

      case WizardStep.Calibrate:
        this._host.setAligned(false);
        this._host.setCalibrationCompleted(false);
        const markerAlignmentAvailable =
          dimosManager?.canUseMarkerAlignment() ?? true;
        const manualAlignmentAvailable =
          dimosManager?.canUseManualAlignment() ?? true;
        const useManualOnly =
          dimosManager?.hasBridgeConnection() &&
          !markerAlignmentAvailable &&
          manualAlignmentAvailable;
        this._host.setCalibrationState(
          useManualOnly ? createManualCalibrationState() : createCalibrationViewState(),
        );
        view?.setInputEnabled(false);
        this._host.refreshFooterButtons();
        this._host.refreshCalibrationDescription();
        this._host.renderCalibrationState();
        if (useManualOnly) {
          alignmentController?.setCalibrationGizmoEnabled(false);
          alignmentController?.stop();
          if (!this._host.beginManualAlignmentPlacementFromWizard()) {
            const calibrationState = this._host.getCalibrationState();
            calibrationState.hasCandidate = false;
            calibrationState.statusMessage =
              "Could not determine a stable marker spawn pose";
            calibrationState.statusColor = COLOR_ERROR;
            this._host.renderCalibrationState();
            this._host.refreshFooterButtons();
          }
        } else if (alignmentController) {
          alignmentController.setCalibrationGizmoEnabled(true);
          alignmentController.start();
        }
        break;
    }
  }

  public onNext(): void {
    if (!this._canNavigate()) {
      return;
    }

    const currentStep = this._host.getCurrentStep();
    if (currentStep === WizardStep.Start) {
      this._host.log("startup step completed");
      this.setStep(WizardStep.Connect);
      return;
    }

    if (currentStep === WizardStep.Connect) {
      const view = this._host.getView();
      const raw = view?.getInputText() ?? "";
      const dimosManager = this._host.getDimosManager();
      if (!this._host.getConnected() && raw && dimosManager) {
        dimosManager.setBaseUrl(BridgeClient.normalizeIp(raw));
      }
      if (!this._host.getConnected()) {
        this._host.getConnectionController()?.cancel("connect step skipped", true);
      } else {
        this._host.log("connect step completed");
      }
      this.setStep(WizardStep.Calibrate);
      return;
    }

    if (currentStep !== WizardStep.Calibrate) {
      return;
    }

    const calibrationState = this._host.getCalibrationState();
    const dimosManager = this._host.getDimosManager();
    const alignmentController = this._host.getAlignmentController();

    if (this._host.getAligned()) {
      this._host.finishSetup();
      return;
    }
    if (calibrationState.pendingCommit) {
      return;
    }
    if (calibrationState.mode === "manual" && calibrationState.hasCandidate) {
      if (!dimosManager?.hasBridgeConnection()) {
        const finalized = dimosManager?.finalizeOfflineManualAlignment() ?? false;
        if (!finalized) {
          calibrationState.statusMessage =
            "Could not read manual marker pose - try again";
          calibrationState.statusColor = COLOR_ERROR;
          this._host.renderCalibrationState();
          this._host.refreshFooterButtons();
          return;
        }
        dimosManager?.cancelManualAlignmentPlacement();
        this._host.setAligned(true);
        this._host.setCalibrationCompleted(true);
        calibrationState.statusMessage = "Manual alignment ready";
        calibrationState.statusColor = COLOR_SUCCESS;
        this._host.renderCalibrationState();
        this._host.refreshFooterButtons();
        this._host.log("manual local-only calibration accepted");
        this._host.finishSetup();
        return;
      }

      const captured = dimosManager?.captureManualAlignmentCandidate() ?? false;
      if (!captured) {
        calibrationState.statusMessage =
          "Could not read manual marker pose - try again";
        calibrationState.statusColor = COLOR_ERROR;
        this._host.renderCalibrationState();
        this._host.refreshFooterButtons();
        return;
      }

      if (dimosManager?.bridgeClient?.sendAlignCommit()) {
        dimosManager?.freezeManualAlignmentPlacement();
        calibrationState.pendingCommit = true;
        calibrationState.statusMessage = "Applying manual alignment…";
        calibrationState.statusColor = COLOR_WHITE;
        this._host.renderCalibrationState();
        this._host.refreshFooterButtons();
        this._host.log("manual calibration commit requested");
      } else {
        calibrationState.statusMessage =
          "Manual alignment commit failed - try again";
        calibrationState.statusColor = COLOR_ERROR;
        this._host.renderCalibrationState();
        this._host.refreshFooterButtons();
      }
      return;
    }

    if (calibrationState.hasCandidate && alignmentController?.commitBestAlignment()) {
      calibrationState.pendingCommit = true;
      calibrationState.statusMessage = "Applying best alignment…";
      calibrationState.statusColor = COLOR_WHITE;
      this._host.renderCalibrationState();
      this._host.refreshFooterButtons();
      this._host.log("calibration commit requested");
      return;
    }

    alignmentController?.setCalibrationGizmoEnabled(false);
    alignmentController?.stop();
    this._host.log("calibration step skipped");
    this._host.finishSetup();
  }

  public onPrevious(): void {
    if (!this._canNavigate()) {
      return;
    }

    const currentStep = this._host.getCurrentStep();
    if (currentStep <= WizardStep.Start) {
      return;
    }
    this.setStep((currentStep - 1) as WizardStep);
  }

  private _canNavigate(): boolean {
    const now = getTime();
    if (
      this._lastNavigationTime >= 0 &&
      now - this._lastNavigationTime < NAV_DEBOUNCE_S
    ) {
      return false;
    }
    this._lastNavigationTime = now;
    return true;
  }
}
