import { AlignmentController } from "../Alignment/AlignmentController";
import { DimosManager } from "../DimosManager";
import { AlignStatusMessage, BridgeStatusMessage } from "../Network/Protocol";
import { BridgeErrorCode } from "./BridgeErrorCodes";
import {
  applyAlignStatusToCalibrationState,
  createCalibrationViewState,
  createManualCalibrationState,
  hasCalibrationCandidate,
  isCalibrationComplete,
  isCalibrationPendingCommit,
  isManualBridgeWait,
  MANUAL_BRIDGE_WAIT_TIMEOUT_S,
} from "./CalibrationPresenter";
import { CalibrationViewState } from "./WizardStepData";
import { COLOR_SUCCESS, COLOR_WHITE } from "../UI/Shared/UICore";

const MANUAL_CANDIDATE_SYNC_INTERVAL_S = 0.35;

export interface CalibrationSessionHost {
  beginManualAlignmentPlacementFromWizard: () => boolean;
  render: () => void;
  refreshFooter: () => void;
  refreshDescription: () => void;
  log: (message: string) => void;
  finishSetup: () => void;
}

export class CalibrationSession {
  private _state: CalibrationViewState = createCalibrationViewState();
  private _lastManualCandidateSyncTime = -1;
  private _commitInFlight = false;

  constructor(
    private readonly _dimosManager: DimosManager,
    private readonly _alignmentController: AlignmentController | null,
    private readonly _host: CalibrationSessionHost,
  ) {}

  public get state(): CalibrationViewState {
    return this._state;
  }

  public setState(state: CalibrationViewState): void {
    this._state = state;
  }

  public isComplete(): boolean {
    return isCalibrationComplete(this._state);
  }

  public enter(): void {
    const preferredMode = this._dimosManager.preferredCalibrationMode();
    if (preferredMode === "manualOnly") {
      this._beginManualMode(false);
      return;
    }
    this._beginAutoMode();
  }

  public leave(): void {
    this._commitInFlight = false;
    this._resetManualCandidateSync();
    this._alignmentController?.setCalibrationGizmoEnabled(false);
    this._alignmentController?.stop();
    this._dimosManager.cancelManualAlignmentPlacement();
    this._dimosManager.stopManualAlignmentSession();
    this._dimosManager.clearManualAlignmentPose();
    this._dimosManager.hideRobotMarkerPreview();
  }

  public isManualOnly(): boolean {
    return this._dimosManager.preferredCalibrationMode() === "manualOnly";
  }

  public toggleMode(): void {
    if (this.isManualOnly() && this._state.mode === "manual") {
      return;
    }
    if (this._state.mode === "manual") {
      this._host.log("manual alignment disabled");
      this._beginAutoMode();
      return;
    }
    this._host.log("manual alignment enabled");
    this._beginManualMode(!this._dimosManager.hasBridgeConnection());
  }

  public completeStep(): boolean {
    if (isCalibrationComplete(this._state)) {
      return true;
    }
    if (isCalibrationPendingCommit(this._state)) {
      return false;
    }

    if (this._state.mode === "manual") {
      return this._completeManualStep();
    }

    if (hasCalibrationCandidate(this._state)) {
      if (this._alignmentController?.commitBestAlignment()) {
        this._commitInFlight = true;
        this._state = {
          ...this._state,
          phase: "pendingCommit",
          statusMessage: "",
          statusColor: COLOR_WHITE,
        };
        this._notify();
        this._host.log("calibration commit requested");
        return false;
      }
      this._state = {
        ...this._state,
        bridgeErrorCode: BridgeErrorCode.AlignSessionUnavailable,
        bridgeWaitStartedAt: null,
        statusMessage: "",
        statusColor: COLOR_WHITE,
      };
      this._notify();
      return false;
    }

    this._alignmentController?.setCalibrationGizmoEnabled(false);
    this._alignmentController?.stop();
    this._host.log("calibration step skipped");
    return true;
  }

