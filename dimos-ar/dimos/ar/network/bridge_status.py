from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import threading

StatusChangeCallback = Callable[[], None]


@dataclass(frozen=True)
class BridgeStatusSnapshot:
    robot_id: str
    robot_connected: bool
    streams_active: bool  # internal bridge health; omitted from wire payloads
    reconnecting: bool


class BridgeStatusTracker:
    """Thread-safe bridge/robot connection state for WebSocket bridge_status messages."""

    def __init__(
        self,
        *,
        robot_id: str,
        robot_connected: bool,
    ) -> None:
        self._lock = threading.Lock()
        self._robot_id = robot_id
        self._robot_connected = robot_connected
        self._streams_active = False
        self._reconnecting = False
        self._on_change: StatusChangeCallback | None = None

    def set_on_change(self, callback: StatusChangeCallback | None) -> None:
        with self._lock:
            self._on_change = callback

    def _notify(self) -> None:
        callback = self._on_change
        if callback is not None:
            callback()

    def set_streams_active(self, active: bool) -> None:
        """Update internal lidar/odom freshness; not sent on the wire."""
        with self._lock:
            if self._streams_active == active:
                return
            self._streams_active = active
        self._notify()

    def set_reconnecting(self, reconnecting: bool) -> None:
        with self._lock:
            if self._reconnecting == reconnecting:
                return
            self._reconnecting = reconnecting
        self._notify()

    def set_robot_connected(self, robot_connected: bool) -> None:
        with self._lock:
            if self._robot_connected == robot_connected:
                return
            self._robot_connected = robot_connected
        self._notify()

    def snapshot(self) -> BridgeStatusSnapshot:
        with self._lock:
            return BridgeStatusSnapshot(
                robot_id=self._robot_id,
                robot_connected=self._robot_connected,
                streams_active=self._streams_active,
                reconnecting=self._reconnecting,
            )
