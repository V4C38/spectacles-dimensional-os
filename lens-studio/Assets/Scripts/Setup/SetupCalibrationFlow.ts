// ================================================================
/**
 * Calibration-step state machine + display builders.
 *
 * Merges CalibrationSession + CalibrationPresenter (P3).
 * Constructor takes concrete refs — no deps-lambda bundle.
 * Exports all step/calibration types previously in WizardStepData.
 */
// ================================================================

import { AlignmentSession } from "../Alignment/AlignmentSession";
import { BridgeRuntime } from "../Bridge/BridgeRuntime";
import { FrameCaptureController } from "../Alignment/FrameCaptureController";
import { RobotRuntime } from "../Robot/RobotRuntime";
import { SetupAlignmentPreview } from "./SetupAlignmentPreview";
import { AlignStatusMessage, BridgeStatusMessage } from "../Bridge/Protocol";
import { COLOR_ERROR, COLOR_SUCCESS, COLOR_WHITE,COLOR_WARN, SnapOS2Styles } from "../UI/kit/UIKit";
import {
  buildAssistPreviewPresentation,
  isAssistPreviewStage,
} from "./SetupAlignmentPreview";

// ── Step / calibration types ───────────────────────────────────

export enum WizardStep {
  Start = 0,
  Connect = 1,
  Calibrate = 2,
}

export const LAST_WIZARD_STEP = WizardStep.Calibrate;

export type AlignmentMode = "auto" | "manual";
export type CalibrationPhase = "editing" | "ready" | "pendingCommit" | "complete" | "failed";

export interface CalibrationViewState {
  mode: AlignmentMode;
  phase: CalibrationPhase;
  progress: number;
  message: string;
  tagVisible: boolean;
  assistStage?: string;
  robotWorldPose?: { position: [number, number, number]; orientation: [number, number, number, number] };
  stepIndex?: number;
  stepCount?: number;
}

export interface WizardFooterState {
  nextLabel: string;
  nextStyle: string;
  nextInactive: boolean;
  showPrev: boolean;
  showManual: boolean;
  manualLabel: string;
  manualStyle: string;
  centerNext: boolean;
  widePrevOffset: boolean;
}

export interface CalibrationDisplayModel {
  statusText: string;
  statusColor: vec4;
  detailText: string;
  detailColor: vec4;
}

export const WIZARD_STEP_TITLES: string[] = [
  "Start Robot & Bridge",
  "Connect",
  "Calibration",
];

export const CALIBRATE_DESCRIPTION_AUTO =
  "Look at the AprilTag on your robot to start calibration.";

export const CALIBRATE_DESCRIPTION_MANUAL =
  "Place the marker at the robot position.";

export const WIZARD_STEP_DESCRIPTIONS: string[] = [
  "Power on your robot.\nRun ./start.sh in dimos-xr on your Mac.",
  "Enter your Mac's IP.\nUse same Wi‑Fi for robot, Mac, and Spectacles.",
  CALIBRATE_DESCRIPTION_AUTO,
];

export function wizardStepName(step: WizardStep): string {
  switch (step) {
    case WizardStep.Start: return "start";
    case WizardStep.Connect: return "connect";
    case WizardStep.Calibrate: return "calibrate";
    default: return "unknown";
  }
}

// ── Pure state helpers ─────────────────────────────────────────

export function createCalibrationViewState(): CalibrationViewState {
  return { mode: "auto", phase: "editing", progress: 0, message: "", tagVisible: false };
}

export function createManualCalibrationState(
  phase: CalibrationPhase = "editing",
): CalibrationViewState {
  return { mode: "manual", phase, progress: 0, message: "", tagVisible: false };
}

export function hasCalibrationCandidate(state: CalibrationViewState): boolean {
  return state.phase === "ready" || state.phase === "complete";
}

export function isCalibrationPendingCommit(state: CalibrationViewState): boolean {
  return state.phase === "pendingCommit";
}

export function isCalibrationComplete(state: CalibrationViewState): boolean {
  return state.phase === "complete";
}

export function isCalibrationFailed(state: CalibrationViewState): boolean {
  return state.phase === "failed";
}

// ── Display builders ───────────────────────────────────────────

