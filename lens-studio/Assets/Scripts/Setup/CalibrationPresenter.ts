import { SnapOS2Styles } from "../UI/Shared/UIBuilders";
import {
  COLOR_ERROR,
  COLOR_SUCCESS,
  COLOR_WHITE,
} from "../UI/Shared/UICore";
import {
  CalibrationPhase,
  CalibrationViewState,
  WizardFooterState,
  WizardStep,
} from "./WizardStepData";
import { AlignStatusMessage } from "../Network/Protocol";

// ================================================================
/** Pure functions mapping AlignStatusMessage into wizard display and footer state. */
// ================================================================

export const MANUAL_BRIDGE_WAIT_TIMEOUT_S = 5;

export interface CalibrationDisplayModel {
  accuracyText: string;
  accuracyColor: vec4;
  statusText: string;
  statusColor: vec4;
  detailText: string;
  detailColor: vec4;
}

const EMPTY_DISPLAY: CalibrationDisplayModel = {
  accuracyText: "",
  accuracyColor: COLOR_WHITE,
  statusText: "",
  statusColor: COLOR_WHITE,
  detailText: "",
  detailColor: COLOR_WHITE,
};

const PROGRESS_BAR_WIDTH = 18;

export function buildAsciiProgressBar(pct: number, width: number = PROGRESS_BAR_WIDTH): string {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const filled = Math.round((clamped / 100) * width);
  const empty = Math.max(0, width - filled);
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${clamped}%`;
}

export function computeAlignmentProgressPct(state: CalibrationViewState): number {
  if (hasCalibrationCandidate(state) || state.phase === "complete") {
    return 100;
  }
  if (
    state.clusterSize !== null &&
    state.requiredSamples !== null &&
    state.requiredSamples > 0
  ) {
    return Math.min(
      100,
      Math.round((100 * state.clusterSize) / state.requiredSamples),
    );
  }
  return 0;
}

function buildTagVisibilityStatus(tracking: boolean): { text: string; color: vec4 } {
  return tracking
    ? { text: "✅  Tag visible", color: COLOR_SUCCESS }
    : { text: "❌  Tag not visible", color: COLOR_ERROR };
}

function buildAutoAlignmentDisplay(state: CalibrationViewState): CalibrationDisplayModel {
  const tag = buildTagVisibilityStatus(state.spectaclesTracking);
  const pct = computeAlignmentProgressPct(state);
  return {
    ...EMPTY_DISPLAY,
    statusText: tag.text,
    statusColor: tag.color,
    detailText: buildAsciiProgressBar(pct),
    detailColor: COLOR_WHITE,
  };
}

export function createCalibrationViewState(): CalibrationViewState {
  return {
    mode: "auto",
    phase: "editing",
    spectaclesTracking: false,
    robotTracking: false,
    observationCount: 0,
    baselineM: null,
    bridgeMessage: "",
    currentQuality: null,
    bestQuality: null,
    statusMessage: "",
    statusColor: COLOR_WHITE,
    bridgeWaitStartedAt: null,
    manualBridgeWaitFailed: false,
    clusterSize: null,
    requiredSamples: null,
  };
}

export function createManualCalibrationState(
  phase: CalibrationPhase = "editing",
): CalibrationViewState {
  return {
    ...createCalibrationViewState(),
    mode: "manual",
    phase,
    clusterSize: null,
    requiredSamples: null,
  };
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

export function isManualBridgeWait(
  state: CalibrationViewState,
  hasBridgeConnection: boolean,
): boolean {
  return (
    hasBridgeConnection &&
    state.mode === "manual" &&
    state.phase === "editing" &&
    !hasCalibrationCandidate(state) &&
    state.bridgeWaitStartedAt !== null &&
    !state.manualBridgeWaitFailed
  );
}

export function buildCalibrationDisplay(
  state: CalibrationViewState,
  _hasBridgeConnection: boolean,
): CalibrationDisplayModel {
  if (state.mode === "auto") {
    return buildAutoAlignmentDisplay(state);
  }

  return EMPTY_DISPLAY;
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
    } else if (hasCalibrationCandidate(calibrationState)) {
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
    manualLabel:
      calibrationState.mode === "manual"
        ? "Use marker align"
        : "Align manually",
    manualStyle: SnapOS2Styles.PrimaryNeutral,
    centerNext: step === WizardStep.Start || step === WizardStep.Calibrate,
    widePrevOffset: step === WizardStep.Calibrate,
  };
}

export function applyAlignStatusToCalibrationState(
  state: CalibrationViewState,
  msg: AlignStatusMessage,
  spectaclesTracking: boolean,
): CalibrationViewState {
  const shouldApplyDetectingBridgeCandidate =
    state.mode === "auto" || msg.method === "manual";
  const nextState: CalibrationViewState = {
    ...state,
    currentQuality:
      shouldApplyDetectingBridgeCandidate && msg.quality !== undefined
        ? msg.quality
        : state.currentQuality,
    bestQuality:
      shouldApplyDetectingBridgeCandidate && msg.best_quality !== undefined
        ? msg.best_quality
        : state.bestQuality,
    // Guard: pendingCommit/complete phases must not be downgraded by a concurrent
    // align_status. Only msg.state === "aligned" (→ complete) or "failed" (→ editing)
    // may transition out of these terminal phases; those are handled below.
    phase:
      state.phase === "pendingCommit" || state.phase === "complete"
        ? state.phase
        : shouldApplyDetectingBridgeCandidate && msg.has_candidate !== undefined
          ? msg.has_candidate
            ? "ready"
            : "editing"
          : state.phase,
    baselineM:
      msg.baseline_m !== undefined ? msg.baseline_m : state.baselineM,
    bridgeMessage: msg.message !== "" ? msg.message : state.bridgeMessage,
    // Retain last-known cluster progress when the broadcast omits these fields
    // (e.g. periodic heartbeats) to prevent flickering in the UI.
    clusterSize: msg.cluster_size !== undefined ? msg.cluster_size : state.clusterSize,
    requiredSamples:
      msg.required_samples !== undefined ? msg.required_samples : state.requiredSamples,
  };

  if (shouldApplyDetectingBridgeCandidate && msg.has_candidate) {
    nextState.bridgeWaitStartedAt = null;
    nextState.manualBridgeWaitFailed = false;
  }

  if (state.mode === "auto") {
    nextState.spectaclesTracking = msg.tag_detected;
    nextState.observationCount = msg.observation_count ?? 0;
    nextState.robotTracking = nextState.observationCount > 0;
  }

  if (msg.state === "aligned") {
    return {
      ...nextState,
      phase: "complete",
      robotTracking: true,
      spectaclesTracking: true,
      statusMessage: "",
      statusColor: COLOR_SUCCESS,
      bridgeWaitStartedAt: null,
      manualBridgeWaitFailed: false,
    };
  }

  if (msg.state === "failed") {
    return {
      ...nextState,
      phase: "editing",
      statusMessage: "",
      statusColor: COLOR_WHITE,
      bridgeWaitStartedAt: null,
      manualBridgeWaitFailed: false,
    };
  }

  if (state.mode === "manual" && msg.method !== "manual") {
    return nextState;
  }

  return {
    ...nextState,
    statusMessage: "",
    statusColor: hasCalibrationCandidate(nextState) ? COLOR_SUCCESS : COLOR_WHITE,
  };
}
