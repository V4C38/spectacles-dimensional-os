import { TagAlignmentSession } from "../Alignment/TagAlignmentSession";
import { BridgeClient } from "../Network/BridgeClient";
import { DimosManager } from "../DimosManager";
import { CalibrationViewState, LAST_WIZARD_STEP, WIZARD_STEP_DESCRIPTIONS, WIZARD_STEP_TITLES, WizardStep, wizardStepName } from "./WizardStepData";
import { WizardConnectionController } from "./WizardConnectionController";
import { COLOR_ERROR, COLOR_WHITE } from "../UI/Shared/UICore";
import { WizardView } from "./WizardView";

const NAV_DEBOUNCE_S = 0.35;

export interface WizardStepControllerHost {
  getCurrentStep: () => WizardStep;
  setCurrentStep: (step: WizardStep) => void;
  getConnected: () => boolean;
  getCalibrationState: () => CalibrationViewState;
  getView: () => WizardView | null;
  getDimosManager: () => DimosManager | null;
  getAlignmentController: () => TagAlignmentSession | null;
  getConnectionController: () => WizardConnectionController | null;
  log: (message: string) => void;
  showBridgeConnectionStatus: () => void;
  refreshFooterButtons: () => void;
  enterCalibration: () => void;
  leaveCalibration: () => void;
  completeCalibrationStep: () => boolean;
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

    if (clampedStep !== WizardStep.Calibrate) {
      this._host.leaveCalibration();
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
        const dimosManager = this._host.getDimosManager();
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
          view?.setStatus("Bridge disconnected", COLOR_ERROR);
          this._host.startAutoconnect();
        }
        break;
      }

      case WizardStep.Calibrate:
        view?.setInputEnabled(false);
        view?.setAccuracy("");
        view?.clearDetailStatus();
        this._host.enterCalibration();
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
    if (calibrationState.phase === "complete") {
      this._host.finishSetup();
      return;
    }
    if (calibrationState.phase === "pendingCommit") {
      return;
    }

    if (this._host.completeCalibrationStep()) {
      this._host.finishSetup();
    }
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