export function buildCalibrationDisplay(
  state: CalibrationViewState,
  _hasBridgeConnection: boolean,
): CalibrationDisplayModel {
  if (state.mode === "auto") {
    if (state.phase === "complete") {
      return {
        statusText: "Calibration completed",
        statusColor: COLOR_SUCCESS,
        detailText: "",
        detailColor: COLOR_WHITE,
      };
    }
    if (state.phase === "failed") {
      return {
        statusText: state.message || "Calibration failed",
        statusColor: COLOR_ERROR,
        detailText: "Tap Redo to retry",
        detailColor: COLOR_WHITE,
      };
    }
    const tagStatus = state.tagVisible
      ? { text: "✅  Tag visible", color: COLOR_SUCCESS }
      : { text: "❌  Tag not visible", color: COLOR_ERROR };

    if (isAssistPreviewStage(state.assistStage)) {
      const presentation = buildAssistPreviewPresentation({
        assistStage: state.assistStage,
        progress: state.progress,
        tagVisible: state.tagVisible,
      });
      return {
        statusText: presentation.titleText,
        statusColor: COLOR_WHITE,
        detailText: presentation.statusText,
        detailColor: presentation.statusColor,
      };
    }

    let detailText: string;
    if (state.stepIndex !== undefined && state.stepCount !== undefined) {
      const label = state.stepIndex === 1 ? "Pre-alignment" : "Calibration";
      detailText = `Step ${state.stepIndex}/${state.stepCount}: ${label} (${Math.max(
        0,
        Math.min(100, Math.round(state.progress)),
      )}%)`;
    } else {
      detailText = `Calibrating: ${Math.max(0, Math.min(100, Math.round(state.progress)))}%`;
    }
    return {
      statusText: tagStatus.text,
      statusColor: tagStatus.color,
      detailText,
      detailColor: COLOR_WHITE,
    };
  }
  let statusText = "";
  let statusColor = COLOR_WHITE;
  let detailText = "";
  switch (state.phase) {
    case "editing":
      statusText = state.message || "Low accuracy \n  Introduces drift over long distances";
      statusColor = COLOR_WARN;
      break;
    case "ready":
      statusText = "Ready — tap Complete to commit.";
      statusColor = COLOR_SUCCESS;
      detailText = state.message;
      break;
    case "pendingCommit":
      statusText = "Committing…";
      break;
    case "complete":
      statusText = "Aligned.";
      statusColor = COLOR_SUCCESS;
      break;
    case "failed":
      statusText = state.message || "Calibration failed";
      statusColor = COLOR_ERROR;
      break;
  }
  return { statusText, statusColor, detailText, detailColor: COLOR_WHITE };
}

export function applyAlignStatusToCalibrationState(
  state: CalibrationViewState,
  msg: AlignStatusMessage,
): CalibrationViewState {
  if (state.mode === "auto" && msg.method !== "tag") return state;
  if (state.mode === "manual" && msg.method !== "manual") return state;

  let phase: CalibrationPhase = state.phase;
  if (state.phase !== "pendingCommit" && state.phase !== "complete") {
    switch (msg.state) {
      case "detecting": phase = "editing"; break;
      case "ready": phase = "ready"; break;
      case "aligned": phase = "complete"; break;
      case "failed": phase = "failed"; break;
    }
  } else if (msg.state === "aligned") {
    phase = "complete";
  } else if (msg.state === "failed") {
    phase = "failed";
  }
  return {
    ...state,
    phase,
    progress: msg.progress,
    message: msg.message || state.message,
    tagVisible: msg.tag_visible ?? state.tagVisible,
    assistStage: msg.state === "aligned" || msg.state === "failed" ? undefined : (msg.assist_stage ?? state.assistStage),
    robotWorldPose: msg.robot_world_pose ?? state.robotWorldPose,
    stepIndex: msg.state === "aligned" || msg.state === "failed" ? undefined : (msg.step_index ?? state.stepIndex),
    stepCount: msg.step_count ?? state.stepCount,
  };
}

