import { SnapOS2Styles } from "../UI/Shared/UIBuilders";
import {
  COLOR_ERROR,
  COLOR_MUTED,
  COLOR_SUCCESS,
  COLOR_WARN,
  COLOR_WHITE,
} from "../UI/Shared/UICore";
import {
  AlignmentMode,
  CalibrationPhase,
  CalibrationViewState,
  WizardFooterState,
  WizardStep,
} from "./WizardStepData";
import { AlignStatusMessage } from "../Network/Protocol";
import {
  BridgeErrorCode,
  formatBridgeError,
  formatBridgeErrorFix,
} from "./BridgeErrorCodes";

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
}

const EMPTY_DISPLAY: CalibrationDisplayModel = {
  accuracyText: "",
  accuracyColor: COLOR_WHITE,
  statusText: "",
  statusColor: COLOR_WHITE,
  detailText: "",
};

export function createCalibrationViewState(): CalibrationViewState {
  return {
    mode: "auto",
    phase: "editing",
    spectaclesTracking: false,
    robotTracking: false,
    observationCount: 0,
    currentQuality: null,
    bestQuality: null,
    statusMessage: "",
    statusColor: COLOR_WHITE,
    bridgeWaitStartedAt: null,
    bridgeErrorCode: null,
  };
}

export function createManualCalibrationState(
  phase: CalibrationPhase = "editing",
): CalibrationViewState {
  return {
    ...createCalibrationViewState(),
    mode: "manual",
    phase,
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
    state.bridgeErrorCode === null
  );
}

function markerVisibilityLabel(tracking: boolean): string {
  return tracking ? "✅" : "❌";
}

function buildAutoProgressDetail(state: CalibrationViewState): string {
  const bestLabel =
    state.bestQuality !== null
      ? `${Math.round(state.bestQuality * 100)}%`
      : "none yet";
  return (
    `Tag: ${markerVisibilityLabel(state.spectaclesTracking)}\n` +
    `Samples: ${state.observationCount}\n` +
    `Best: ${bestLabel}`
  );
}

export function buildCalibrationDisplay(
  state: CalibrationViewState,
  hasBridgeConnection: boolean,
): CalibrationDisplayModel {
  if (state.bridgeErrorCode !== null) {
    const fix = formatBridgeErrorFix(state.bridgeErrorCode);
    const errorLine = formatBridgeError(state.bridgeErrorCode);
    return {
      ...EMPTY_DISPLAY,
      statusText: fix ? `${errorLine}\n${fix}` : errorLine,
      statusColor: COLOR_ERROR,
    };
  }

  if (isManualBridgeWait(state, hasBridgeConnection)) {
    const elapsed = getTime() - (state.bridgeWaitStartedAt ?? getTime());
    const secs = Math.max(1, Math.floor(elapsed));
    return {
      ...EMPTY_DISPLAY,
      statusText: `Waiting for bridge… ${secs} s`,
      statusColor: COLOR_WARN,
    };
  }

  if (state.mode === "auto") {
    return {
      ...EMPTY_DISPLAY,
      statusText: buildAutoProgressDetail(state),
      statusColor: COLOR_MUTED,
    };
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
    centerNext: step === WizardStep.Start || step === WizardStep.Calibrate,
    widePrevOffset: step === WizardStep.Calibrate,
  };
}

function alignFailureErrorCode(message: string | undefined): BridgeErrorCode {
  if (message && message.includes("No valid alignment")) {
    return BridgeErrorCode.AlignCommitNoCandidate;
  }
  if (message && message.includes("No camera intrinsics")) {
    return BridgeErrorCode.CameraInfoMissing;
  }
  return BridgeErrorCode.AlignFailed;
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
    phase:
      shouldApplyDetectingBridgeCandidate && msg.has_candidate !== undefined
        ? msg.has_candidate
          ? "ready"
          : "editing"
        : state.phase,
  };

  if (shouldApplyDetectingBridgeCandidate && msg.has_candidate) {
    nextState.bridgeWaitStartedAt = null;
    nextState.bridgeErrorCode = null;
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
      bridgeErrorCode: null,
    };
  }

  if (msg.state === "failed") {
    return {
      ...nextState,
      phase: "editing",
      statusMessage: "",
      statusColor: COLOR_ERROR,
      bridgeWaitStartedAt: null,
      bridgeErrorCode: alignFailureErrorCode(msg.message),
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

export function calibrationModeLabel(mode: AlignmentMode): string {
  return mode === "manual" ? "manual" : "auto";
}
