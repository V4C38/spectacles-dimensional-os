from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace
import math
import threading
import time
from typing import Any

from langchain_core.messages import AIMessage
from langchain_core.messages.base import BaseMessage

from dimos.ar.numeric import finite_number
from dimos.ar.spatial import (
    FrameSnapshot,
    Matrix,
    transform_point,
    transform_pose,
)
from dimos.ar.websocket.protocol import ClientPose, encode_agent_message, encode_agent_skill

CLIENT_POSE_STALE_S = 2.0
MARKER_ID_MAX_LEN = 64


class ARAgentService:
    """Own agent context and map markers; expose native odom coordinates to tools."""

    def __init__(
        self,
        *,
        frames: Callable[[], FrameSnapshot],
        connection_count: Callable[[], int],
        broadcast: Callable[[str], None],
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._frames = frames
        self._connection_count = connection_count
        self._broadcast = broadcast
        self._clock = clock
        self._lock = threading.RLock()
        self._poses: dict[str, tuple[ClientPose, float]] = {}
        self._actor: str | None = None
        self._pose_actor: str | None = None
        self._turn_started = False
        self._markers: dict[str, dict[str, Any]] = {}
        self._idle = True

    @property
    def idle(self) -> bool:
        with self._lock:
            return self._idle

    def update_idle(self, idle: bool) -> bool:
        with self._lock:
            if self._actor is not None:
                if not idle:
                    self._turn_started = True
                elif not self._turn_started:
                    # An idle fact queued before dispatch cannot finish the new turn.
                    return False
                else:
                    self._actor = None
                    self._turn_started = False
            if idle == self._idle:
                return False
            self._idle = idle
            return True

    @property
    def marker_ids(self) -> frozenset[str]:
        with self._lock:
            return frozenset(self._markers)

    def set_pose(self, pose: ClientPose, *, client_id: str) -> None:
        # Keep the observation in native odometry at admission. Agent tools run
        # on worker threads and must not pair an old map pose with a newer root.
        position, orientation = transform_pose(
            self._frames().T_odom_map, pose.position, pose.orientation
        )
        with self._lock:
            self._poses[client_id] = (
                replace(pose, position=position, orientation=orientation), self._clock()
            )

    def begin_turn(self, client_id: str) -> bool:
        """Pin wearer context before publishing to the native shared agent."""
        with self._lock:
            if self._actor is not None or not self._idle:
                return False
            self._actor = client_id
            self._pose_actor = client_id
            self._turn_started = False
            self._idle = False
            return True

    def cancel_turn(self, client_id: str) -> None:
        """Undo a dispatch that failed before reaching the native agent."""
        with self._lock:
            if self._actor == client_id and not self._turn_started:
                self._actor = None
                self._idle = True

    def disconnect(self, client_id: str) -> None:
        # An active turn keeps its actor identity, never another wearer's pose.
        # Native completion still owns its lifecycle; disconnect isn't cancellation.
        with self._lock:
            self._poses.pop(client_id, None)

    def marker_snapshot(self) -> tuple[str, ...]:
        with self._lock:
            return tuple(
                self._marker_message(args)
                for args in self._markers.values()
            )

    @staticmethod
    def _marker_message(marker: dict[str, Any]) -> str:
        return encode_agent_skill(
            name="ar_place_marker",
            args={key: value for key, value in marker.items() if key != "shared_frame_id"},
            shared_frame_id=marker["shared_frame_id"],
        )

    def reset(self) -> None:
        with self._lock:
            self._poses.clear()
            self._markers.clear()

    def rebase_shared_frame(self, matrix: Matrix) -> None:
        """Change spatial representation without changing agent actor/lifecycle."""
        with self._lock:
            shared_frame_id = self._frames().shared_frame_id
            for marker in self._markers.values():
                if marker["shared_frame_id"] == shared_frame_id:
                    continue
                position = transform_point(matrix, (marker["x"], marker["y"], marker["z"]))
                marker.update(zip(("x", "y", "z"), position, strict=True))
                marker["shared_frame_id"] = shared_frame_id

    def forward(self, message: BaseMessage) -> None:
        text = _textual_ai_message(message)
        if text is not None:
            self._broadcast(encode_agent_message(text))

    def _fresh_pose(self) -> ClientPose | None:
        with self._lock:
            # Native background skills can enqueue another turn after LLM idle.
            # Keep their initiating wearer context until an explicit new turn.
            source = self._pose_actor
            if source is None:
                if len(self._poses) != 1:
                    return None
                source = next(iter(self._poses))
            sample = self._poses.get(source)
            if sample is None:
                return None
            pose, received_at = sample
            return pose if 0 <= self._clock() - received_at <= CLIENT_POSE_STALE_S else None

    def place(self, id: str, x: float, y: float, z: float, title: str = "") -> str:
        """Project a native odom point into the shared map without changing its units."""
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
        frame = self._frames()
        position = transform_point(frame.T_map_odom, (x, y, z))
        args: dict[str, Any] = {
            "id": marker_id,
            "shared_frame_id": frame.shared_frame_id,
            "x": position[0],
            "y": position[1],
            "z": position[2],
        }
        if title:
            args["title"] = title
        with self._lock:
            current = self._frames()
            if current.revision != frame.revision or current.shared_frame_id != frame.shared_frame_id:
                position = transform_point(current.T_map_odom, (x, y, z))
                args.update(zip(("x", "y", "z"), position, strict=True))
                args["shared_frame_id"] = current.shared_frame_id
            self._markers[marker_id] = args
            payload = self._marker_message(args)
        self._broadcast(payload)
        return "ok"

    def remove(self, id: str) -> str:
        marker_id, error = _validate_marker_id(id)
        if error is not None:
            return error
        with self._lock:
            if marker_id not in self._markers:
                return "unknown marker id"
        if self._connection_count() == 0:
            return "No AR client connected"
        with self._lock:
            self._markers.pop(marker_id, None)
        self._broadcast(encode_agent_skill(name="ar_remove_marker", args={"id": marker_id}))
        return "ok"

    def client_pose(self) -> str:
        """Return the admitted native-odom optical observation and viewing ray."""
        pose = self._fresh_pose()
        if pose is None:
            return "No client pose"
        look = _look_dir_optical_z(pose.orientation)
        length = math.hypot(*look)
        native_look = tuple(value / length for value in look)
        return (
            f"position={list(pose.position)} "
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
    try:
        finite_number(value, name)
    except ValueError:
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
