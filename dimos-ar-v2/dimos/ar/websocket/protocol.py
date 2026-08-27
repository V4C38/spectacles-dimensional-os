"""WebSocket protocol codec — keep in sync with PROTOCOL.md."""

from __future__ import annotations

from dataclasses import dataclass
import json
import math
import struct
from typing import Any, Literal

from dimos.ar.localization.types import Intrinsics, Observation
from dimos.msgs.geometry_msgs.Pose import Pose

LIDAR_FOURCC = 0x4C444152
LOCALIZATION_REQUEST_FOURCC = 0x4C4F4341

NavPhase = Literal["idle", "following_path", "resolved"]
NavOutcome = Literal["succeeded", "failed"]

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
class HelloRequest:
    ts_client: float


@dataclass(frozen=True)
class NavGoalRequest:
    position: tuple[float, float, float]
    orientation: tuple[float, float, float, float]


@dataclass(frozen=True)
class EstopRequest:
    pass


@dataclass(frozen=True)
class LidarSettings:
    enabled: bool
    min_height_m: float
    max_height_m: float
    max_range_m: float


DEFAULT_LIDAR_SETTINGS = LidarSettings(
    enabled=False,
    min_height_m=0.1,
    max_height_m=1.5,
    max_range_m=5.0,
)


@dataclass(frozen=True)
class StateRequest:
    pass


Inbound = NavGoalRequest | EstopRequest | LidarSettings | StateRequest


def decode_hello_request(text: str) -> HelloRequest:
    """Parse the first-frame ``hello_request``. Raises ValueError on malformed input."""
    data = json.loads(text)
    if not isinstance(data, dict):
        raise TypeError("Frame must be a JSON object")
    msg_type = _require_type(data, "type", str)
    if msg_type != "hello_request":
        raise ValueError(f"Expected hello_request, got {msg_type!r}")
    return HelloRequest(ts_client=_finite_float(data, "ts_client"))


def decode_inbound(text: str) -> Inbound:
    """Parse an inbound JSON frame. Raises ValueError on malformed input."""
    data = json.loads(text)
    if not isinstance(data, dict):
        raise TypeError("Frame must be a JSON object")
    msg_type = _require_type(data, "type", str)

    if msg_type == "hello_request":
        raise ValueError("hello_request is handled during handshake, not in the message loop")

    if msg_type == "nav_goal_request":
        return NavGoalRequest(
            position=_vec3(data, "position"),
            orientation=_quat(data, "orientation"),
        )

    if msg_type == "estop_request":
        return EstopRequest()

    if msg_type == "lidar_settings_request":
        enabled = _require_type(data, "enabled", bool)
        min_height_m = _finite_float(data, "min_height_m")
        max_height_m = _finite_float(data, "max_height_m")
        max_range_m = _finite_float(data, "max_range_m")
        if min_height_m > max_height_m:
            raise ValueError("min_height_m must be <= max_height_m")
        return LidarSettings(
            enabled=enabled,
            min_height_m=min_height_m,
            max_height_m=max_height_m,
            max_range_m=max_range_m,
        )

    if msg_type == "state_request":
        return StateRequest()

    raise ValueError(f"Unknown inbound frame type: {msg_type!r}")


@dataclass(frozen=True)
class LocalizeObservation:
    capture_ts: float
    jpeg: bytes
    intrinsics: Intrinsics
    camera_position: tuple[float, float, float]
    camera_orientation: tuple[float, float, float, float]


def decode_localization_request(data: bytes) -> tuple[LocalizeObservation, ...]:
    """Parse a binary ``localization_request`` frame."""
    if len(data) < 6:
        raise ValueError("localization_request frame too short")
    fourcc, observation_count = struct.unpack_from("<IH", data, 0)
    if fourcc != LOCALIZATION_REQUEST_FOURCC:
        raise ValueError(f"bad localization_request fourcc: {fourcc:#010x}")
    if observation_count < 1:
        raise ValueError("localization_request requires at least one observation")

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
        raise TypeError("intrinsics.distortion must be a list")
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
class Capability:
    available: bool
    reason: str | None


@dataclass(frozen=True)
class RobotDescription:
    display_name: str
    body_bounds_m: tuple[float, float, float]
    footprint_m: tuple[float, float]
    base_height_m: float


@dataclass(frozen=True)
class TimeSync:
    ts_client: float
    ts_server: float

    def to_server_ts(self, ts_client: float) -> float:
        return ts_client + (self.ts_server - self.ts_client)


def observation_from_localize(
    wire: LocalizeObservation,
    *,
    time_sync: TimeSync,
) -> Observation:
    """Convert wire observation to domain; ``capture_ts`` becomes ``ts_server``."""
    return Observation(
        jpeg=wire.jpeg,
        intrinsics=wire.intrinsics,
        camera_pose=Pose(*wire.camera_position, *wire.camera_orientation),
        ts_server=time_sync.to_server_ts(wire.capture_ts),
    )


@dataclass(frozen=True)
class HelloBody:
    robot: RobotDescription
    capabilities: dict[str, Capability]


@dataclass(frozen=True)
class Hello:
    client_id: str
    time_sync: TimeSync
    robot: RobotDescription
    capabilities: dict[str, Capability]


def encode_hello(hello: Hello) -> str:
    return encode_text(
        {
            "type": "hello",
            "client_id": hello.client_id,
            "time_sync": {
                "ts_client": hello.time_sync.ts_client,
                "ts_server": hello.time_sync.ts_server,
            },
            "robot": {
                "display_name": hello.robot.display_name,
                "body_bounds_m": list(hello.robot.body_bounds_m),
                "footprint_m": list(hello.robot.footprint_m),
                "base_height_m": hello.robot.base_height_m,
            },
            "capabilities": {
                name: {"available": cap.available, "reason": cap.reason}
                for name, cap in hello.capabilities.items()
            },
        }
    )


@dataclass(frozen=True)
class NavGoalFrame:
    pose: tuple[float, float, float, float] | None
    path_poses: list[tuple[float, float, float, float]]
    ts: float


@dataclass(frozen=True)
class NavState:
    state: NavPhase
    outcome: NavOutcome | None


@dataclass(frozen=True)
class StateSnapshot:
    connected_clients: int
    lidar: LidarSettings
    nav: NavState
    alignment_stale: bool


def encode_state(payload: StateSnapshot) -> str:
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
            },
            "alignment": {"stale": payload.alignment_stale},
        }
    )


def encode_localization(
    *,
    position: tuple[float, float, float],
    orientation: tuple[float, float, float, float],
    confidence: float,
    ts_server: float,
) -> str:
    return encode_text(
        {
            "type": "localization",
            "position": list(position),
            "orientation": list(orientation),
            "confidence": confidence,
            "ts": ts_server,
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


def _wire_waypoint(x: float, y: float, z: float, yaw: float) -> list[float]:
    """Compact waypoint for JSON — mm position, ~0.006° yaw."""
    return [round(x, 3), round(y, 3), round(z, 3), round(yaw, 4)]


def encode_nav_goal(payload: NavGoalFrame) -> str:
    body: dict[str, Any] = {
        "type": "nav_goal",
        "path_poses": [_wire_waypoint(*point) for point in payload.path_poses],
        "ts": payload.ts,
    }
    if payload.pose is not None:
        body["pose"] = _wire_waypoint(*payload.pose)
    return encode_text(body)


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
