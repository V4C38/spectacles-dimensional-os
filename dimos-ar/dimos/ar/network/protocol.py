"""WebSocket JSON protocol — keep in sync with PROTOCOL.md."""

from __future__ import annotations

from dataclasses import dataclass
import json
import struct
import time
from typing import TYPE_CHECKING, Any

import numpy as np

if TYPE_CHECKING:
    from numpy.typing import NDArray

    from dimos.ar.adapters.base import CapabilityState, RobotHandshake
    from dimos.ar.network.bridge_status import BridgeStatusSnapshot

PROTOCOL_VERSION = 4
FRAME_WORLD = "world"

DEFAULT_CAPABILITIES = [
    "lidar",
    "odom",
    "align",
    "align_manual",
    "align_assist",
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
    method: str
    assist: bool = False


@dataclass(frozen=True)
class AssistConfirmMessage:
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


@dataclass(frozen=True)
class SetLidarModeMessage:
    ts: float
    robot_id: str
    mode: str
    obstacle_min_distance_m: float
    obstacle_opaque_distance_m: float
    obstacle_max_distance_m: float


@dataclass(frozen=True)
class PingMessage:
    ts: float
    robot_id: str
    client_ts: float


InboundMessage = (
    NavGoalMessage
    | PlanPathMessage
    | CancelGoalMessage
    | EmergencyStopMessage
    | AlignStartMessage
    | AssistConfirmMessage
    | AlignStopMessage
    | AlignCommitMessage
    | CameraInfoMessage
    | AlignManualPoseMessage
    | GetStatusMessage
    | SetLidarModeMessage
    | PingMessage
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
        method = _require_type(data, "method", str)
        if method not in ("tag", "manual"):
            raise ValueError(f"align_start.method must be 'tag' or 'manual', got {method!r}")
        return AlignStartMessage(ts=ts, robot_id=robot_id, method=method, assist=bool(data.get("assist", False)))
    if msg_type == "assist_confirm":
        return AssistConfirmMessage(ts=ts, robot_id=robot_id)
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
    if msg_type == "set_lidar_mode":
        mode = _require_type(data, "mode", str)
        if mode not in ("off", "obstacles", "full"):
            raise ValueError(
                "set_lidar_mode.mode must be 'off', 'obstacles', or 'full'"
            )
        for key in (
            "obstacle_min_distance_m",
            "obstacle_opaque_distance_m",
            "obstacle_max_distance_m",
        ):
            if key not in data or not isinstance(data[key], (int, float)):
                raise ValueError(f"Missing or invalid field: {key}")
        min_distance_m = float(data["obstacle_min_distance_m"])
        opaque_distance_m = float(data["obstacle_opaque_distance_m"])
        max_distance_m = float(data["obstacle_max_distance_m"])
        if min_distance_m < 0.0:
            raise ValueError("obstacle_min_distance_m must be >= 0")
        if opaque_distance_m < min_distance_m:
            raise ValueError(
                "obstacle_opaque_distance_m must be >= obstacle_min_distance_m"
            )
        if max_distance_m < opaque_distance_m:
            raise ValueError(
                "obstacle_max_distance_m must be >= obstacle_opaque_distance_m"
            )
        return SetLidarModeMessage(
            ts=ts,
            robot_id=robot_id,
            mode=mode,
            obstacle_min_distance_m=min_distance_m,
            obstacle_opaque_distance_m=opaque_distance_m,
            obstacle_max_distance_m=max_distance_m,
        )
    if msg_type == "ping":
        if "client_ts" not in data or not isinstance(data["client_ts"], (int, float)):
            raise ValueError("Missing or invalid field: client_ts")
        return PingMessage(ts=ts, robot_id=robot_id, client_ts=float(data["client_ts"]))
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
    capabilities, _ = _serialize_capability_states(handshake.capability_states)
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
            "capabilities": capabilities,
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
        "registration_method": snapshot.registration_method,
        "registration_approximate": snapshot.registration_approximate,
    }
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


# Binary lidar frame (message_type 0x01 = lidar_f16).
# Format: [1B type=0x01][4B float32 ts little-endian][N*6B float16 xyz world-metres]
_LIDAR_F16_TYPE: int = 0x01


def encode_lidar_binary(
    *,
    ts: float,
    points: NDArray[np.floating],
) -> bytes:
    """Encode a LiDAR point cloud as a compact binary WebSocket frame.

    The binary format is 6 bytes per point (3 x IEEE754 float16, little-endian)
    plus a 5-byte header, vs ~18 bytes/point in JSON text. At 2500 points the
    frame is ~15 KB compared to ~18-20 KB for JSON.
    """
    header = struct.pack("<Bf", _LIDAR_F16_TYPE, float(ts))
    if points.size == 0:
        return header
    f16 = np.asarray(points, dtype=np.float16)
    return header + f16.tobytes()


def encode_align_status(
    *,
    ts: float | None = None,
    robot_id: str,
    method: str,
    state: str,
    progress: int,
    message: str = "",
    tag_visible: bool | None = None,
    assist_stage: str | None = None,
    sampling: bool | None = None,
    robot_world_pose: dict[str, Any] | None = None,
    step_index: int | None = None,
    step_count: int | None = None,
) -> str:
    payload: dict[str, Any] = {
        "type": "align_status",
        "ts": ts if ts is not None else time.time(),
        "robot_id": robot_id,
        "method": method,
        "state": state,
        "progress": progress,
        "message": message,
    }
    if tag_visible is not None:
        payload["tag_visible"] = tag_visible
    if assist_stage is not None:
        payload["assist_stage"] = assist_stage
    if sampling is not None:
        payload["sampling"] = sampling
    if robot_world_pose is not None:
        payload["robot_world_pose"] = robot_world_pose
    if step_index is not None:
        payload["step_index"] = step_index
    if step_count is not None:
        payload["step_count"] = step_count
    return _dumps(payload)


def encode_camera_frame_ack(
    *,
    ts: float | None = None,
    robot_id: str,
    seq: int,
) -> str:
    return _dumps(
        {
            "type": "camera_frame_ack",
            "ts": ts if ts is not None else time.time(),
            "robot_id": robot_id,
            "seq": seq,
        }
    )


def encode_pong(
    *,
    ts: float | None = None,
    robot_id: str,
    client_ts: float,
    bridge_ts: float | None = None,
) -> str:
    return _dumps(
        {
            "type": "pong",
            "ts": ts if ts is not None else time.time(),
            "robot_id": robot_id,
            "client_ts": client_ts,
            "bridge_ts": bridge_ts if bridge_ts is not None else time.time(),
        }
    )


def encode_pose(
    *,
    ts: float,
    position: tuple[float, float, float],
    orientation: tuple[float, float, float, float],
    robot_id: str,
    speed_mps: float | None = None,
) -> str:
    safe_position, safe_orientation = _sanitize_pose_values(position, orientation)
    payload: dict[str, Any] = {
        "type": "pose",
        "ts": round(ts, 3),
        "robot_id": robot_id,
        "frame": FRAME_WORLD,
        "position": _round_vec3(safe_position, decimals=4),
        "orientation": _round_quat(safe_orientation, decimals=4),
    }
    if speed_mps is not None:
        payload["speed_mps"] = round(float(speed_mps), 4)
    return _dumps(payload)


def encode_pose_correction(
    *,
    ts: float | None,
    robot_id: str,
    trans_delta_m: float,
    yaw_delta_deg: float | None,
    yaw_corrected: bool,
    solve_quality: float,
    solve_method: str,
) -> str:
    """Encode a pose_correction message.

    Emitted only when a runtime tag correction exceeds the deadband defined by
    MIN_REPORTED_CORRECTION_TRANS_M / MIN_REPORTED_CORRECTION_YAW_DEG in
    alignment.py.  Sub-threshold micro-refinements still update T_world_odom on
    the bridge but are silent — the Lens uses this message to trigger the
    user-visible "Refined Tracking" notification and the realignment snap animation.
    """
    payload: dict[str, Any] = {
        "type": "pose_correction",
        "ts": round(ts, 3) if ts is not None else time.time(),
        "robot_id": robot_id,
        "trans_delta_m": round(float(trans_delta_m), 4),
        "yaw_corrected": yaw_corrected,
        "solve_quality": round(float(solve_quality), 4),
        "solve_method": solve_method,
    }
    if yaw_delta_deg is not None:
        payload["yaw_delta_deg"] = round(float(yaw_delta_deg), 3)
    return _dumps(payload)


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