  public handleAlignStatus(
    msg: AlignStatusMessage,
    spectaclesTracking: boolean,
  ): void {
    this._state = applyAlignStatusToCalibrationState(
      this._state,
      msg,
      spectaclesTracking,
    );

    if (msg.state === "failed") {
      this._commitInFlight = false;
      if (this._state.mode === "manual") {
        this._dimosManager.hideRobotMarkerPreview();
      }
    } else if (msg.state === "aligned") {
      this._tryAutoFinishSetup();
    }
    this._notify();
  }

  public updateSpectaclesTracking(tracking: boolean): void {
    if (this._state.mode !== "auto" || this._state.spectaclesTracking === tracking) {
      return;
    }
    this._state = {
      ...this._state,
      spectaclesTracking: tracking,
    };
    this._host.render();
  }

  public handleBridgeConnectionChanged(connected: boolean): void {
    if (!connected) {
      this._state = {
        ...this._state,
        bridgeWaitStartedAt: null,
      };
      if (isCalibrationPendingCommit(this._state)) {
        this._commitInFlight = false;
        this._state = {
          ...this._state,
          phase: "editing",
          statusMessage: "",
          statusColor: COLOR_WHITE,
          bridgeErrorCode: BridgeErrorCode.BridgeDisconnectedDuringCommit,
        };
        this._notify();
      }
      return;
    }
  }

  public handleBridgeStatus(msg: BridgeStatusMessage): void {
    if (isCalibrationPendingCommit(this._state) && msg.registered) {
      this._dimosManager.cancelManualAlignmentPlacement();
      this._state = {
        ...this._state,
        phase: "complete",
        statusMessage: "",
        statusColor: COLOR_SUCCESS,
        bridgeWaitStartedAt: null,
        bridgeErrorCode: null,
      };
      this._notify();
      this._host.log("alignment confirmed via bridge_status fallback");
      this._tryAutoFinishSetup();
    }
  }

  public tick(): void {
    let needsRender = false;

    if (
      isManualBridgeWait(this._state, this._dimosManager.hasBridgeConnection())
    ) {
      const elapsed = getTime() - (this._state.bridgeWaitStartedAt ?? getTime());
      if (elapsed >= MANUAL_BRIDGE_WAIT_TIMEOUT_S) {
        this._state = {
          ...this._state,
          bridgeErrorCode: BridgeErrorCode.ManualPoseConfirmTimeout,
          bridgeWaitStartedAt: null,
        };
        this._host.refreshFooter();
      }
      needsRender = true;
    }

    if (
      this._state.mode !== "manual" ||
      isCalibrationPendingCommit(this._state) ||
      isCalibrationComplete(this._state) ||
      !this._dimosManager.hasBridgeConnection()
    ) {
      this._resetManualCandidateSync();
      if (needsRender) {
        this._host.render();
      }
      return;
    }

    const now = getTime();
    if (
      this._lastManualCandidateSyncTime >= 0 &&
      now - this._lastManualCandidateSyncTime < MANUAL_CANDIDATE_SYNC_INTERVAL_S
    ) {
      if (needsRender) {
        this._host.render();
      }
      return;
    }

    this._lastManualCandidateSyncTime = now;
    this._dimosManager.captureManualAlignmentCandidate();
    if (needsRender) {
      this._host.render();
    }
  }

