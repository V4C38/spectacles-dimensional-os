"""StatusService — stream-freshness monitor and bridge_status broadcaster.

Wraps BridgeStatusTracker, owns the ``_last_lidar_mono`` / ``_last_odom_mono``
timestamps that drive the stream-stale check, and runs a daemon thread that
calls ``refresh()`` periodically.
"""

from __future__ import annotations

import threading
import time
from typing import TYPE_CHECKING, Literal

from dimos.ar.network.bridge_status import BridgeStatusSnapshot, BridgeStatusTracker
from dimos.ar.network.protocol import encode_bridge_status

if TYPE_CHECKING:
    from dimos.ar.bridge.sender import BridgeSender

STREAM_STATUS_POLL_INTERVAL_S: float = 0.5


class StatusService:
    """Owns stream-staleness state and periodically refreshes bridge_status."""

    def __init__(
        self,
        *,
        robot_id: str,
        sender: BridgeSender,
        stream_stale_timeout_s: float,
    ) -> None:
        self._sender = sender
        self._stale_timeout = stream_stale_timeout_s
        self._tracker = BridgeStatusTracker(robot_id=robot_id, robot_connected=False)
        self._tracker.set_on_change(self._on_tracker_change)
        self._last_lidar_mono: float | None = None
        self._last_odom_mono: float | None = None
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def mark_lidar(self) -> None:
        self._last_lidar_mono = time.monotonic()

    def mark_odom(self) -> None:
        self._last_odom_mono = time.monotonic()

    def refresh(self) -> None:
        """Recompute robot_connected / streams_active / reconnecting from timestamps."""
        now = time.monotonic()
        lidar_fresh = (
            self._last_lidar_mono is not None and now - self._last_lidar_mono < self._stale_timeout
        )
        odom_fresh = (
            self._last_odom_mono is not None and now - self._last_odom_mono < self._stale_timeout
        )
        snapshot = self._tracker.snapshot()
        robot_connected = lidar_fresh or odom_fresh
        self._tracker.set_robot_connected(robot_connected)
        self._tracker.set_streams_active(lidar_fresh and odom_fresh)
        self._tracker.set_reconnecting(snapshot.robot_connected and not robot_connected)

    def start(self) -> None:
        self._stop_monitor()
        self._stop_event.clear()

        def loop() -> None:
            while not self._stop_event.wait(STREAM_STATUS_POLL_INTERVAL_S):
                self.refresh()

        self._thread = threading.Thread(target=loop, name="ar-stream-status", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_monitor()

    def broadcast(self) -> None:
        self._sender.send(self.status_payload())

    def status_payload(self) -> str:
        return encode_bridge_status(self._tracker.snapshot())

    def snapshot(self) -> BridgeStatusSnapshot:
        return self._tracker.snapshot()

    def set_registered(
        self,
        registered: bool,
        *,
        method: Literal["manual", "tag"] | None = None,
        approximate: bool | None = None,
    ) -> None:
        self._tracker.set_registered(registered, method=method, approximate=approximate)

    def _on_tracker_change(self) -> None:
        self._sender.send(self.status_payload())

    def _stop_monitor(self) -> None:
        self._stop_event.set()
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=1.0)
        self._thread = None
