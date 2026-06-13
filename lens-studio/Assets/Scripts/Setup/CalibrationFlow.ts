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
import { DimosManager } from "../Core/DimosManager";
import { AlignStatusMessage, BridgeStatusMessage } from "../Bridge/Protocol";
import { COLOR_ERROR, COLOR_SUCCESS, COLOR_WHITE, SnapOS2Styles } from "../UI/kit/UIKit";

// ── Step / calibration types ───────────────────────────────────

export enum WizardStep {
  Start = 0,
  Connect = 1,
  Calibrate = 2,
}

export const LAST_WIZARD_STEP = WizardStep.Calibrate;

export type AlignmentMode = "auto" | "manual";
export type CalibrationPhase = "editing" | "ready" | "pendingCommit" | "complete";

export interface CalibrationViewState {
  mode: AlignmentMode;
  phase: CalibrationPhase;
  progress: number;
  message: string;
  tagVisible: boolean;
  assistStage?: string;
  robotWorldPose?: { position: [number, number, number]; orientation: [number, number, number, number] };
  baselineM?: number;
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
  "Calibrate",
];

export const CALIBRATE_DESCRIPTION_AUTO =
  "Look at the AprilTag on your robot.\nStand 1-3 m away and hold steady.";

export const CALIBRATE_DESCRIPTION_MANUAL =
  "Place the marker at the robot location & rotation.\nNo April Tag needed.";

