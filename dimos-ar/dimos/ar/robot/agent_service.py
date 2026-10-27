from __future__ import annotations

from collections.abc import Callable
import math
import time
from typing import Any

from langchain_core.messages import AIMessage
from langchain_core.messages.base import BaseMessage

from dimos.ar.robot.odometry_correction import correct_odom_xy, uncorrect_odom_xy
from dimos.ar.websocket.protocol import ClientPose, encode_agent_message, encode_agent_skill

CLIENT_POSE_STALE_S = 2.0
MARKER_ID_MAX_LEN = 64


class ARAgentService:
    def __init__(
        self,
        *,
        factor: float,
        connection_count: Callable[[], int],
        broadcast: Callable[[str], None],
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._factor = factor
        self._connection_count = connection_count
        self._broadcast = broadcast
        self._clock = clock
        self._pose: ClientPose | None = None
        self._received_at: float | None = None
        self._marker_ids: set[str] = set()
        self._idle = True

    @property
    def idle(self) -> bool:
        return self._idle

    def update_idle(self, idle: bool) -> bool:
        if idle == self._idle:
            return False
        self._idle = idle
        return True

    @property
    def marker_ids(self) -> frozenset[str]:
        return frozenset(self._marker_ids)

    def set_pose(self, pose: ClientPose) -> None:
        self._pose = pose
        self._received_at = self._clock()

    def reset(self) -> None:
        self._pose = None
        self._received_at = None
        self._marker_ids.clear()

    def forward(self, message: BaseMessage) -> None:
        text = _textual_ai_message(message)
        if text is not None:
            self._broadcast(encode_agent_message(text))

    def _fresh_pose(self) -> ClientPose | None:
        if self._pose is None or self._received_at is None:
            return None
        return self._pose if self._clock() - self._received_at <= CLIENT_POSE_STALE_S else None

    def place(self, id: str, x: float, y: float, z: float, title: str = "") -> str:
        marker_id, error = _validate_marker_id(id)
        if error is not None:
            return error
        error = _validate_ar_place_marker(x, y, z, title)
        if error is not None:
            return error
        if self._connection_count() == 0:
            return "No AR client connected"
        if self._fresh_pose() is None:
            return "No client pose"
        corrected_x, corrected_y = correct_odom_xy(x, y, factor=self._factor)
        args: dict[str, Any] = {
            "id": marker_id,
            "x": corrected_x,
            "y": corrected_y,
            "z": float(z),
        }
        if title:
            args["title"] = title
        self._broadcast(encode_agent_skill(name="ar_place_marker", args=args))
        self._marker_ids.add(marker_id)
        return "ok"

    def remove(self, id: str) -> str:
        marker_id, error = _validate_marker_id(id)
        if error is not None:
            return error
        if marker_id not in self._marker_ids:
            return "unknown marker id"
        if self._connection_count() == 0:
            return "No AR client connected"
        self._broadcast(encode_agent_skill(name="ar_remove_marker", args={"id": marker_id}))
        self._marker_ids.discard(marker_id)
        return "ok"

    def client_pose(self) -> str:
        pose = self._fresh_pose()
        if pose is None:
            return "No client pose"
        native_xy = uncorrect_odom_xy(*pose.position[:2], factor=self._factor)
        look = _look_dir_optical_z(pose.orientation)
        look_xy = uncorrect_odom_xy(*look[:2], factor=self._factor)
        length = math.hypot(*look_xy, look[2])
        native_look = (look_xy[0] / length, look_xy[1] / length, look[2] / length)
        return (
            f"position={[*native_xy, pose.position[2]]} "
            f"orientation={list(pose.orientation)} "
            f"look_dir={list(native_look)}"
        )


def _textual_ai_message(msg: BaseMessage) -> str | None:
    if not isinstance(msg, AIMessage):
        return None
    content = msg.content
    if isinstance(content, str):
        text = content.strip()
        return text or None
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str) and block.strip():
                parts.append(block.strip())
            elif isinstance(block, dict) and block.get("type") == "text":
                text = str(block.get("text", "")).strip()
                if text:
                    parts.append(text)
        joined = "\n".join(parts).strip()
        return joined or None
    return None


def _finite_number(value: object, name: str) -> str | None:
    if (
        not isinstance(value, (int, float))
        or isinstance(value, bool)
        or not math.isfinite(float(value))
    ):
        return f"{name} must be a finite number"
    return None


def _validate_marker_id(marker_id: object) -> tuple[str, str | None]:
    if not isinstance(marker_id, str):
        return "", "id is blank"
    trimmed = marker_id.strip()
    if not trimmed:
        return "", "id is blank"
    if len(trimmed) > MARKER_ID_MAX_LEN:
        return "", "id is too long"
    return trimmed, None


def _validate_ar_place_marker(x: object, y: object, z: object, title: object) -> str | None:
    for name, value in (("x", x), ("y", y), ("z", z)):
        error = _finite_number(value, name)
        if error is not None:
            return error
    if not isinstance(title, str):
        return "title must be a string"
    return None


def _look_dir_optical_z(
    orientation: tuple[float, float, float, float],
) -> tuple[float, float, float]:
    x, y, z, w = orientation
    vx, vy, vz = 0.0, 0.0, 1.0
    tx = 2.0 * (y * vz - z * vy)
    ty = 2.0 * (z * vx - x * vz)
    tz = 2.0 * (x * vy - y * vx)
    look = (
        vx + w * tx + (y * tz - z * ty),
        vy + w * ty + (z * tx - x * tz),
        vz + w * tz + (x * ty - y * tx),
    )
    length = math.hypot(*look)
    if length < 1e-6:
        return (0.0, 0.0, 1.0)
    return (look[0] / length, look[1] / length, look[2] / length)