export function getWizardFooterState(
  step: WizardStep,
  connected: boolean,
  calibrationState: CalibrationViewState,
): WizardFooterState {
  let nextLabel = "Skip";
  let nextStyle = SnapOS2Styles.PrimaryNeutral;
  let nextInactive = false;

  if (step === WizardStep.Start) {
    nextLabel = "Complete";
    nextStyle = SnapOS2Styles.Primary;
  } else if (step === WizardStep.Connect && connected) {
    nextLabel = "Complete";
    nextStyle = SnapOS2Styles.Primary;
  } else if (step === WizardStep.Calibrate) {
    if (isCalibrationFailed(calibrationState)) {
      // Align failed — offer a Redo button which restarts the auto session
      nextLabel = "Redo";
      nextStyle = SnapOS2Styles.PrimaryNeutral;
    } else if (isCalibrationPendingCommit(calibrationState)) {
      nextLabel = "Completing...";
      nextInactive = true;
    } else if (isCalibrationComplete(calibrationState)) {
      nextLabel = "Complete";
      nextStyle = SnapOS2Styles.Primary;
    } else if (calibrationState.assistStage === "awaiting_confirm") {
      // Robot-assisted flow: offer Continue to confirm the robot move
      nextLabel = "Continue";
      nextStyle = SnapOS2Styles.PrimaryNeutral;
    } else if (hasCalibrationCandidate(calibrationState)) {
      nextLabel = "Complete";
      nextStyle = SnapOS2Styles.Primary;
    } else if (calibrationState.mode === "manual") {
      // Manual placement commits via Complete even while still editing.
      nextLabel = "Complete";
      nextStyle = SnapOS2Styles.Primary;
    }
  }

  return {
    nextLabel,
    nextStyle,
    nextInactive,
    showPrev: step !== WizardStep.Start,
    showManual:
      step === WizardStep.Calibrate && !isCalibrationPendingCommit(calibrationState),
    manualLabel: calibrationState.mode === "manual" ? "Marker align" : "Manual align",
    manualStyle: SnapOS2Styles.PrimaryNeutral,
    centerNext: step === WizardStep.Start || step === WizardStep.Calibrate,
    widePrevOffset: step === WizardStep.Calibrate,
  };
}

// ── SetupCalibrationFlow class ─────────────────────────────────

const MANUAL_CANDIDATE_SYNC_INTERVAL_S = 0.35;
const ALIGN_STATUS_LOG_INTERVAL_S = 1.0;
const NO_RESPONSE_STATUS_MSG = "No response from bridge";

export interface SetupCalibrationFlowCallbacks {
  beginManualAlignmentPlacementFromWizard: () => boolean;
  render: () => void;
  refreshFooter: () => void;
  refreshDescription: () => void;
  log: (message: string) => void;
  finishSetup: () => void;
  scheduleFinishSetup: (delaySecs: number) => void;
}

export class SetupCalibrationFlow {
  private _state: CalibrationViewState = createCalibrationViewState();
  private _lastManualCandidateSyncTime = -1;
  private _lastAlignStatusLogTime = -1;
  private _lastLoggedAlignStatusKey = "";
  private _commitInFlight = false;

  constructor(
    private readonly _setupAlignmentPreview: SetupAlignmentPreview | null,
    private readonly _alignmentSession: AlignmentSession | null,
    private readonly _bridgeRuntime: BridgeRuntime | null,
    private readonly _robotRuntime: RobotRuntime | null,
    private readonly _frameCapture: FrameCaptureController | null,
    private readonly _callbacks: SetupCalibrationFlowCallbacks,
  ) {}

  public get state(): CalibrationViewState {
    return this._state;
  }

  public setState(state: CalibrationViewState): void {
    this._state = state;
  }

  public get alignmentSession(): AlignmentSession | null {
    return this._alignmentSession;
  }

  public isComplete(): boolean {
    return isCalibrationComplete(this._state);
  }

  public isManualOnly(): boolean {
    return this._alignmentSession?.preferredMode() === "manualOnly";
  }

  public enter(): void {
    const preferredMode = this._alignmentSession?.preferredMode() ?? "auto";
    if (preferredMode === "manualOnly" || !this._bridgeRuntime?.hasConnection()) {
      this._beginManualMode();
      return;
    }
    this._beginAutoMode();
  }

  public leave(): void {
    this._commitInFlight = false;
    this._lastManualCandidateSyncTime = -1;
    this._alignmentSession?.stop();
    this._alignmentSession?.cancelPlacement();
    this._alignmentSession?.clearPose();
    this._robotRuntime?.applyInteractionFromState();
  }

