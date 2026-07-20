"""WebSocket JSON protocol — keep in sync with PROTOCOL.md."""

from __future__ import annotations

from dataclasses import dataclass
import json
import struct
import time
from typing import TYPE_CHECKING, Any, Literal

import numpy as np

from dimos.ar.agent.wire import (
    ArSkillResultMessage,
    UserCommandMessage,
    WireAgentState,
    WireGoalSource,
    decode_ar_skill_result,
    decode_user_command,
    encode_agent_response,
    encode_agent_status,
    encode_ar_skill,
)
from dimos.ar.registration.wire import (
    RegistrationCommandMessage,
    RegistrationPoseMessage,
    RegistrationStatusPayload,
    encode_registration_status,
)

if TYPE_CHECKING:
    from numpy.typing import NDArray

    from dimos.ar.network.bridge_status import BridgeStatusSnapshot
    from dimos.ar.robot_profile.base import CapabilityState, RobotHandshake
    from dimos.ar.world_frame.state import WorldFrameState

PROTOCOL_VERSION = 18

WireNavigationState = Literal["idle", "navIntent", "navigating", "resolved"]
NavTerminalOutcome = Literal["succeeded", "failed"]
NavGoalWire = dict[str, Any]

DEFAULT_CAPABILITIES = [
    "lidar",
    "odom",
    "nav",
    "path",
    "cancel_nav_goal",
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
class CancelNavGoalMessage:
    ts: float
    robot_id: str


@dataclass(frozen=True)
class EmergencyStopMessage:
    ts: float
    robot_id: str


@dataclass(frozen=True)
class JoystickCommandMessage:
    ts: float
    robot_id: str
    vx: float
    vy: float
    wz: float


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
    NavGoalMessage
    | CancelNavGoalMessage
    | EmergencyStopMessage
    | JoystickCommandMessage
    | RegistrationCommandMessage
    | CameraInfoMessage
    | RegistrationPoseMessage
    | GetStatusMessage
    | SetLidarModeMessage
    | PingMessage
    | UserCommandMessage
    | ArSkillResultMessage
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
    if msg_type == "cancel_nav_goal":
        return CancelNavGoalMessage(ts=ts, robot_id=robot_id)
    if msg_type == "emergency_stop":
        return EmergencyStopMessage(ts=ts, robot_id=robot_id)
    if msg_type == "joystick_command":
        for axis in ("vx", "vy", "wz"):
            if axis not in data or not isinstance(data[axis], (int, float)):
                raise ValueError(f"Missing or invalid field: {axis}")
        return JoystickCommandMessage(
            ts=ts,
            robot_id=robot_id,
            vx=float(data["vx"]),
            vy=float(data["vy"]),
            wz=float(data["wz"]),
        )
    if msg_type == "registration_command":
        command = _require_type(data, "command", str)
        if command not in ("start", "stop", "commit"):
            raise ValueError(
                "registration_command.command must be "
                "'start', 'stop', or 'commit'"
            )
        mode: str | None = None
        if command == "start":
            mode = _require_type(data, "mode", str)
            if mode not in ("april_tag", "manual_pose"):
                raise ValueError(
                    "registration_command.mode must be "
                    "'april_tag' or 'manual_pose' when command is 'start'"
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
    if msg_type == "user_command":
        return decode_user_command(data, ts=ts, robot_id=robot_id)
    if msg_type == "ar_skill_result":
        return decode_ar_skill_result(data, ts=ts, robot_id=robot_id)
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
    if handshake.tag_tracking_profile is not None:
        robot["tag_tracking_profile"] = handshake.tag_tracking_profile
    robot.update(handshake.extra)
    return _dumps(
        {
            "type": "hello",
            "protocol_version": PROTOCOL_VERSION,
            "robot": robot,
            "capabilities": capabilities,
        }
    )


def bridge_status_wire(
    snapshot: BridgeStatusSnapshot,
    *,
    world_frame: WorldFrameState | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "robot_connected": snapshot.robot_connected,
        "reconnecting": snapshot.reconnecting,
    }
    if world_frame is not None:
        payload["world_frame_committed"] = world_frame.is_committed
        payload["world_frame_method"] = world_frame.method
        payload["world_frame_approximate"] = world_frame.approximate
    return payload


def encode_bridge_status(
    snapshot: BridgeStatusSnapshot,
    *,
    world_frame: WorldFrameState | None = None,
    ts: float | None = None,
) -> str:
    payload: dict[str, Any] = {
        "type": "bridge_status",
        "ts": ts if ts is not None else time.time(),
        **bridge_status_wire(snapshot, world_frame=world_frame),
    }
    return _dumps(payload)


def encode_runtime_snapshot(
    *,
    robot_id: str,
    bridge: BridgeStatusSnapshot | dict[str, Any],
    nav: dict[str, Any],
    path: dict[str, Any] | None = None,
    agent: dict[str, Any] | None = None,
    ts: float | None = None,
    world_frame: WorldFrameState | None = None,
) -> str:
    if isinstance(bridge, dict):
        bridge_wire = bridge
    else:
        bridge_wire = bridge_status_wire(bridge, world_frame=world_frame)
    payload: dict[str, Any] = {
        "type": "runtime_snapshot",
        "ts": ts if ts is not None else time.time(),
        "robot_id": robot_id,
        "bridge": bridge_wire,
        "nav": nav,
        "agent": agent if agent is not None else {"state": "idle"},
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


# LiDAR point budgets — keep in sync with lens-studio Protocol.ts and PROTOCOL.md.
LIDAR_WIRE_MAX_POINTS: int = 2500
LIDAR_FULL_POINT_CAP: int = 1500
LIDAR_OBSTACLE_POINT_CAP: int = 200

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
    capturing_budgeted_complete: bool = False,
) -> str:
    return _dumps(
        {
            "type": "camera_frame_ack",
            "ts": ts if ts is not None else time.time(),
            "seq": seq,
            "capturing_budgeted_complete": bool(capturing_budgeted_complete),
        }
    )


def encode_capture_policy(
    *,
    ts: float | None = None,
    max_capture_distance_m: float,
    min_capture_distance_m: float,
    max_capture_speed_mps: float,
    static_speed_mps: float,
    min_observations: int,
) -> str:
    return _dumps(
        {
            "type": "capture_policy",
            "ts": ts if ts is not None else time.time(),
            "max_capture_distance_m": round(float(max_capture_distance_m), 4),
            "min_capture_distance_m": round(float(min_capture_distance_m), 4),
            "max_capture_speed_mps": round(float(max_capture_speed_mps), 4),
            "static_speed_mps": round(float(static_speed_mps), 4),
            "min_observations": int(min_observations),
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
    velocity_mps: tuple[float, float, float] | None = None,
    yaw_rate_rad_s: float | None = None,
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
    if velocity_mps is not None:
        payload["velocity_mps"] = _round_vec3(velocity_mps, decimals=4)
    if yaw_rate_rad_s is not None:
        payload["yaw_rate_rad_s"] = round(float(yaw_rate_rad_s), 4)
    return _dumps(payload)


def encode_path(
    *,
    ts: float,
    waypoints: list[tuple[float, float, float]],
) -> str:
    payload: dict[str, Any] = {
        "type": "path",
        "ts": round(ts, 3),
        "waypoints": [_round_vec3(point, decimals=3) for point in waypoints],
    }
    return _dumps(payload)


def encode_nav_status(
    *,
    ts: float | None = None,
    state: WireNavigationState,
    outcome: NavTerminalOutcome | None = None,
    error_code: int | None = None,
    retryable: bool | None = None,
    stall_reason: str | None = None,
    goal: NavGoalWire | None = None,
) -> str:
    nav: dict[str, Any] = {"state": state}
    if outcome is not None:
        nav["outcome"] = outcome
    if error_code is not None:
        nav["error_code"] = error_code
    if retryable is not None:
        nav["retryable"] = retryable
    if stall_reason is not None:
        nav["stall_reason"] = stall_reason
    if goal is not None:
        nav["goal"] = goal
    return _dumps(
        {
            "type": "nav_status",
            "ts": ts if ts is not None else time.time(),
            **nav,
        }
    )


__all__ = [
    "LIDAR_FULL_POINT_CAP",
    "LIDAR_OBSTACLE_POINT_CAP",
    "LIDAR_WIRE_MAX_POINTS",
    "PROTOCOL_VERSION",
    "ArSkillResultMessage",
    "CameraInfoMessage",
    "CancelNavGoalMessage",
    "EmergencyStopMessage",
    "GetStatusMessage",
    "InboundMessage",
    "JoystickCommandMessage",
    "NavGoalMessage",
    "NavTerminalOutcome",
    "PingMessage",
    "RegistrationCommandMessage",
    "RegistrationPoseMessage",
    "RegistrationStatusPayload",
    "SetLidarModeMessage",
    "UserCommandMessage",
    "WireAgentState",
    "WireGoalSource",
    "WireNavigationState",
    "bridge_status_wire",
    "decode_inbound",
    "encode_agent_response",
    "encode_agent_status",
    "encode_ar_skill",
    "encode_bridge_status",
    "encode_camera_frame_ack",
    "encode_capture_policy",
    "encode_hello",
    "encode_lidar_binary",
    "encode_nav_status",
    "encode_path",
    "encode_pong",
    "encode_pose",
    "encode_registration_status",
    "encode_runtime_snapshot",
]