export const WIZARD_STEP_DESCRIPTIONS: string[] = [
  "Power on your robot.\nRun ./start.sh in dimos-xr on your Mac.",
  "Enter your Mac's IP.\nSame Wi‑Fi for robot, Mac, and Spectacles.",
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

// ── Display builders ───────────────────────────────────────────

const PROGRESS_BAR_WIDTH = 12;

export function buildAsciiProgressBar(pct: number, width: number = PROGRESS_BAR_WIDTH): string {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const filled = Math.round((clamped / 100) * width);
  const empty = Math.max(0, width - filled);
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${clamped}%`;
}

export function buildCalibrationDisplay(
  state: CalibrationViewState,
  _hasBridgeConnection: boolean,
): CalibrationDisplayModel {
  if (state.mode === "auto") {
    const tagStatus = state.tagVisible
      ? { text: "✅  Tag visible", color: COLOR_SUCCESS }
      : { text: "❌  Tag not visible", color: COLOR_ERROR };
    return {
      statusText: tagStatus.text,
      statusColor: tagStatus.color,
      detailText: buildAsciiProgressBar(state.progress),
      detailColor: COLOR_WHITE,
    };
  }
  let statusText = "";
  let statusColor = COLOR_WHITE;
  let detailText = "";
  switch (state.phase) {
    case "editing":
      statusText = state.message || "Place the marker at the robot position.";
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
      case "failed": phase = "editing"; break;
    }
  } else if (msg.state === "aligned") {
    phase = "complete";
  } else if (msg.state === "failed") {
    phase = "editing";
  }
  return {
    ...state,
    phase,
    progress: msg.progress,
    message: msg.message || state.message,
    tagVisible: msg.tag_visible ?? state.tagVisible,
    assistStage: msg.assist_stage ?? state.assistStage,
    robotWorldPose: msg.robot_world_pose ?? state.robotWorldPose,
    baselineM: msg.baseline_m ?? state.baselineM,
  };
}

export function getWizardFooterState(
  step: WizardStep,
  connected: boolean,
  calibrationState: CalibrationViewState,
): WizardFooterState {
  let nextLabel = "Skip";
  let nextStyle = SnapOS2Styles.Ghost;
  let nextInactive = false;

  if (step === WizardStep.Start) {
    nextLabel = "Complete";
    nextStyle = SnapOS2Styles.Primary;
  } else if (step === WizardStep.Connect && connected) {
    nextLabel = "Complete";
    nextStyle = SnapOS2Styles.Primary;
  } else if (step === WizardStep.Calibrate) {
    if (isCalibrationPendingCommit(calibrationState)) {
      nextLabel = "Completing...";
      nextInactive = true;
    } else if (isCalibrationComplete(calibrationState)) {
      nextLabel = "Complete";
      nextStyle = SnapOS2Styles.Primary;
    } else if (calibrationState.assistStage === "awaiting_confirm") {
      // Robot-assisted flow: offer Continue to confirm the robot move
      nextLabel = "Continue";
      nextStyle = SnapOS2Styles.Primary;
    } else if (calibrationState.assistStage && calibrationState.assistStage !== "done") {
      // Assist flow in progress (estimating/countdown/collect/move/settle) — inactive Continue
      nextLabel = "Continue";
      nextInactive = true;
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
    manualLabel: calibrationState.mode === "manual" ? "Use marker align" : "Align manually",
    manualStyle: SnapOS2Styles.PrimaryNeutral,
    centerNext: step === WizardStep.Start || step === WizardStep.Calibrate,
    widePrevOffset: step === WizardStep.Calibrate,
  };
}

// ── CalibrationFlow class ──────────────────────────────────────

const MANUAL_CANDIDATE_SYNC_INTERVAL_S = 0.35;
const ALIGN_STATUS_LOG_INTERVAL_S = 1.0;
const NO_RESPONSE_STATUS_MSG = "No response from bridge";

export interface CalibrationFlowCallbacks {
  beginManualAlignmentPlacementFromWizard: () => boolean;
  render: () => void;
  refreshFooter: () => void;
  refreshDescription: () => void;
  log: (message: string) => void;
  finishSetup: () => void;
}

export class CalibrationFlow {
  private _state: CalibrationViewState = createCalibrationViewState();
  private _lastManualCandidateSyncTime = -1;
  private _lastAlignStatusLogTime = -1;
  private _lastLoggedAlignStatusKey = "";
  private _commitInFlight = false;

  constructor(
    private readonly _dimosManager: DimosManager,
    private readonly _alignmentSession: AlignmentSession | null,
    private readonly _callbacks: CalibrationFlowCallbacks,
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
    return this._dimosManager.preferredCalibrationMode() === "manualOnly";
  }

  public enter(): void {
    const preferredMode = this._dimosManager.preferredCalibrationMode();
    if (preferredMode === "manualOnly") {
      this._beginManualMode();
      return;
    }
    this._beginAutoMode();
  }

  public leave(): void {
    this._commitInFlight = false;
    this._lastManualCandidateSyncTime = -1;
    this._alignmentSession?.stop();
    this._dimosManager.cancelManualAlignmentPlacement();
    this._dimosManager.clearManualAlignmentPose();
    this._dimosManager.hideRobotMarkerPreview();
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

    if (msg.state === "failed") {
      this._commitInFlight = false;
      this._callbacks.log(`alignment failed on bridge: ${msg.message || "unknown reason"}`);
      if (this._state.mode === "manual") {
        this._dimosManager.hideRobotMarkerPreview();
      }
    } else if (msg.state === "aligned") {
      this._tryAutoFinishSetup();
    }
    this._notify();
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
      this._dimosManager.cancelManualAlignmentPlacement();
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
      this._dimosManager.hasBridgeConnection()
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
      !this._dimosManager.hasBridgeConnection()
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
    this._dimosManager.captureManualAlignmentCandidate();
  }

  // ── Private ────────────────────────────────────────────────────

  private _completeManualStep(): boolean {
    if (!this._dimosManager.hasBridgeConnection()) {
      const finalized = this._dimosManager.finalizeOfflineManualAlignment();
      if (!finalized) {
        this._callbacks.log("manual alignment: offline finalize failed — marker pose unavailable");
        this._state = { ...this._state, message: "" };
        this._notify();
        return false;
      }
      this._dimosManager.cancelManualAlignmentPlacement();
      this._state = { ...this._state, phase: "complete", message: "" };
      this._notify();
      this._callbacks.log("manual local-only calibration accepted");
      return true;
    }

    const captured = this._dimosManager.captureManualAlignmentCandidate();
    if (!captured) {
      this._callbacks.log("manual alignment: capture failed on Complete — marker pose unavailable");
      this._state = { ...this._state, message: "" };
      this._notify();
      return false;
    }

    if (this._alignmentSession?.commit()) {
      this._commitInFlight = true;
      this._dimosManager.freezeManualAlignmentPlacement();
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
    this._dimosManager.cancelManualAlignmentPlacement();
    this._dimosManager.stopManualAlignmentSession();
    this._dimosManager.clearManualAlignmentPose();
    this._dimosManager.hideRobotMarkerPreview();
    this._dimosManager.frameCaptureController?.setCaptureErrorHandler(() => {
      this._callbacks.log("auto alignment: camera capture error");
      this._state = { ...this._state, message: "" };
      this._notify();
    });
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
      this._dimosManager.cancelManualAlignmentPlacement();
      this._dimosManager.stopManualAlignmentSession();
      this._dimosManager.clearManualAlignmentPose();
      this._notify();
      return;
    }

    this._dimosManager.startManualAlignmentSession();
    this._callbacks.log("manual alignment placement started");
    this._notify();
  }

  private _logAlignStatusIfChanged(msg: AlignStatusMessage): void {
    const key = `${msg.state}|${msg.method}|${msg.progress}|${msg.message}`;
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
    if (this._commitInFlight && isCalibrationComplete(this._state)) {
      this._commitInFlight = false;
      this._callbacks.finishSetup();
    }
  }
}
