"""WebSocket wire codec — keep in sync with PROTOCOL.md."""

from __future__ import annotations

from dataclasses import dataclass
import json
import math
import struct
from typing import Any, Literal

LIDAR_FOURCC = 0x4C444152
LOCALIZE_FOURCC = 0x4C4F4341

WireNavState = Literal["idle", "navigating", "resolved"]
NavOutcome = Literal["succeeded", "failed"]
CameraDistortionModel = Literal["none", "plumb_bob", "equidistant"]


def _dumps(payload: dict[str, Any]) -> str:
    return json.dumps(payload, separators=(",", ":"), allow_nan=False)


def encode_text(payload: dict[str, Any]) -> str:
    """JSON text frame — newline-terminated per PROTOCOL.md."""
    return _dumps(payload) + "\n"


def _require_type(data: dict[str, Any], key: str, expected: type) -> Any:
    if key not in data:
        raise ValueError(f"Missing required field: {key}")
    value = data[key]
    if not isinstance(value, expected):
        raise TypeError(f"Field {key!r} must be {expected.__name__}, got {type(value).__name__}")
    return value


def _finite_float(data: dict[str, Any], key: str) -> float:
    if key not in data:
        raise ValueError(f"Missing required field: {key}")
    value = data[key]
    if not isinstance(value, (int, float)):
        raise TypeError(f"Field {key!r} must be a number")
    out = float(value)
    if not math.isfinite(out):
        raise ValueError(f"Field {key!r} must be finite")
    return out


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


@dataclass(frozen=True)
class TimeSyncMessage:
    client_send_ts: float


@dataclass(frozen=True)
class NavGoalMessage:
    position: tuple[float, float, float]
    orientation: tuple[float, float, float, float] | None = None


@dataclass(frozen=True)
class StopMessage:
    pass


@dataclass(frozen=True)
class LidarData:
    enabled: bool
    min_height_m: float
    max_height_m: float
    max_range_m: float


@dataclass(frozen=True)
class GetStateMessage:
    pass


InboundMessage = TimeSyncMessage | NavGoalMessage | StopMessage | LidarData | GetStateMessage


def decode_inbound(text: str) -> InboundMessage:
    """Parse an inbound JSON message. Raises ValueError on malformed input."""
    data = json.loads(text)
    if not isinstance(data, dict):
        raise TypeError("Message must be a JSON object")
    msg_type = _require_type(data, "type", str)

    if msg_type == "time_sync":
        raw_ts = data.get("client_send_ts")
        if not isinstance(raw_ts, (int, float)):
            raise ValueError("Missing or invalid field: client_send_ts")
        return TimeSyncMessage(client_send_ts=float(raw_ts))

    if msg_type == "nav_goal":
        orientation = _quat(data, "orientation") if "orientation" in data else None
        return NavGoalMessage(position=_vec3(data, "position"), orientation=orientation)

    if msg_type == "stop":
        return StopMessage()

    if msg_type == "set_lidar":
        enabled = _require_type(data, "enabled", bool)
        min_height_m = _finite_float(data, "min_height_m")
        max_height_m = _finite_float(data, "max_height_m")
        max_range_m = _finite_float(data, "max_range_m")
        if min_height_m > max_height_m:
            raise ValueError("min_height_m must be <= max_height_m")
        return LidarData(
            enabled=enabled,
            min_height_m=min_height_m,
            max_height_m=max_height_m,
            max_range_m=max_range_m,
        )

    if msg_type == "get_state":
        return GetStateMessage()

    raise ValueError(f"Unknown inbound message type: {msg_type!r}")


@dataclass(frozen=True)
class Intrinsics:
    fx: float
    fy: float
    cx: float
    cy: float
    width: int
    height: int
    distortion_model: CameraDistortionModel
    distortion: tuple[float, ...]