  private _completeManualStep(): boolean {
    if (
      this._dimosManager.hasBridgeConnection() &&
      !hasCalibrationCandidate(this._state)
    ) {
      this._state = {
        ...this._state,
        bridgeWaitStartedAt: this._state.bridgeWaitStartedAt ?? getTime(),
        bridgeErrorCode: null,
        statusMessage: "",
        statusColor: COLOR_WHITE,
      };
      this._notify();
      return false;
    }

    if (!this._dimosManager.hasBridgeConnection()) {
      const finalized = this._dimosManager.finalizeOfflineManualAlignment();
      if (!finalized) {
        this._state = {
          ...this._state,
          bridgeErrorCode: BridgeErrorCode.ManualPoseInvalid,
          bridgeWaitStartedAt: null,
          statusMessage: "",
          statusColor: COLOR_WHITE,
        };
        this._notify();
        return false;
      }
      this._dimosManager.cancelManualAlignmentPlacement();
      this._state = {
        ...this._state,
        phase: "complete",
        statusMessage: "",
        statusColor: COLOR_SUCCESS,
        bridgeWaitStartedAt: null,
        bridgeErrorCode: null,
      };
      this._notify();
      this._host.log("manual local-only calibration accepted");
      return true;
    }

    const captured = this._dimosManager.captureManualAlignmentCandidate();
    if (!captured) {
      this._state = {
        ...this._state,
        bridgeErrorCode: BridgeErrorCode.ManualPoseInvalid,
        bridgeWaitStartedAt: null,
        statusMessage: "",
        statusColor: COLOR_WHITE,
      };
      this._notify();
      return false;
    }

    if (this._dimosManager.bridgeClient?.sendAlignCommit()) {
      this._commitInFlight = true;
      this._dimosManager.freezeManualAlignmentPlacement();
      this._state = {
        ...this._state,
        phase: "pendingCommit",
        statusMessage: "",
        statusColor: COLOR_WHITE,
        bridgeWaitStartedAt: null,
      };
      this._notify();
      this._host.log("manual calibration commit requested");
      return false;
    }

    this._state = {
      ...this._state,
      bridgeErrorCode: BridgeErrorCode.ManualPoseInvalid,
      bridgeWaitStartedAt: null,
      statusMessage: "",
      statusColor: COLOR_WHITE,
    };
    this._notify();
    return false;
  }

  private _beginAutoMode(): void {
    this._commitInFlight = false;
    this._resetManualCandidateSync();
    this._state = createCalibrationViewState();
    this._dimosManager.cancelManualAlignmentPlacement();
    this._dimosManager.stopManualAlignmentSession();
    this._dimosManager.clearManualAlignmentPose();
    this._dimosManager.hideRobotMarkerPreview();
    this._alignmentController?.setCalibrationGizmoEnabled(true);
    this._alignmentController?.start();
    this._notify(true);
  }

  private _beginManualMode(offlineReady: boolean): void {
    this._commitInFlight = false;
    this._resetManualCandidateSync();
    this._alignmentController?.setCalibrationGizmoEnabled(false);
    this._alignmentController?.stop();
    this._state = createManualCalibrationState(offlineReady ? "ready" : "editing");
    this._host.refreshDescription();

    if (!this._host.beginManualAlignmentPlacementFromWizard()) {
      this._state = {
        ...this._state,
        phase: "editing",
        bridgeErrorCode: BridgeErrorCode.ManualPoseInvalid,
        bridgeWaitStartedAt: null,
        statusMessage: "",
        statusColor: COLOR_WHITE,
      };
      this._dimosManager.cancelManualAlignmentPlacement();
      this._dimosManager.stopManualAlignmentSession();
      this._dimosManager.clearManualAlignmentPose();
      this._notify();
      return;
    }

    if (this._dimosManager.hasBridgeConnection()) {
      if (!this._dimosManager.startManualAlignmentSession()) {
        this._state = {
          ...this._state,
          bridgeErrorCode: BridgeErrorCode.AlignSessionUnavailable,
          bridgeWaitStartedAt: null,
          statusMessage: "",
          statusColor: COLOR_WHITE,
        };
      } else if (!offlineReady) {
        this._state = {
          ...this._state,
          bridgeWaitStartedAt: getTime(),
          bridgeErrorCode: null,
          statusMessage: "",
          statusColor: COLOR_WHITE,
        };
      }
    }
    this._notify();
  }

  private _notify(refreshDescription: boolean = false): void {
    if (refreshDescription) {
      this._host.refreshDescription();
    }
    this._host.render();
    this._host.refreshFooter();
  }

  private _resetManualCandidateSync(): void {
    this._lastManualCandidateSyncTime = -1;
  }

  private _tryAutoFinishSetup(): void {
    if (this._commitInFlight && isCalibrationComplete(this._state)) {
      this._commitInFlight = false;
      this._host.finishSetup();
    }
  }
}
