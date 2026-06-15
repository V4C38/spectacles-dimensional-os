"""XR bridge client error codes surfaced in Lens setup and runtime UI."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BridgeError:
    code: int
    description: str
    fix: str | None = None


MANUAL_POSE_INVALID = BridgeError(
    code=400,
    description=(
        "Spectacles could not read the manual robot marker pose, finalize "
        "offline placement, start manual placement, or send the alignment "
        "commit to the bridge."
    ),
    fix="Re-grab the marker below the panel and try Complete again.",
)

ALIGN_COMMIT_NO_CANDIDATE = BridgeError(
    code=409,
    description=(
        "The bridge rejected align_commit because no valid calibration candidate was available yet."
    ),
    fix="Wait for bridge confirmation or restart the robot and bridge (./start.sh).",
)

ALIGN_FAILED = BridgeError(
    code=500,
    description="Marker or manual alignment failed on the bridge.",
    fix="Retry calibration; restart the robot and bridge (./start.sh) if it persists.",
)

BRIDGE_DISCONNECTED_DURING_COMMIT = BridgeError(
    code=502,
    description="The WebSocket disconnected while Spectacles was applying alignment.",
    fix="Reconnect Spectacles to the bridge and retry calibration.",
)

ALIGN_SESSION_UNAVAILABLE = BridgeError(
    code=503,
    description="The bridge could not start an alignment session after align_start.",
    fix="Restart the robot and bridge (./start.sh), then reconnect Spectacles.",
)

MANUAL_POSE_CONFIRM_TIMEOUT = BridgeError(
    code=504,
    description=(
        "Spectacles sent manual placement updates but the bridge never "
        "confirmed a calibration candidate within 5 seconds."
    ),
    fix="Restart the robot and bridge (./start.sh), then reconnect Spectacles.",
)

NAV_GOAL_STALLED = BridgeError(
    code=505,
    description=(
        "Navigation stopped responding after automatic recovery attempts. "
        "The robot did not start moving or publish a path for the goal."
    ),
    fix="Reconnect Spectacles to the bridge or restart the robot and bridge (./start.sh).",
)

CAMERA_CAPTURE_FAILED = BridgeError(
    code=506,
    description="Spectacles failed to capture or send a camera still for tag alignment.",
    fix="Retry calibration and keep the robot-mounted tag in view.",
)

CAMERA_INFO_MISSING = BridgeError(
    code=507,
    description="Spectacles did not send camera intrinsics before camera frames.",
    fix="Reconnect Spectacles to the bridge and retry calibration.",
)

CONTROL_RPC_TIMEOUT = BridgeError(
    code=508,
    description=(
        "A robot control RPC stopped responding, so the bridge could not confirm "
        "cancel-goal or emergency-stop control health."
    ),
    fix="Use the robot's hardware/controller stop path, then restart the robot and bridge (./start.sh).",
)

BRIDGE_ERRORS: dict[int, BridgeError] = {
    error.code: error
    for error in (
        MANUAL_POSE_INVALID,
        ALIGN_COMMIT_NO_CANDIDATE,
        ALIGN_FAILED,
        BRIDGE_DISCONNECTED_DURING_COMMIT,
        ALIGN_SESSION_UNAVAILABLE,
        MANUAL_POSE_CONFIRM_TIMEOUT,
        NAV_GOAL_STALLED,
        CAMERA_CAPTURE_FAILED,
        CAMERA_INFO_MISSING,
        CONTROL_RPC_TIMEOUT,
    )
}
