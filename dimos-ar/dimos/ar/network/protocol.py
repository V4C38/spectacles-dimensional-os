"""WebSocket JSON protocol — keep in sync with PROTOCOL.md."""

from __future__ import annotations

from dataclasses import dataclass
import json
import struct
import time
from typing import TYPE_CHECKING, Any, Literal

import numpy as np

from dimos.ar.registration.wire import (
    RegistrationCommandMessage,
    RegistrationPoseMessage,
    RegistrationStatusPayload,
    encode_registration_status,
)

if TYPE_CHECKING:
    from numpy.typing import NDArray

    from dimos.ar.adapters.base import CapabilityState, RobotHandshake
    from dimos.ar.network.bridge_status import BridgeStatusSnapshot

PROTOCOL_VERSION = 6

NavPhase = Literal["idle", "navigating", "recovering", "succeeded", "failed"]
PathKind = Literal["active", "preview"]
GoalIntent = Literal["navigate", "preview"]

DEFAULT_CAPABILITIES = [
    "lidar",
    "odom",
    "registration_april_odom_baseline",
    "registration_manual_pose",
    "nav",
    "path",
    "plan_preview",
    "cancel_goal",
    "emergency_stop",
]


def _dumps(payload: dict[str, Any]) -> str:
    return json.dumps(payload, separators=(",", ":"), allow_nan=False)


@dataclass(frozen=True)
class GoalMessage:
    ts: float
    robot_id: str
    intent: GoalIntent
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
class GetStatusMessage:
    ts: float
    robot_id: str


@dataclass(frozen=True)
class SetLidarModeMessage:
    ts: float
    robot_id: str
    mode: str
    obstacle_min_distance_m: float | None = None
    obstacle_opaque_distance_m: float | None = None
    obstacle_max_distance_m: float | None = None


@dataclass(frozen=True)
class PingMessage:
    ts: float
    robot_id: str
    client_ts: float


