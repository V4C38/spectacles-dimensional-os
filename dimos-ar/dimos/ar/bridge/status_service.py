"""StatusService — stream-freshness monitor and bridge_status broadcaster.

Wraps BridgeStatusTracker, owns the ``_last_lidar_mono`` / ``_last_odom_mono``
timestamps that drive the stream-stale check, and runs a daemon thread that
calls ``refresh()`` periodically. World-frame fields are merged at encode time
from WorldFrameState (single source of truth).
"""

from __future__ import annotations

import threading
import time
from typing import TYPE_CHECKING

from dimos.ar.network.bridge_status import BridgeStatusSnapshot, BridgeStatusTracker
from dimos.ar.network.protocol import bridge_status_wire, encode_bridge_status
from dimos.ar.utils.log_on_change import log_info_on_change
from dimos.ar.utils.console import log_checkpoint
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from dimos.ar.bridge.sender import BridgeSender
    from dimos.ar.world_frame.state import WorldFrameState

STREAM_STATUS_POLL_INTERVAL_S: float = 0.5

logger = setup_logger()


class StatusService:
    """Owns stream-staleness state and periodically refreshes bridge_status."""

    def __init__(
        self,
        *,
        robot_id: str,
        sender: BridgeSender,
        world_frame: WorldFrameState,
        stream_stale_timeout_s: float,
    ) -> None:
        self._sender = sender
        self._world_frame = world_frame
        self._stale_timeout = stream_stale_timeout_s
        self._tracker = BridgeStatusTracker(robot_id=robot_id, robot_connected=False)
        self._tracker.set_on_change(self._on_tracker_change)
        self._world_frame.set_on_change(self._on_tracker_change)
        self._last_lidar_mono: float | None = None
        self._last_odom_mono: float | None = None
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._connectivity_log_store: dict[str, str] = {}
        self._robot_connected_success_logged = False

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
        streams_active = lidar_fresh and odom_fresh
        reconnecting = snapshot.robot_connected and not robot_connected
        if robot_connected and not self._robot_connected_success_logged:
            self._robot_connected_success_logged = True
            log_checkpoint(
                logger,
                kind="success",
                event="bridge connectivity updated",
                robot_connected=robot_connected,
                streams_active=streams_active,
                reconnecting=reconnecting,
            )
        else:
            log_info_on_change(
                logger,
                self._connectivity_log_store,
                field="connectivity",
                key=f"{robot_connected}|{streams_active}|{reconnecting}",
                event="bridge connectivity updated",
                robot_connected=robot_connected,
                streams_active=streams_active,
                reconnecting=reconnecting,
            )
        if not robot_connected:
            self._robot_connected_success_logged = False
        self._tracker.set_robot_connected(robot_connected)
        self._tracker.set_streams_active(streams_active)
        self._tracker.set_reconnecting(reconnecting)

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
        return encode_bridge_status(self._tracker.snapshot(), world_frame=self._world_frame)

    def snapshot(self) -> BridgeStatusSnapshot:
        return self._tracker.snapshot()

    def merged_bridge_snapshot(self) -> dict[str, object]:
        """Bridge connection fields plus world-frame fields for runtime_snapshot."""
        return bridge_status_wire(
            self._tracker.snapshot(),
            world_frame=self._world_frame,
        )

    def _on_tracker_change(self) -> None:
        self._sender.send(self.status_payload())

    def _stop_monitor(self) -> None:
        self._stop_event.set()
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=1.0)
        self._thread = None