  public toggleMode(): void {
    if (this.isManualOnly() && this._state.mode === "manual") {
      return;
    }
    if (this._state.mode === "manual") {
      this._callbacks.log("manual alignment disabled");
      this._beginAutoMode();
      return;
    }
    this._callbacks.log("manual alignment enabled");
    this._beginManualMode();
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
      if (this._alignmentSession?.commit()) {
        this._commitInFlight = true;
        this._state = { ...this._state, phase: "pendingCommit", message: "" };
        this._notify();
        this._callbacks.log("calibration commit requested");
        return false;
      }
      this._callbacks.log("auto alignment: commit failed — alignment session unavailable");
      this._state = { ...this._state, message: "" };
      this._notify();
      return false;
    }
    this._alignmentSession?.stop();
    this._callbacks.log("calibration step skipped");
    return true;
  }

  public handleAlignStatus(msg: AlignStatusMessage): void {
    this._logAlignStatusIfChanged(msg);
    this._state = applyAlignStatusToCalibrationState(this._state, msg);
    const frameCapture = this._frameCapture;

    if (msg.state === "failed") {
      frameCapture?.setSamplingBurst(false);
      frameCapture?.setCapturePaused(false);
      this._commitInFlight = false;
      this._callbacks.log(`alignment failed on bridge: ${msg.message || "unknown reason"}`);
      if (this._state.mode === "manual") {
        this._robotRuntime?.applyInteractionFromState();
      }
      this._setupAlignmentPreview?.end();
    } else if (msg.state === "aligned") {
      frameCapture?.setSamplingBurst(false);
      frameCapture?.setCapturePaused(false);
      this._setupAlignmentPreview?.setComplete();
      this._tryAutoFinishSetup();
    } else if (this._state.mode === "auto") {
      frameCapture?.setSamplingBurst(msg.sampling === true);
      frameCapture?.setCapturePaused(
        msg.assist_stage === "move" && msg.sampling === false,
      );
      this._setupAlignmentPreview?.updateFromAlignStatus(msg);
    } else {
      frameCapture?.setSamplingBurst(false);
      frameCapture?.setCapturePaused(false);
    }
    this._notify();
  }

  /**
   * Redo: restart the auto alignment session after a failure.
   * Called by SetupWizard when the user taps the "Redo" button.
   */
  public redo(): void {
    if (!isCalibrationFailed(this._state)) {
      return;
    }
    this._callbacks.log("redo requested — restarting auto alignment");
    this._beginAutoMode();
  }

  public handleBridgeConnectionChanged(connected: boolean): void {
    if (!connected && isCalibrationPendingCommit(this._state)) {
      this._commitInFlight = false;
      this._callbacks.log("manual alignment: bridge disconnected during commit");
      this._state = { ...this._state, phase: "editing", message: "" };
      this._notify();
    }
  }

  public handleBridgeStatus(msg: BridgeStatusMessage): void {
    if (isCalibrationPendingCommit(this._state) && msg.registered) {
      this._alignmentSession?.cancelPlacement();
      this._state = { ...this._state, phase: "complete", message: "" };
      this._notify();
      this._callbacks.log("alignment confirmed via bridge_status fallback");
      this._tryAutoFinishSetup();
    }
  }

  public tick(): void {
    if (
      this._alignmentSession?.hasActiveIntent() &&
      this._alignmentSession.isNoResponseTimeout() &&
      this._bridgeRuntime?.hasConnection()
    ) {
      if (this._state.message !== NO_RESPONSE_STATUS_MSG) {
        this._state = { ...this._state, message: NO_RESPONSE_STATUS_MSG };
        this._callbacks.render();
      }
      return;
    }

    if (
      this._state.mode !== "manual" ||
      isCalibrationPendingCommit(this._state) ||
      isCalibrationComplete(this._state) ||
      !this._bridgeRuntime?.hasConnection()
    ) {
      this._lastManualCandidateSyncTime = -1;
      return;
    }

    const now = getTime();
    if (
      this._lastManualCandidateSyncTime >= 0 &&
      now - this._lastManualCandidateSyncTime < MANUAL_CANDIDATE_SYNC_INTERVAL_S
    ) {
      return;
    }
    this._lastManualCandidateSyncTime = now;
    this._alignmentSession?.captureAndSubmitManualPose();
  }

  // ── Private ────────────────────────────────────────────────────

  private _completeManualStep(): boolean {
    if (!this._bridgeRuntime?.hasConnection()) {
      const finalized = this._alignmentSession?.finalizeOffline() ?? false;
      if (!finalized) {
        this._callbacks.log("manual alignment: offline finalize failed — marker pose unavailable");
        this._state = { ...this._state, message: "" };
        this._notify();
        return false;
      }
      this._alignmentSession?.cancelPlacement();
      this._state = { ...this._state, phase: "complete", message: "" };
      this._notify();
      this._callbacks.log("manual local-only calibration accepted");
      return true;
    }

    const captured = this._alignmentSession?.captureAndSubmitManualPose() ?? false;
    if (!captured) {
      this._callbacks.log("manual alignment: capture failed on Complete — marker pose unavailable");
      this._state = { ...this._state, message: "" };
      this._notify();
      return false;
    }

    if (this._alignmentSession?.commit()) {
      this._commitInFlight = true;
      this._alignmentSession?.freezePlacement();
      this._state = { ...this._state, phase: "pendingCommit", message: "" };
      this._notify();
      this._callbacks.log("manual calibration commit requested");
      return false;
    }

    this._callbacks.log("manual alignment: align_commit send failed");
    this._state = { ...this._state, message: "" };
    this._notify();
    return false;
  }

  private _beginAutoMode(): void {
    this._commitInFlight = false;
    this._lastManualCandidateSyncTime = -1;
    this._state = createCalibrationViewState();
    this._alignmentSession?.cancelPlacement();
    this._alignmentSession?.stop();
    this._alignmentSession?.clearPose();
    this._robotRuntime?.applyInteractionFromState();
    this._frameCapture?.setCaptureErrorHandler(() => {
      this._callbacks.log("auto alignment: camera capture error");
      this._state = { ...this._state, message: "" };
      this._notify();
    });
    this._setupAlignmentPreview?.begin();
    this._alignmentSession?.start("tag", true);
    this._notify(true);
  }

  private _beginManualMode(): void {
    this._commitInFlight = false;
    this._lastManualCandidateSyncTime = -1;
    this._alignmentSession?.stop();
    this._state = createManualCalibrationState("editing");
    this._callbacks.refreshDescription();

    if (!this._callbacks.beginManualAlignmentPlacementFromWizard()) {
      this._callbacks.log("manual alignment: could not begin placement from wizard panel");
      this._state = { ...this._state, phase: "editing", message: "" };
      this._alignmentSession?.cancelPlacement();
      this._alignmentSession?.stop();
      this._alignmentSession?.clearPose();
      this._notify();
      return;
    }

    this._alignmentSession?.start("manual");
    this._callbacks.log("manual alignment placement started");
    this._notify();
  }

  private _logAlignStatusIfChanged(msg: AlignStatusMessage): void {
    // Exclude message from the dedupe key so incremental counter changes
    // (e.g. "collecting samples (1)", "collecting samples (2)") don't spam.
    const key = `${msg.state}|${msg.method}|${msg.progress}`;
    const now = getTime();
    if (
      key === this._lastLoggedAlignStatusKey &&
      now - this._lastAlignStatusLogTime < ALIGN_STATUS_LOG_INTERVAL_S
    ) {
      return;
    }
    if (
      msg.state === "aligned" ||
      msg.state === "failed" ||
      msg.state === "ready" ||
      key !== this._lastLoggedAlignStatusKey
    ) {
      this._lastLoggedAlignStatusKey = key;
      this._lastAlignStatusLogTime = now;
      this._callbacks.log(
        `align_status state=${msg.state} method=${msg.method} progress=${msg.progress} "${msg.message}"`,
      );
    }
  }

  private _notify(refreshDescription: boolean = false): void {
    if (refreshDescription) {
      this._callbacks.refreshDescription();
    }
    this._callbacks.render();
    this._callbacks.refreshFooter();
  }

  private _tryAutoFinishSetup(): void {
    // In the assisted/auto-commit path the BRIDGE commits and emits "aligned";
    // the user never taps Complete, so do not gate hands-free completion on the
    // local _commitInFlight flag. isCalibrationComplete() (phase === "complete")
    // already scopes this to a genuinely committed calibration.
    if (isCalibrationComplete(this._state)) {
      this._commitInFlight = false;
      // Show "Calibration completed" briefly before dismissing the wizard.
      this._callbacks.scheduleFinishSetup(1.5);
    }
  }
}
