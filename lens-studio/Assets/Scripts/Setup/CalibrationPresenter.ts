import { SnapOS2Styles } from "../UI/Shared/UIBuilders";
import {
  COLOR_ERROR,
  COLOR_SUCCESS,
  COLOR_WARN,
  COLOR_WHITE,
} from "../UI/Shared/UICore";
import {
  AlignmentMode,
  CalibrationViewState,
  WizardFooterState,
  WizardStep,
} from "./WizardStepData";
import { AlignStatusMessage } from "../Network/Protocol";

// ================================================================
/** Pure functions mapping AlignStatusMessage into wizard display and footer state. */
// ================================================================

export interface CalibrationDisplayModel {
  accuracyText: string;
  accuracyColor: vec4;
  statusText: string;
  statusColor: vec4;
  detailText: string;
}

export function createCalibrationViewState(): CalibrationViewState {
  return {
    mode: "auto",
    spectaclesTracking: false,
    robotTracking: false,
    currentQuality: null,
    bestQuality: null,
    hasCandidate: false,
    pendingCommit: false,
    statusMessage: "Searching for calibration marker",
    statusColor: COLOR_WHITE,
  };
}

export function createManualCalibrationState(): CalibrationViewState {
  return {
    ...createCalibrationViewState(),
    mode: "manual",
    hasCandidate: true,
    statusMessage: "Grab the robot marker below the panel and place it on the robot",
    statusColor: COLOR_WHITE,
  };
}

export function qualityColor(quality: number | null): vec4 {
  if (quality === null || quality <= 0) {
    return COLOR_ERROR;
  }
  if (quality >= 0.9) {
    return COLOR_SUCCESS;
  }
  return COLOR_WARN;
}

export function compactAlignMessage(message: string): string {
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

export function markerVisibilityLabel(tracking: boolean): string {
  return tracking ? "visible" : "not visible";
}

export function buildCalibrationDisplay(
  state: CalibrationViewState,
  hasBridgeConnection: boolean,
): CalibrationDisplayModel {
  if (state.mode === "manual") {
    const manualReady = state.statusMessage === "Manual alignment ready";
    return {
      accuracyText: manualReady ? "Manual alignment ready" : "Manual placement",
      accuracyColor: manualReady ? COLOR_SUCCESS : COLOR_WARN,
      statusText: state.statusMessage,
      statusColor: state.statusColor,
      detailText: state.hasCandidate
        ? hasBridgeConnection
          ? "Grab and move the robot marker spawned below the panel.\nComplete to commit the assumed pose."
          : "Grab and move the robot marker spawned below the panel.\nComplete to continue with the local pose."
        : hasBridgeConnection
          ? "Reconnect or retry until the bridge alignment session starts."
          : "Grab the robot marker below the panel to position it.",
    };
  }

  const displayQuality =
    state.currentQuality !== null ? state.currentQuality : state.bestQuality;
  const percent = displayQuality !== null ? Math.round(displayQuality * 100) : 0;
  const bestLabel =
    state.bestQuality !== null
      ? `${Math.round(state.bestQuality * 100)}%`
      : "none yet";

  return {
    accuracyText: `Accuracy ${percent}%`,
    accuracyColor: qualityColor(displayQuality),
    statusText: state.statusMessage,
    statusColor: state.statusColor,
    detailText:
      `Spectacles: ${markerVisibilityLabel(state.spectaclesTracking)}\n` +
      `Robot: ${markerVisibilityLabel(state.robotTracking)}\n` +
      `Best: ${bestLabel}`,
  };
}

export function getWizardFooterState(
  step: WizardStep,
  connected: boolean,
  aligned: boolean,
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
    if (calibrationState.pendingCommit) {
      nextLabel = "Completing...";
      nextInactive = true;
    } else if (aligned || calibrationState.hasCandidate) {
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
      step === WizardStep.Calibrate && !calibrationState.pendingCommit,
    manualLabel:
      calibrationState.mode === "manual"
        ? "Use marker align"
        : "Align manually",
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
    hasCandidate:
      shouldApplyDetectingBridgeCandidate && msg.has_candidate !== undefined
        ? msg.has_candidate
        : state.hasCandidate,
  };

  if (state.mode === "auto") {
    nextState.robotTracking = msg.robot_marker_detected;
    nextState.spectaclesTracking = spectaclesTracking;
  }

  if (msg.state === "aligned") {
    return {
      ...nextState,
      pendingCommit: false,
      robotTracking: true,
      spectaclesTracking: true,
      statusMessage:
        msg.quality !== undefined
          ? `Alignment locked at ${Math.round(msg.quality * 100)}%`
          : "Alignment successful",
      statusColor: COLOR_SUCCESS,
    };
  }

  if (msg.state === "failed") {
    return {
      ...nextState,
      pendingCommit: false,
      statusMessage: msg.message || "Alignment failed - try again",
      statusColor: COLOR_ERROR,
    };
  }

  if (state.mode === "manual" && msg.method !== "manual") {
    return nextState;
  }

  const nextStatusMessage =
    state.mode === "manual"
      ? msg.message || "Manual robot pose ready"
      : compactAlignMessage(msg.message || "Searching for calibration marker");

  const nextStatusColor =
    state.mode === "manual"
      ? nextState.hasCandidate
        ? COLOR_SUCCESS
        : COLOR_WHITE
      : nextState.hasCandidate
        ? COLOR_SUCCESS
        : nextState.spectaclesTracking || nextState.robotTracking
          ? COLOR_WARN
          : COLOR_WHITE;

  return {
    ...nextState,
    statusMessage: nextStatusMessage,
    statusColor: nextStatusColor,
  };
}

export function calibrationModeLabel(mode: AlignmentMode): string {
  return mode === "manual" ? "manual" : "auto";
}
