// ================================================================
/**
 * Single ingress merge and egress projection for registration session UI.
 */
// ================================================================

import {
  RegistrationMode,
  RegistrationState,
  RegistrationStatusMessage,
} from "../../ARBridge/Network/Protocol";
import { COLOR_ERROR, COLOR_SUCCESS, COLOR_WHITE, SnapOS2Styles } from "../UI/UIKit";

export type RegistrationStep = "startRobot" | "connectBridge" | "registerRobot";

export const REGISTRATION_STEP_TITLES: Record<RegistrationStep, string> = {
  startRobot: "Start Robot & Bridge",
  connectBridge: "Connect",
  registerRobot: "Registration",
};

export const REGISTRATION_STEP_DESCRIPTIONS: Record<RegistrationStep, string> = {
  startRobot: "Power on your robot.\nRun ./scripts/start.sh on your Mac.",
  connectBridge:
    "Enter your Mac's IP.\nUse same Wi‑Fi for robot, Mac, and Spectacles.",
  registerRobot: "",
};

export type RegistrationFailure = { detail: string };

export interface RegistrationSessionView {
  mode: RegistrationMode;
  state: RegistrationState;
  statusDetail: string;
  failure: RegistrationFailure | null;
  tagVisible: boolean;
  progress?: number;
  previewPose?: RegistrationStatusMessage["preview_pose"];
  scaleLocked?: boolean;
  registrationConfidence?: number;
}

export interface RegistrationPresentation {
  panelStatusText: string;
  panelStatusColor: vec4;
  panelDetailText: string;
  footerNextLabel: string;
  footerNextEnabled: boolean;
  footerShowPrev: boolean;
  footerShowModeToggle: boolean;
  footerModeToggleLabel: string;
  overlayVisible: boolean;
  overlayTitle: string;
  overlayStatus: string;
  overlayStatusColor: vec4;
  overlayProgress: number | null;
  showManualPlacement: boolean;
  showTagScanOverlay: boolean;
  showScaleLockHint: boolean;
}

export const REGISTRATION_CONFIDENT_THRESHOLD = 0.7;
export const REGISTRATION_PROGRESS_SAMPLE_MAX = 80;
export const SCALE_LOCK_WALK_HINT =
  "Alignment set — walk the robot a few steps to lock distance";
export const REGISTRATION_STATUS_MANUAL = "Complete to confirm manual Registration";
export const NO_RESPONSE_STATUS_MSG = "Bridge not responding";

export function createRegistrationSessionView(
  mode: RegistrationMode = "april_tag",
): RegistrationSessionView {
  return {
    mode,
    state: mode === "manual_pose" ? "manual_placement" : "april_tag",
    statusDetail: "",
    failure: null,
    tagVisible: false,
  };
}

export function mergeRegistrationStatus(
  session: RegistrationSessionView,
  msg: RegistrationStatusMessage,
): RegistrationSessionView {
  const mode = msg.mode ?? session.mode;
  return {
    ...session,
    mode,
    state: msg.state,
    statusDetail: msg.message,
    failure: msg.state === "failed" ? { detail: msg.message || "Registration failed" } : null,
    tagVisible: msg.tag_visible ?? session.tagVisible,
    progress: msg.progress,
    previewPose: msg.preview_pose ?? session.previewPose,
    scaleLocked: msg.scale_locked ?? session.scaleLocked,
    registrationConfidence:
      msg.registration_confidence ?? session.registrationConfidence,
  };
}

export function isCommitPending(state: RegistrationState): boolean {
  return state === "awaiting_commit";
}

export function hasRegistrationCandidate(state: RegistrationState): boolean {
  return state === "awaiting_commit" || state === "succeeded";
}

export function isRegistrationComplete(state: RegistrationState): boolean {
  return state === "succeeded";
}

export function isRegistrationFailed(state: RegistrationState): boolean {
  return state === "failed";
}

export function registrationProgressPercent(
  session: RegistrationSessionView,
): number | null {
  if (typeof session.progress === "number" && Number.isFinite(session.progress)) {
    return Math.max(0, Math.min(100, Math.round(session.progress)));
  }
  if (session.state === "succeeded") {
    return 100;
  }
  return null;
}

export function shouldShowScaleLockHint(session: RegistrationSessionView): boolean {
  if (session.state !== "succeeded" || session.mode !== "april_tag") {
    return false;
  }
  if (session.scaleLocked === true) {
    return false;
  }
  if (
    typeof session.registrationConfidence === "number" &&
    session.registrationConfidence >= REGISTRATION_CONFIDENT_THRESHOLD
  ) {
    return false;
  }
  return session.scaleLocked === false;
}

