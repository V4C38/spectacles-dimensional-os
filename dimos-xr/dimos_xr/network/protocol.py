"""WebSocket JSON protocol — keep in sync with PROTOCOL.md."""

from __future__ import annotations

from dataclasses import dataclass
import json
import time
from typing import TYPE_CHECKING, Any

import numpy as np

if TYPE_CHECKING:
    from numpy.typing import NDArray

    from dimos_xr.adapters.base import CapabilityState, RobotHandshake
    from dimos_xr.network.bridge_status import BridgeStatusSnapshot

PROTOCOL_VERSION = 3
FRAME_WORLD = "world"

DEFAULT_CAPABILITIES = [
    "lidar",
    "odom",
    "align",
    "align_manual",
    "nav",
    "path",
    "plan_preview",
    "cancel_goal",
    "emergency_stop",
]


def _dumps(payload: dict[str, Any]) -> str:
    return json.dumps(payload, separators=(",", ":"), allow_nan=False)


@dataclass(frozen=True)
class NavGoalMessage:
    ts: float
    robot_id: str
    position: tuple[float, float, float]
    orientation: tuple[float, float, float, float] | None = None


@dataclass(frozen=True)
class PlanPathMessage:
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
class CameraInfoMessage:
    ts: float
    robot_id: str
    width: int
    height: int
    fx: float
    fy: float
    cx: float
    cy: float
    distortion: tuple[float, ...]
    camera_model: str
    device_model: str


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
    NavGoalMessage
    | PlanPathMessage
    | CancelGoalMessage
    | EmergencyStopMessage
    | AlignStartMessage
    | AlignStopMessage
    | AlignCommitMessage
    | CameraInfoMessage
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

    if msg_type == "nav_goal":
        orientation = _quat(data, "orientation") if "orientation" in data else None
        return NavGoalMessage(
            ts=ts,
            robot_id=robot_id,
            position=_vec3(data, "position"),
            orientation=orientation,
        )
    if msg_type == "plan_path":
        orientation = _quat(data, "orientation") if "orientation" in data else None
        return PlanPathMessage(
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
    if msg_type == "camera_info":
        distortion_raw = data.get("distortion", [])
        if not isinstance(distortion_raw, list):
            raise ValueError("Field 'distortion' must be a list")
        distortion = tuple(float(v) for v in distortion_raw)
        for key in ("width", "height", "fx", "fy", "cx", "cy"):
            if key not in data or not isinstance(data[key], (int, float)):
                raise ValueError(f"Missing or invalid field: {key}")
        return CameraInfoMessage(
            ts=ts,
            robot_id=robot_id,
            width=int(data["width"]),
            height=int(data["height"]),
            fx=float(data["fx"]),
            fy=float(data["fy"]),
            cx=float(data["cx"]),
            cy=float(data["cy"]),
            distortion=distortion,
            camera_model=str(_require_type(data, "camera_model", str)),
            device_model=str(_require_type(data, "device_model", str)),
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


def _serialize_capability_states(
    capability_states: dict[str, CapabilityState],
) -> tuple[dict[str, dict[str, Any]], list[str]]:
    serialized: dict[str, dict[str, Any]] = {}
    disabled: list[str] = []
    for name, state in capability_states.items():
        item: dict[str, Any] = {"available": state.available}
        if state.reason is not None:
            item["reason"] = state.reason
        serialized[name] = item
        if not state.available:
            disabled.append(name)
    return serialized, disabled


def encode_hello(handshake: RobotHandshake) -> str:
    capability_states, disabled_capabilities = _serialize_capability_states(
        handshake.capability_states
    )
    robot: dict[str, Any] = {
        "robot_id": handshake.robot_id,
        "robot_model": handshake.robot_model,
        "display_name": handshake.display_name,
        "visual_origin_frame": handshake.visual_origin_frame,
    }
    if handshake.body_bounds_m is not None:
        robot["body_bounds_m"] = list(handshake.body_bounds_m)
    if handshake.footprint_m is not None:
        robot["footprint_m"] = list(handshake.footprint_m)
    if handshake.base_height_m is not None:
        robot["base_height_m"] = handshake.base_height_m
    if handshake.default_render_offset_m is not None:
        robot["default_render_offset_m"] = list(handshake.default_render_offset_m)
    if handshake.alignment_profile is not None:
        robot["alignment_profile"] = handshake.alignment_profile
    robot.update(handshake.extra)
    return _dumps(
        {
            "type": "hello",
            "protocol_version": PROTOCOL_VERSION,
            "robot": robot,
            "capabilities": handshake.capabilities,
            "disabled_capabilities": disabled_capabilities,
            "capability_states": capability_states,
        }
    )


def encode_bridge_status(
    snapshot: BridgeStatusSnapshot,
    *,
    ts: float | None = None,
) -> str:
    payload: dict[str, Any] = {
        "type": "bridge_status",
        "ts": ts if ts is not None else time.time(),
        "robot_id": snapshot.robot_id,
        "robot_connected": snapshot.robot_connected,
        "streams_active": snapshot.streams_active,
        "registered": snapshot.registered,
        "reconnecting": snapshot.reconnecting,
        "registration_approximate": snapshot.registration_approximate,
    }
    if snapshot.registration_method is not None:
        payload["registration_method"] = snapshot.registration_method
    return _dumps(payload)


def _round_flat(arr: NDArray[np.floating], decimals: int = 2) -> list[float]:
    arr_f64 = arr.astype(np.float64)
    arr_f64 = np.nan_to_num(arr_f64, nan=0.0, posinf=0.0, neginf=0.0)
    return np.round(arr_f64, decimals).ravel().tolist()


def _round_vec3(
    position: tuple[float, float, float],
    decimals: int = 3,
) -> list[float]:
    arr = np.nan_to_num(np.asarray(position, dtype=np.float64), nan=0.0, posinf=0.0, neginf=0.0)
    rounded: list[float] = np.round(arr, decimals).tolist()
    return rounded


def _round_quat(
    orientation: tuple[float, float, float, float],
    decimals: int = 4,
) -> list[float]:
    arr = np.nan_to_num(np.asarray(orientation, dtype=np.float64), nan=0.0, posinf=0.0, neginf=0.0)
    rounded: list[float] = np.round(arr, decimals).tolist()
    return rounded


def _sanitize_pose_values(
    position: tuple[float, float, float],
    orientation: tuple[float, float, float, float],
) -> tuple[tuple[float, float, float], tuple[float, float, float, float]]:
    pos = np.nan_to_num(np.asarray(position, dtype=np.float64), nan=0.0, posinf=0.0, neginf=0.0)
    quat = np.nan_to_num(np.asarray(orientation, dtype=np.float64), nan=0.0, posinf=0.0, neginf=0.0)
    return (
        (float(pos[0]), float(pos[1]), float(pos[2])),
        (float(quat[0]), float(quat[1]), float(quat[2]), float(quat[3])),
    )


def encode_lidar(
    *,
    ts: float,
    points: NDArray[np.floating],
    robot_id: str,
) -> str:
    return _dumps(
        {
            "type": "lidar",
            "ts": round(ts, 3),
            "robot_id": robot_id,
            "frame": FRAME_WORLD,
            "points_flat": _round_flat(points),
        }
    )


def encode_align_status(
    *,
    ts: float | None = None,
    robot_id: str,
    state: str = "detecting",
    tag_detected: bool = False,
    observation_count: int | None = None,
    baseline_m: float | None = None,
    quality: float | None = None,
    best_quality: float | None = None,
    has_candidate: bool | None = None,
    method: str | None = None,
    message: str = "",
    cluster_size: int | None = None,
    required_samples: int | None = None,
) -> str:
    payload: dict[str, Any] = {
        "type": "align_status",
        "ts": ts if ts is not None else time.time(),
        "robot_id": robot_id,
        "state": state,
        "tag_detected": tag_detected,
        "message": message,
    }
    if observation_count is not None:
        payload["observation_count"] = observation_count
    if baseline_m is not None:
        payload["baseline_m"] = baseline_m
    if quality is not None:
        payload["quality"] = quality
    if best_quality is not None:
        payload["best_quality"] = best_quality
    if has_candidate is not None:
        payload["has_candidate"] = has_candidate
    if method is not None:
        payload["method"] = method
    if cluster_size is not None:
        payload["cluster_size"] = cluster_size
    if required_samples is not None:
        payload["required_samples"] = required_samples
    return _dumps(payload)


def encode_camera_frame_ack(
    *,
    ts: float | None = None,
    robot_id: str,
    seq: int,
    tag_detected: bool,
    tag_ids: list[int] | None = None,
    quality: float | None = None,
) -> str:
    payload: dict[str, Any] = {
        "type": "camera_frame_ack",
        "ts": ts if ts is not None else time.time(),
        "robot_id": robot_id,
        "seq": seq,
        "tag_detected": tag_detected,
    }
    if tag_ids is not None:
        payload["tag_ids"] = tag_ids
    if quality is not None:
        payload["quality"] = quality
    return _dumps(payload)


def encode_pose(
    *,
    ts: float,
    position: tuple[float, float, float],
    orientation: tuple[float, float, float, float],
    robot_id: str,
) -> str:
    safe_position, safe_orientation = _sanitize_pose_values(position, orientation)
    return _dumps(
        {
            "type": "pose",
            "ts": round(ts, 3),
            "robot_id": robot_id,
            "frame": FRAME_WORLD,
            "position": _round_vec3(safe_position, decimals=4),
            "orientation": _round_quat(safe_orientation, decimals=4),
        }
    )


def encode_path(
    *,
    ts: float,
    waypoints: list[tuple[float, float, float]],
    robot_id: str,
) -> str:
    return _dumps(_path_payload("path", ts=ts, waypoints=waypoints, robot_id=robot_id))


def encode_path_preview(
    *,
    ts: float,
    waypoints: list[tuple[float, float, float]],
    robot_id: str,
    target: tuple[float, float, float],
) -> str:
    payload = _path_payload("path_preview", ts=ts, waypoints=waypoints, robot_id=robot_id)
    payload["target"] = _round_vec3(target, decimals=3)
    return _dumps(payload)


def _path_payload(
    msg_type: str,
    *,
    ts: float,
    waypoints: list[tuple[float, float, float]],
    robot_id: str,
) -> dict[str, Any]:
    return {
        "type": msg_type,
        "ts": round(ts, 3),
        "robot_id": robot_id,
        "frame": FRAME_WORLD,
        "waypoints": [_round_vec3(point, decimals=3) for point in waypoints],
    }


def encode_nav_status(
    *,
    ts: float | None = None,
    state: str,
    goal_reached: bool,
    goal_failed: bool = False,
    recovering: bool = False,
    error_code: int | None = None,
    robot_id: str,
) -> str:
    return _dumps(
        _nav_status_payload(
            ts=ts if ts is not None else time.time(),
            state=state,
            goal_reached=goal_reached,
            goal_failed=goal_failed,
            recovering=recovering,
            error_code=error_code,
            robot_id=robot_id,
        )
    )


def _nav_status_payload(
    *,
    ts: float,
    state: str,
    goal_reached: bool,
    goal_failed: bool,
    recovering: bool,
    error_code: int | None,
    robot_id: str,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "type": "nav_status",
        "ts": ts,
        "robot_id": robot_id,
        "state": state,
        "goal_reached": goal_reached,
    }
    if goal_failed:
        payload["goal_failed"] = True
    if recovering:
        payload["recovering"] = True
    if error_code is not None:
        payload["error_code"] = error_code
    return payload
