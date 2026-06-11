// ================================================================
/** XR bridge client error codes — keep in sync with dimos-xr/dimos_xr/error_codes.py */
// ================================================================

export enum BridgeErrorCode {
  ManualPoseInvalid = 400,
  AlignCommitNoCandidate = 409,
  AlignFailed = 500,
  BridgeDisconnectedDuringCommit = 502,
  AlignSessionUnavailable = 503,
  ManualPoseConfirmTimeout = 504,
  NavGoalStalled = 505,
  CameraCaptureFailed = 506,
  CameraInfoMissing = 507,
}

export interface BridgeErrorInfo {
  description: string;
  fix: string | null;
}

export const BRIDGE_ERROR_CATALOG: Record<number, BridgeErrorInfo> = {
  [BridgeErrorCode.ManualPoseInvalid]: {
    description:
      "Spectacles could not read the manual robot marker pose, finalize offline placement, start manual placement, or send the alignment commit to the bridge.",
    fix: "Re-grab the marker below the panel and try Complete again.",
  },
  [BridgeErrorCode.AlignCommitNoCandidate]: {
    description:
      "The bridge rejected align_commit because no valid calibration candidate was available yet.",
    fix: "Wait for bridge confirmation or restart the robot and bridge (./start.sh).",
  },
  [BridgeErrorCode.AlignFailed]: {
    description: "Marker or manual alignment failed on the bridge.",
    fix: "Retry calibration; restart the robot and bridge (./start.sh) if it persists.",
  },
  [BridgeErrorCode.BridgeDisconnectedDuringCommit]: {
    description: "The WebSocket disconnected while Spectacles was applying alignment.",
    fix: "Reconnect Spectacles to the bridge and retry calibration.",
  },
  [BridgeErrorCode.AlignSessionUnavailable]: {
    description: "The bridge could not start an alignment session after align_start.",
    fix: "Restart the robot and bridge (./start.sh), then reconnect Spectacles.",
  },
  [BridgeErrorCode.ManualPoseConfirmTimeout]: {
    description:
      "Spectacles sent manual placement updates but the bridge never confirmed a calibration candidate within 5 seconds.",
    fix: "Restart the robot and bridge (./start.sh), then reconnect Spectacles.",
  },
  [BridgeErrorCode.NavGoalStalled]: {
    description:
      "Navigation stopped responding after automatic recovery attempts. The robot did not start moving or publish a path for the goal.",
    fix: "Reconnect Spectacles to the bridge or restart the robot and bridge (./start.sh).",
  },
  [BridgeErrorCode.CameraCaptureFailed]: {
    description: "Spectacles failed to capture a still image from the camera.",
    fix: "Re-launch the Lens, confirm camera permission, and ensure Experimental APIs are enabled.",
  },
  [BridgeErrorCode.CameraInfoMissing]: {
    description: "The bridge did not receive camera intrinsics before processing frames.",
    fix: "Reconnect to the bridge and retry calibration.",
  },
};

export function formatBridgeError(code: number): string {
  const info = BRIDGE_ERROR_CATALOG[code];
  if (!info) {
    return `Bridge Error (${code})`;
  }
  return `Bridge Error (${code}): ${info.description}`;
}

export function formatBridgeErrorFix(code: number): string {
  return BRIDGE_ERROR_CATALOG[code]?.fix ?? "";
}