@dataclass(frozen=True)
class LocalizeObservation:
    capture_ts: float
    jpeg: bytes
    intrinsics: Intrinsics
    camera_position: tuple[float, float, float]
    camera_orientation: tuple[float, float, float, float]


def decode_localize(data: bytes) -> tuple[LocalizeObservation, ...]:
    """Parse a binary ``localize`` frame."""
    if len(data) < 6:
        raise ValueError("localize frame too short")
    fourcc, observation_count = struct.unpack_from("<IH", data, 0)
    if fourcc != LOCALIZE_FOURCC:
        raise ValueError(f"bad localize fourcc: {fourcc:#010x}")
    if observation_count < 1:
        raise ValueError("localize requires at least one observation")

    offset = 6
    observations: list[LocalizeObservation] = []
    for _ in range(observation_count):
        observation, offset = _decode_localize_observation(data, offset)
        observations.append(observation)
    return tuple(observations)


def _decode_localize_observation(
    data: bytes,
    offset: int,
) -> tuple[LocalizeObservation, int]:
    if len(data) - offset < 4:
        raise ValueError("truncated localize observation")
    (record_len,) = struct.unpack_from("<I", data, offset)
    record_start = offset + 4
    record_end = record_start + record_len
    if record_end > len(data):
        raise ValueError("localize observation record_len exceeds frame")

    header_end = record_start + 48
    if record_end < header_end:
        raise ValueError("localize observation header truncated")

    capture_ts, jpeg_len, intrinsics_len = struct.unpack_from("<dII", data, record_start)
    camera_position = struct.unpack_from("<3f", data, record_start + 20)
    camera_orientation = struct.unpack_from("<4f", data, record_start + 32)

    payload_offset = record_start + 48
    jpeg_end = payload_offset + jpeg_len
    intrinsics_end = jpeg_end + intrinsics_len
    if intrinsics_end > record_end:
        raise ValueError("localize observation payload exceeds record")

    jpeg = data[payload_offset:jpeg_end]
    intrinsics_raw = json.loads(data[jpeg_end:intrinsics_end].decode("utf-8"))
    if not isinstance(intrinsics_raw, dict):
        raise TypeError("intrinsics must be a JSON object")
    intrinsics = _decode_intrinsics(intrinsics_raw)

    return (
        LocalizeObservation(
            capture_ts=float(capture_ts),
            jpeg=jpeg,
            intrinsics=intrinsics,
            camera_position=(
                float(camera_position[0]),
                float(camera_position[1]),
                float(camera_position[2]),
            ),
            camera_orientation=(
                float(camera_orientation[0]),
                float(camera_orientation[1]),
                float(camera_orientation[2]),
                float(camera_orientation[3]),
            ),
        ),
        record_end,
    )


def _decode_intrinsics(data: dict[str, Any]) -> Intrinsics:
    for key in ("fx", "fy", "cx", "cy"):
        if key not in data or not isinstance(data[key], (int, float)):
            raise ValueError(f"Missing or invalid intrinsics field: {key}")
    for key in ("width", "height"):
        if key not in data or not isinstance(data[key], int):
            raise ValueError(f"Missing or invalid intrinsics field: {key}")
    distortion_model = _require_type(data, "distortion_model", str)
    if distortion_model not in ("none", "plumb_bob", "equidistant"):
        raise ValueError("intrinsics.distortion_model must be none, plumb_bob, or equidistant")
    distortion_raw = data.get("distortion", [])
    if not isinstance(distortion_raw, list):
        raise ValueError("intrinsics.distortion must be a list")
    distortion = tuple(float(v) for v in distortion_raw)
    return Intrinsics(
        fx=float(data["fx"]),
        fy=float(data["fy"]),
        cx=float(data["cx"]),
        cy=float(data["cy"]),
        width=int(data["width"]),
        height=int(data["height"]),
        distortion_model=distortion_model,  # type: ignore[arg-type]
        distortion=distortion,
    )


@dataclass(frozen=True)
class CapabilityWire:
    available: bool
    reason: str | None


