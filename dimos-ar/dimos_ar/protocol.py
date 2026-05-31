"""WebSocket JSON protocol — keep in sync with docs/PROTOCOL.md."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import NDArray

from dimos_ar.bridge_status import BridgeStatusSnapshot

PROTOCOL_VERSION = 1
ROBOT_ID = "go2"
FRAME_WORLD = "world"

DEFAULT_CAPABILITIES = ["lidar", "odom", "align", "align_manual", "nav", "path", "emergency_stop"]


def _dumps(payload: dict[str, Any]) -> str:
    return json.dumps(payload, separators=(",", ":"), allow_nan=False)


@dataclass(frozen=True)
class RegisterMessage:
    ts: float
    robot_id: str
    marker_id: int
    marker_position: tuple[float, float, float]
    marker_orientation: tuple[float, float, float, float]


@dataclass(frozen=True)
class NavGoalMessage:
    ts: float
    robot_id: str
    position: tuple[float, float, float]
    orientation: tuple[float, float, float, float] | None = None


@dataclass(frozen=True)
class CancelGoalMessage:
    ts: float
    robot_id: str


@dataclass(frozen=True)
class EmergencyStopMessage:
    ts: float
    robot_id: str


@dataclass(frozen=True)
class AlignStartMessage:
    ts: float
    robot_id: str


@dataclass(frozen=True)
class AlignStopMessage:
    ts: float
    robot_id: str


@dataclass(frozen=True)
class AlignCommitMessage:
    ts: float
    robot_id: str


@dataclass(frozen=True)
class AlignMarkerMessage:
    ts: float
    robot_id: str
    marker_position: tuple[float, float, float]
    marker_orientation: tuple[float, float, float, float]


@dataclass(frozen=True)
class AlignManualPoseMessage:
    ts: float
    robot_id: str
    position: tuple[float, float, float]
    orientation: tuple[float, float, float, float]


@dataclass(frozen=True)
class GetStatusMessage:
    ts: float
    robot_id: str


InboundMessage = (
    RegisterMessage
    | NavGoalMessage
    | CancelGoalMessage
    | EmergencyStopMessage
    | AlignStartMessage
    | AlignStopMessage
    | AlignCommitMessage
    | AlignMarkerMessage
    | AlignManualPoseMessage
    | GetStatusMessage
)


def _require_type(data: dict[str, Any], key: str, expected: type) -> Any:
    if key not in data:
        raise ValueError(f"Missing required field: {key}")
    value = data[key]
    if not isinstance(value, expected):
        raise ValueError(f"Field {key!r} must be {expected.__name__}, got {type(value).__name__}")
    return value


def _vec3(data: dict[str, Any], key: str) -> tuple[float, float, float]:
    raw = _require_type(data, key, list)
    if len(raw) != 3:
        raise ValueError(f"Field {key!r} must be a 3-element array")
    return float(raw[0]), float(raw[1]), float(raw[2])


def _quat(data: dict[str, Any], key: str) -> tuple[float, float, float, float]:
    raw = _require_type(data, key, list)
    if len(raw) != 4:
        raise ValueError(f"Field {key!r} must be a 4-element quaternion [qx, qy, qz, qw]")
    return float(raw[0]), float(raw[1]), float(raw[2]), float(raw[3])


def _parse_marker_id(data: dict[str, Any]) -> int:
    if "marker_id" not in data:
        raise ValueError("Missing required field: marker_id")
    raw = data["marker_id"]
    if isinstance(raw, bool):
        raise ValueError("Field 'marker_id' must be an integer, got bool")
    if isinstance(raw, int):
        return raw
    if isinstance(raw, float):
        if raw.is_integer():
            return int(raw)
        raise ValueError("Field 'marker_id' must be a whole number")
    raise ValueError(
        f"Field 'marker_id' must be int, got {type(raw).__name__}",
    )


def decode_inbound(text: str, *, expected_robot_id: str | None = None) -> InboundMessage:
    """Parse an inbound JSON message. Raises ValueError on malformed input."""
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("Message must be a JSON object")
    msg_type = _require_type(data, "type", str)
    if "ts" not in data or not isinstance(data["ts"], (int, float)):
        raise ValueError("Missing or invalid field: ts")
    ts = float(data["ts"])
    robot_id = str(_require_type(data, "robot_id", str))
    if expected_robot_id is not None and robot_id != expected_robot_id:
        raise ValueError(
            f"Unknown robot_id {robot_id!r}, expected {expected_robot_id!r}",
        )

    if msg_type == "register":
        return RegisterMessage(
            ts=ts,
            robot_id=robot_id,
            marker_id=_parse_marker_id(data),
            marker_position=_vec3(data, "marker_position"),
            marker_orientation=_quat(data, "marker_orientation"),
        )
    if msg_type == "nav_goal":
        orientation = _quat(data, "orientation") if "orientation" in data else None
        return NavGoalMessage(
            ts=ts,
            robot_id=robot_id,
            position=_vec3(data, "position"),
            orientation=orientation,
        )
    if msg_type == "cancel_goal":
        return CancelGoalMessage(ts=ts, robot_id=robot_id)
    if msg_type == "emergency_stop":
        return EmergencyStopMessage(ts=ts, robot_id=robot_id)
    if msg_type == "align_start":
        return AlignStartMessage(ts=ts, robot_id=robot_id)
    if msg_type == "align_stop":
        return AlignStopMessage(ts=ts, robot_id=robot_id)
    if msg_type == "align_commit":
        return AlignCommitMessage(ts=ts, robot_id=robot_id)
    if msg_type == "align_marker":
        return AlignMarkerMessage(
            ts=ts,
            robot_id=robot_id,
            marker_position=_vec3(data, "marker_position"),
            marker_orientation=_quat(data, "marker_orientation"),
        )
    if msg_type == "align_manual_pose":
        return AlignManualPoseMessage(
            ts=ts,
            robot_id=robot_id,
            position=_vec3(data, "position"),
            orientation=_quat(data, "orientation"),
        )
    if msg_type == "get_status":
        return GetStatusMessage(ts=ts, robot_id=robot_id)
    raise ValueError(f"Unknown inbound message type: {msg_type!r}")


def encode_bridge_status(
    snapshot: BridgeStatusSnapshot,
    *,
    ts: float | None = None,
) -> str:
    payload: dict[str, Any] = {
        "type": "bridge_status",
        "ts": ts if ts is not None else time.time(),
        "robot_id": snapshot.robot_id,
        "mode": snapshot.mode,
        "robot_connected": snapshot.robot_connected,
        "robot_model": snapshot.robot_model,
        "streams_active": snapshot.streams_active,
        "registered": snapshot.registered,
        "reconnecting": snapshot.reconnecting,
    }
    if snapshot.robot_serial is not None:
        payload["robot_serial"] = snapshot.robot_serial
    if snapshot.registration_method is not None:
        payload["registration_approximate"] = snapshot.registration_approximate
    return _dumps(payload)


def encode_hello(
    capabilities: list[str] | None = None,
    *,
    robot_id: str = ROBOT_ID,
) -> str:
    caps = capabilities if capabilities is not None else DEFAULT_CAPABILITIES
    return _dumps(
        {
            "type": "hello",
            "protocol_version": PROTOCOL_VERSION,
            "robots": [robot_id],
            "capabilities": caps,
        }
    )


def encode_registered(
    *,
    registered: bool = True,
    ts: float | None = None,
    robot_id: str = ROBOT_ID,
) -> str:
    return _dumps(
        {
            "type": "registered",
            "ts": ts if ts is not None else time.time(),
            "robot_id": robot_id,
            "registered": registered,
        }
    )


def _round_flat(arr: NDArray[np.floating], decimals: int = 3) -> list[float]:
    """Flatten Nx3 array to a 1-D list of rounded floats for compact JSON."""
    arr_f64 = arr.astype(np.float64)
    # Replace NaN/Inf with 0 to ensure valid JSON
    arr_f64 = np.nan_to_num(arr_f64, nan=0.0, posinf=0.0, neginf=0.0)
    return np.round(arr_f64, decimals).ravel().tolist()


def encode_lidar(
    *,
    ts: float,
    points: NDArray[np.floating],
    colors: NDArray[np.floating] | None = None,
    robot_id: str = ROBOT_ID,
) -> str:
    payload: dict[str, Any] = {
        "type": "lidar",
        "ts": round(ts, 3),
        "robot_id": robot_id,
        "frame": FRAME_WORLD,
        "points_flat": _round_flat(points),
    }
    if colors is not None and len(colors) > 0:
        payload["colors_flat"] = _round_flat(colors)
    return _dumps(payload)


def encode_align_status(
    *,
    ts: float | None = None,
    robot_id: str = ROBOT_ID,
    state: str = "detecting",
    robot_marker_detected: bool = False,
    spectacles_marker_detected: bool = False,
    quality: float | None = None,
    best_quality: float | None = None,
    has_candidate: bool | None = None,
    method: str | None = None,
    message: str = "",
) -> str:
    payload: dict[str, Any] = {
        "type": "align_status",
        "ts": ts if ts is not None else time.time(),
        "robot_id": robot_id,
        "state": state,
        "robot_marker_detected": robot_marker_detected,
        "spectacles_marker_detected": spectacles_marker_detected,
        "message": message,
    }
    if quality is not None:
        payload["quality"] = quality
    if best_quality is not None:
        payload["best_quality"] = best_quality
    if has_candidate is not None:
        payload["has_candidate"] = has_candidate
    if method is not None:
        payload["method"] = method
    return _dumps(payload)


def encode_pose(
    *,
    ts: float,
    position: tuple[float, float, float],
    orientation: tuple[float, float, float, float],
    robot_id: str = ROBOT_ID,
) -> str:
    return _dumps(
        {
            "type": "pose",
            "ts": ts,
            "robot_id": robot_id,
            "frame": FRAME_WORLD,
            "position": list(position),
            "orientation": list(orientation),
        }
    )


def encode_path(
    *,
    ts: float,
    waypoints: list[tuple[float, float, float]],
    robot_id: str = ROBOT_ID,
) -> str:
    return _dumps(
        {
            "type": "path",
            "ts": ts,
            "robot_id": robot_id,
            "frame": FRAME_WORLD,
            "waypoints": [list(point) for point in waypoints],
        }
    )


def encode_nav_status(
    *,
    ts: float | None = None,
    state: str,
    goal_reached: bool,
    robot_id: str = ROBOT_ID,
) -> str:
    return _dumps(
        {
            "type": "nav_status",
            "ts": ts if ts is not None else time.time(),
            "robot_id": robot_id,
            "state": state,
            "goal_reached": goal_reached,
        }
    )