InboundMessage = (
    GoalMessage
    | CancelGoalMessage
    | EmergencyStopMessage
    | RegistrationCommandMessage
    | CameraInfoMessage
    | RegistrationPoseMessage
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

    if msg_type == "goal":
        intent = _require_type(data, "intent", str)
        if intent not in ("navigate", "preview"):
            raise ValueError("goal.intent must be 'navigate' or 'preview'")
        orientation = _quat(data, "orientation") if "orientation" in data else None
        return GoalMessage(
            ts=ts,
            robot_id=robot_id,
            intent=intent,  # type: ignore[arg-type]
            position=_vec3(data, "position"),
            orientation=orientation,
        )
    if msg_type == "cancel_goal":
        return CancelGoalMessage(ts=ts, robot_id=robot_id)
    if msg_type == "emergency_stop":
        return EmergencyStopMessage(ts=ts, robot_id=robot_id)
    if msg_type == "registration_command":
        command = _require_type(data, "command", str)
        if command not in ("start", "authorize_motion", "stop", "commit"):
            raise ValueError(
                "registration_command.command must be "
                "'start', 'authorize_motion', 'stop', or 'commit'"
            )
        mode: str | None = None
        if command == "start":
            mode = _require_type(data, "mode", str)
            if mode not in ("april_odom_baseline", "manual_pose"):
                raise ValueError(
                    "registration_command.mode must be "
                    "'april_odom_baseline' or 'manual_pose' when command is 'start'"
                )
        elif "mode" in data:
            raise ValueError("registration_command.mode is only valid when command is 'start'")
        return RegistrationCommandMessage(
            ts=ts,
            robot_id=robot_id,
            command=command,  # type: ignore[arg-type]
            mode=mode,  # type: ignore[arg-type]
        )
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
    if msg_type == "registration_pose":
        return RegistrationPoseMessage(
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
        min_distance_m: float | None = None
        opaque_distance_m: float | None = None
        max_distance_m: float | None = None
        if mode == "obstacles":
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
    if handshake.registration_profile is not None:
        robot["registration_profile"] = handshake.registration_profile
    robot.update(handshake.extra)
    return _dumps(
        {
            "type": "hello",
            "protocol_version": PROTOCOL_VERSION,
            "robot": robot,
            "capabilities": capabilities,
        }
    )


def _bridge_status_wire(snapshot: BridgeStatusSnapshot) -> dict[str, Any]:
    # v6 wire payloads intentionally omit streams_active (internal-only tracker field).
    payload: dict[str, Any] = {
        "robot_connected": snapshot.robot_connected,
        "registered": snapshot.registered,
        "reconnecting": snapshot.reconnecting,
        "registration_method": snapshot.registration_method,
        "registration_approximate": snapshot.registration_approximate,
    }
    return payload


def encode_bridge_status(
    snapshot: BridgeStatusSnapshot,
    *,
    ts: float | None = None,
) -> str:
    payload: dict[str, Any] = {
        "type": "bridge_status",
        "ts": ts if ts is not None else time.time(),
        **_bridge_status_wire(snapshot),
    }
    return _dumps(payload)


def encode_runtime_snapshot(
    *,
    robot_id: str,
    bridge: BridgeStatusSnapshot,
    nav: dict[str, Any],
    path: dict[str, Any] | None = None,
    ts: float | None = None,
) -> str:
    payload: dict[str, Any] = {
        "type": "runtime_snapshot",
        "ts": ts if ts is not None else time.time(),
        "robot_id": robot_id,
        "bridge": _bridge_status_wire(bridge),
        "nav": nav,
    }
    if path is not None:
        payload["path"] = path
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


# Binary lidar frame (message_type 0x01 = lidar_f16).
# Format: [1B type=0x01][4B float32 ts little-endian][N*6B float16 xyz world-metres]
_LIDAR_F16_TYPE: int = 0x01


def encode_lidar_binary(
    *,
    ts: float,
    points: NDArray[np.floating],
) -> bytes:
    """Encode a LiDAR point cloud as a compact binary WebSocket frame."""
    header = struct.pack("<Bf", _LIDAR_F16_TYPE, float(ts))
    if points.size == 0:
        return header
    f16 = np.asarray(points, dtype=np.float16)
    return header + f16.tobytes()


def encode_camera_frame_ack(
    *,
    ts: float | None = None,
    seq: int,
) -> str:
    return _dumps(
        {
            "type": "camera_frame_ack",
            "ts": ts if ts is not None else time.time(),
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
    speed_mps: float | None = None,
) -> str:
    safe_position, safe_orientation = _sanitize_pose_values(position, orientation)
    payload: dict[str, Any] = {
        "type": "pose",
        "ts": round(ts, 3),
        "position": _round_vec3(safe_position, decimals=4),
        "orientation": _round_quat(safe_orientation, decimals=4),
    }
    if speed_mps is not None:
        payload["speed_mps"] = round(float(speed_mps), 4)
    return _dumps(payload)


def encode_pose_correction(
    *,
    ts: float | None,
    trans_delta_m: float,
    yaw_delta_deg: float | None,
    yaw_corrected: bool,
    solve_quality: float,
    solve_method: str,
) -> str:
    payload: dict[str, Any] = {
        "type": "pose_correction",
        "ts": round(ts, 3) if ts is not None else time.time(),
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
    kind: PathKind = "active",
    target: tuple[float, float, float] | None = None,
) -> str:
    payload: dict[str, Any] = {
        "type": "path",
        "ts": round(ts, 3),
        "kind": kind,
        "waypoints": [_round_vec3(point, decimals=3) for point in waypoints],
    }
    if kind == "preview" and target is not None:
        payload["target"] = _round_vec3(target, decimals=3)
    return _dumps(payload)


def nav_phase_payload(
    *,
    goal_reached: bool,
    goal_failed: bool,
    nav_recovering: bool,
    nav_state: str,
    nav_goal_pending: bool,
    error_code: int | None = None,
) -> dict[str, Any]:
    if goal_reached:
        phase: NavPhase = "succeeded"
    elif goal_failed:
        phase = "failed"
    elif nav_recovering or nav_state == "recovery":
        phase = "recovering"
    elif nav_state == "navigating" and nav_goal_pending:
        phase = "navigating"
    else:
        phase = "idle"
    payload: dict[str, Any] = {"phase": phase}
    if error_code is not None:
        payload["error_code"] = error_code
    return payload


def encode_nav_status(
    *,
    ts: float | None = None,
    phase: NavPhase,
    error_code: int | None = None,
) -> str:
    nav: dict[str, Any] = {"phase": phase}
    if error_code is not None:
        nav["error_code"] = error_code
    return _dumps(
        {
            "type": "nav_status",
            "ts": ts if ts is not None else time.time(),
            **nav,
        }
    )


__all__ = [
    "PROTOCOL_VERSION",
    "CameraInfoMessage",
    "CancelGoalMessage",
    "EmergencyStopMessage",
    "GetStatusMessage",
    "GoalIntent",
    "GoalMessage",
    "InboundMessage",
    "NavPhase",
    "PathKind",
    "PingMessage",
    "RegistrationCommandMessage",
    "RegistrationPoseMessage",
    "RegistrationStatusPayload",
    "SetLidarModeMessage",
    "decode_inbound",
    "encode_bridge_status",
    "encode_camera_frame_ack",
    "encode_hello",
    "encode_lidar_binary",
    "encode_nav_status",
    "encode_path",
    "encode_pong",
    "encode_pose",
    "encode_pose_correction",
    "encode_registration_status",
    "encode_runtime_snapshot",
    "nav_phase_payload",
]