@dataclass(frozen=True)
class HelloRobotWire:
    display_name: str
    body_bounds_m: tuple[float, float, float]
    footprint_m: tuple[float, float]
    base_height_m: float


@dataclass(frozen=True)
class HelloWire:
    client_id: str
    robot: HelloRobotWire
    requires_robot_in_view: bool
    capabilities: dict[str, CapabilityWire]


def encode_hello(payload: HelloWire) -> str:
    return encode_text(
        {
            "type": "hello",
            "client_id": payload.client_id,
            "robot": {
                "display_name": payload.robot.display_name,
                "body_bounds_m": list(payload.robot.body_bounds_m),
                "footprint_m": list(payload.robot.footprint_m),
                "base_height_m": payload.robot.base_height_m,
            },
            "alignment": {"requires_robot_in_view": payload.requires_robot_in_view},
            "capabilities": {
                name: {"available": cap.available, "reason": cap.reason}
                for name, cap in payload.capabilities.items()
            },
        }
    )


@dataclass(frozen=True)
class NavGoalWire:
    source: str
    position: tuple[float, float, float]
    orientation: tuple[float, float, float, float]


@dataclass(frozen=True)
class StateNavWire:
    state: WireNavState
    outcome: NavOutcome | None
    goal: NavGoalWire | None


@dataclass(frozen=True)
class StateWire:
    connected_clients: int
    lidar: LidarData
    nav: StateNavWire
    alignment_stale: bool


def encode_state(payload: StateWire) -> str:
    nav_goal: dict[str, Any] | None = None
    if payload.nav.goal is not None:
        goal = payload.nav.goal
        nav_goal = {
            "source": goal.source,
            "position": list(goal.position),
            "orientation": list(goal.orientation),
        }
    return encode_text(
        {
            "type": "state",
            "server": {"connected_clients": payload.connected_clients},
            "lidar": {
                "enabled": payload.lidar.enabled,
                "min_height_m": payload.lidar.min_height_m,
                "max_height_m": payload.lidar.max_height_m,
                "max_range_m": payload.lidar.max_range_m,
            },
            "nav": {
                "state": payload.nav.state,
                "outcome": payload.nav.outcome,
                "goal": nav_goal,
            },
            "alignment": {"stale": payload.alignment_stale},
        }
    )


def encode_time(
    *,
    client_send_ts: float,
    server_recv_ts: float,
    server_send_ts: float,
) -> str:
    return encode_text(
        {
            "type": "time",
            "client_send_ts": client_send_ts,
            "server_recv_ts": server_recv_ts,
            "server_send_ts": server_send_ts,
        }
    )


def encode_localization(
    *,
    position: tuple[float, float, float],
    orientation: tuple[float, float, float, float],
    confidence: float,
    ts: float,
) -> str:
    return encode_text(
        {
            "type": "localization",
            "position": list(position),
            "orientation": list(orientation),
            "confidence": confidence,
            "ts": ts,
        }
    )


def encode_pose(
    *,
    position: tuple[float, float, float],
    orientation: tuple[float, float, float, float],
    ts: float,
) -> str:
    return encode_text(
        {
            "type": "pose",
            "position": list(position),
            "orientation": list(orientation),
            "ts": ts,
        }
    )


def encode_path(
    *,
    points: list[tuple[float, float, float]],
    ts: float,
) -> str:
    return encode_text(
        {
            "type": "path",
            "points": [list(point) for point in points],
            "ts": ts,
        }
    )


def encode_lidar_binary(
    *,
    ts: float,
    points: list[tuple[float, float, float]],
) -> bytes:
    """Binary ``lidar`` frame — float32 xyz triplets, little-endian."""
    header = struct.pack(
        "<IdI",
        LIDAR_FOURCC,
        float(ts),
        len(points),
    )
    body = b"".join(struct.pack("<3f", *point) for point in points)
    return header + body