function aprilTagTagStatus(session: RegistrationSessionView): {
  text: string;
  color: vec4;
} {
  const progress = registrationProgressPercent(session);
  if (progress !== null && progress >= REGISTRATION_PROGRESS_SAMPLE_MAX) {
    return { text: "", color: COLOR_WHITE };
  }
  return session.tagVisible
    ? { text: "✅  Tag detected - move around", color: COLOR_SUCCESS }
    : { text: "❌  Tag not visible", color: COLOR_ERROR };
}

export function projectRegistrationPresentation(
  session: RegistrationSessionView,
  ctx: { step: RegistrationStep; connected: boolean; canGoBackAtStart?: boolean },
): RegistrationPresentation {
  const showTagScanOverlay = session.state === "april_tag";
  const showManualPlacement = session.state === "manual_placement";
  const overlayProgress = registrationProgressPercent(session);
  const tagStatus = aprilTagTagStatus(session);

  let panelStatusText = "";
  let panelStatusColor = COLOR_WHITE;
  let panelDetailText = session.statusDetail || "";

  if (session.mode === "april_tag") {
    if (session.state === "succeeded") {
      panelStatusText = "Registration completed";
      panelStatusColor = COLOR_SUCCESS;
      panelDetailText = shouldShowScaleLockHint(session) ? SCALE_LOCK_WALK_HINT : "";
    } else if (session.state === "failed") {
      panelStatusText = session.failure?.detail || "Registration failed";
      panelStatusColor = COLOR_ERROR;
      panelDetailText = "Click Retry or switch to Manual pose";
    } else if (session.statusDetail === NO_RESPONSE_STATUS_MSG) {
      panelStatusText = NO_RESPONSE_STATUS_MSG;
      panelStatusColor = COLOR_ERROR;
      panelDetailText =
        "Check that ./scripts/start.sh is running, then retry or switch to Manual pose";
    } else if (showTagScanOverlay) {
      panelStatusText = tagStatus.text;
      panelStatusColor = tagStatus.color;
      if (!session.tagVisible) {
        panelDetailText = "";
      }
    } else {
      panelStatusText = tagStatus.text;
      panelStatusColor = tagStatus.color;
    }
  } else if (session.state === "failed") {
    panelStatusText = session.failure?.detail || "Registration failed";
    panelStatusColor = COLOR_ERROR;
    panelDetailText = "";
  } else {
    panelStatusText = REGISTRATION_STATUS_MANUAL;
    panelStatusColor = COLOR_SUCCESS;
    panelDetailText = "";
  }

  let footerNextLabel = "Skip";
  let footerNextEnabled = true;
  if (ctx.step === "startRobot") {
    footerNextLabel = "Complete";
  } else if (ctx.step === "connectBridge" && ctx.connected) {
    footerNextLabel = "Complete";
  } else if (ctx.step === "registerRobot") {
    if (isRegistrationFailed(session.state)) {
      footerNextLabel = "Retry";
    } else if (isCommitPending(session.state)) {
      footerNextLabel = "Completing...";
      footerNextEnabled = false;
    } else if (isRegistrationComplete(session.state)) {
      footerNextLabel =
        session.mode === "manual_pose" ? "Finishing..." : "Complete";
      footerNextEnabled = session.mode !== "manual_pose";
    } else if (hasRegistrationCandidate(session.state)) {
      footerNextLabel = "Complete";
    } else if (session.mode === "manual_pose") {
      footerNextLabel = "Complete";
    }
  }

  const overlayTitle =
    session.state === "succeeded"
      ? "Registration complete"
      : /waiting for camera intrinsics/i.test(session.statusDetail)
        ? "Starting…"
        : "Registration";

  return {
    panelStatusText,
    panelStatusColor,
    panelDetailText,
    footerNextLabel,
    footerNextEnabled,
    footerShowPrev: ctx.step !== "startRobot" || Boolean(ctx.canGoBackAtStart),
    footerShowModeToggle:
      ctx.step === "registerRobot" && !isCommitPending(session.state),
    footerModeToggleLabel:
      session.mode === "manual_pose" ? "AprilTag" : "Manual Placement",
    overlayVisible: showTagScanOverlay,
    overlayTitle,
    overlayStatus: tagStatus.text,
    overlayStatusColor: tagStatus.color,
    overlayProgress,
    showManualPlacement,
    showTagScanOverlay,
    showScaleLockHint: shouldShowScaleLockHint(session),
  };
}

export function registrationStepTitle(mode: RegistrationMode): string {
  return mode === "manual_pose"
    ? "Registration - Manual"
    : "Registration - April Tag";
}

export function buildAprilTagDescription(displayName: string): string {
  return `Look at the tag on the ${displayName}.`;
}

export const REGISTRATION_DESCRIPTION_MANUAL =
  "Manually place the marker at the robot center.";

export function formatRegistrationProgressText(percent: number): string {
  return `${Math.round(percent)}%`;
}
