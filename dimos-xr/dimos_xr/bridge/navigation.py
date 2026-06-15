"""NavController — navigation goal lifecycle, watchdog thread, and nav status.

Owns all mutable navigation state, the watchdog thread that detects stalled
goals, and the per-message handlers called from XRBridge handle_xr_* and
WebSocket callbacks.
"""

from __future__ import annotations

import threading
import time
from typing import TYPE_CHECKING

from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.utils.logging_config import setup_logger

from dimos_xr.network.data_plane import (
    build_empty_path_payload,
    build_path_payload,
    normalize_nav_state,
)
from dimos_xr.network.error_codes import NAV_GOAL_STALLED
from dimos_xr.network.protocol import NavGoalMessage, encode_nav_status
from dimos_xr.tracking.tag_tracker import _orientation_yaw_deg

if TYPE_CHECKING:
    from dimos.msgs.nav_msgs.Path import Path
    from dimos_lcm.std_msgs import Bool

    from dimos_xr.adapters.base import XRRobotAdapterSpec
    from dimos_xr.bridge.sender import BridgeSender
    from dimos_xr.tracking.transforms import Calibration

logger = setup_logger()

NAV_GOAL_PATH_TIMEOUT_S: float = 8.0
NAV_RECOVERY_MAX_ATTEMPTS: int = 2
NAV_WATCHDOG_POLL_INTERVAL_S: float = 0.5


class NavController:
    """Navigation goal lifecycle, watchdog, and nav_status broadcaster."""

    def __init__(
        self,
        *,
        robot_id: str,
        sender: BridgeSender,
        calibration: Calibration,
        adapter: XRRobotAdapterSpec,
    ) -> None:
        self._robot_id = robot_id
        self._sender = sender
        self._calibration = calibration
        self._adapter = adapter

        self._nav_state: str = "idle"
        self._goal_reached: bool = False
        self._goal_failed: bool = False
        self._nav_goal_pending: bool = False
        self._nav_path_received: bool = False
        self._nav_goal_dispatch_mono: float | None = None
        self._nav_recovery_attempts: int = 0
        self._nav_degraded: bool = False
        self._nav_recovering: bool = False
        self._nav_error_code: int | None = None
        self._nav_watchdog_lock = threading.Lock()
        self._nav_watchdog_stop = threading.Event()
        self._nav_watchdog_thread: threading.Thread | None = None
        self._last_executing_path_payload: str | None = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> None:
        if self._nav_watchdog_thread is not None:
            return
        self._nav_watchdog_stop.clear()
        self._nav_watchdog_thread = threading.Thread(
            target=self._watchdog_loop,
            name="XRBridgeNavWatchdog",
            daemon=True,
        )
        self._nav_watchdog_thread.start()

    def stop(self) -> None:
        self._nav_watchdog_stop.set()
        thread = self._nav_watchdog_thread
        if thread is not None:
            thread.join(timeout=1.0)
        self._nav_watchdog_thread = None

    # ------------------------------------------------------------------
    # Public accessors
    # ------------------------------------------------------------------

    @property
    def last_executing_path_payload(self) -> str | None:
        return self._last_executing_path_payload

    def nav_status_payload(self, *, ts: float | None = None) -> str:
        return encode_nav_status(
            ts=ts,
            state=self._nav_state,
            goal_reached=self._goal_reached,
            goal_failed=self._goal_failed,
            recovering=self._nav_recovering,
            error_code=self._nav_error_code,
            robot_id=self._robot_id,
        )

    def broadcast_nav_status(self, *, ts: float | None = None) -> None:
        self._sender.send(self.nav_status_payload(ts=ts))

    # ------------------------------------------------------------------
    # WebSocket message handlers
    # ------------------------------------------------------------------

    def on_nav_goal(self, msg: NavGoalMessage) -> None:
        if not self._calibration.is_registered:
            logger.warning("nav_goal ignored before calibration")
            return
        if self._nav_degraded:
            logger.warning("nav_goal rejected: navigation is unavailable for this session")
            self._goal_failed = True
            self._goal_reached = False
            self._nav_error_code = NAV_GOAL_STALLED.code
            self._nav_state = "idle"
            self._nav_recovering = False
            self._broadcast_empty_path(ts=msg.ts)
            self.broadcast_nav_status(ts=msg.ts)
            return
        self._goal_reached = False
        self._goal_failed = False
        self._nav_error_code = None
        self._nav_recovering = False
        self._nav_path_received = False
        self._nav_state = "idle"
        with self._nav_watchdog_lock:
            self._nav_goal_pending = True
            self._nav_goal_dispatch_mono = time.monotonic()
        if msg.orientation is not None:
            odom_position, odom_orientation = self._calibration.inverse_transform_pose(
                msg.position,
                msg.orientation,
            )
        else:
            odom_position = self._calibration.inverse_transform_point(msg.position)
            odom_orientation = (0.0, 0.0, 0.0, 1.0)
        goal = PoseStamped(
            position=list(odom_position),
            orientation=list(odom_orientation),
            ts=msg.ts,
            frame_id="odom",
        )
        self.broadcast_nav_status(ts=msg.ts)
        threading.Thread(
            target=self._publish_nav_goal,
            args=(goal, msg, odom_position, odom_orientation),
            daemon=True,
        ).start()

    def on_cancel_goal(self, ts: float | None = None) -> None:
        self._goal_reached = False
        self._goal_failed = False
        self._nav_error_code = None
        self._nav_recovering = False
        self._nav_state = "idle"
        self._reset_goal_tracking(reset_recovery=True)
        self._broadcast_empty_path(ts=ts)
        self.broadcast_nav_status(ts=ts)
        self._cancel_goal_async()

    def on_emergency_stop(self, ts: float | None = None) -> None:
        self._goal_reached = False
        self._goal_failed = False
        self._nav_error_code = None
        self._nav_recovering = False
        self._nav_state = "idle"
        self._reset_goal_tracking(reset_recovery=True)
        self._broadcast_empty_path(ts=ts)
        self.broadcast_nav_status(ts=ts)
        threading.Thread(
            target=self._cancel_or_stop,
            kwargs={"emergency": True},
            daemon=True,
        ).start()

    # ------------------------------------------------------------------
    # Stream handlers (called from XRBridge.handle_xr_*)
    # ------------------------------------------------------------------

    def on_path(self, msg: Path) -> None:
        path_payload, waypoints = build_path_payload(
            msg,
            calibration=self._calibration,
            robot_id=self._robot_id,
        )
        if waypoints and self._nav_goal_pending and not self._nav_path_received:
            self._promote_to_following_path(ts=msg.ts)
        if waypoints:
            self._last_executing_path_payload = path_payload
        elif self._nav_state == "idle":
            self._last_executing_path_payload = None
        self._sender.send(path_payload)

    def on_goal_reached(self, msg: Bool) -> None:
        self._goal_reached = bool(msg.data)
        was_pending = self._nav_goal_pending
        self._goal_failed = was_pending and not self._goal_reached
        self._nav_recovering = False
        self._nav_error_code = None
        self._reset_goal_tracking(reset_recovery=self._goal_reached)
        if self._goal_reached or self._goal_failed:
            self._nav_state = "idle"
            self._broadcast_empty_path()
        self.broadcast_nav_status()

    def on_navigation_state(self, msg: str) -> None:
        normalized = normalize_nav_state(msg)
        if (
            normalized == "idle"
            and self._nav_goal_pending
            and not self._nav_path_received
            and not self._nav_degraded
        ):
            self.handle_goal_stall()
            return
        if (
            normalized == "idle"
            and self._nav_goal_pending
            and self._nav_path_received
            and not self._goal_reached
            and not self._goal_failed
            and not self._nav_degraded
        ):
            self._nav_state = "recovery"
            self._nav_recovering = True
            self.broadcast_nav_status()
            return
        self._nav_state = normalized
        if self._nav_state == "following_path":
            self._goal_reached = False
            self._goal_failed = False
            with self._nav_watchdog_lock:
                self._nav_goal_pending = True
                if not self._nav_path_received:
                    self._nav_path_received = True
                    self._nav_goal_dispatch_mono = None
        self.broadcast_nav_status()

    # ------------------------------------------------------------------
    # Stall / recovery
    # ------------------------------------------------------------------

    def handle_goal_stall(self) -> None:
        with self._nav_watchdog_lock:
            if self._nav_degraded or not self._nav_goal_pending or self._nav_path_received:
                return
            self._nav_recovery_attempts += 1
            attempts = self._nav_recovery_attempts

        if attempts <= NAV_RECOVERY_MAX_ATTEMPTS:
            logger.warning(
                "XR navigation goal stalled; attempting recovery",
                attempt=attempts,
                max_attempts=NAV_RECOVERY_MAX_ATTEMPTS,
            )
            self._recover_stuck_goal()
            return

        logger.error(
            "XR navigation goal stalled; recovery exhausted",
            attempts=attempts,
        )
        self._terminal_nav_failure()

    # ------------------------------------------------------------------
    # Disconnect reset
    # ------------------------------------------------------------------

    def reset_on_disconnect(self) -> None:
        self._nav_degraded = False
        self._nav_error_code = None
        self._nav_recovering = False
        self._goal_failed = False
        self._goal_reached = False
        self._nav_state = "idle"
        self._reset_goal_tracking(reset_recovery=True)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _watchdog_loop(self) -> None:
        while not self._nav_watchdog_stop.wait(timeout=NAV_WATCHDOG_POLL_INTERVAL_S):
            with self._nav_watchdog_lock:
                if (
                    self._nav_degraded
                    or not self._nav_goal_pending
                    or self._nav_path_received
                    or self._nav_goal_dispatch_mono is None
                ):
                    continue
                elapsed = time.monotonic() - self._nav_goal_dispatch_mono
                if elapsed < NAV_GOAL_PATH_TIMEOUT_S:
                    continue
            self.handle_goal_stall()

    def _reset_goal_tracking(self, *, reset_recovery: bool = False) -> None:
        with self._nav_watchdog_lock:
            self._nav_goal_pending = False
            self._nav_path_received = False
            self._nav_goal_dispatch_mono = None
            self._nav_recovering = False
            if reset_recovery:
                self._nav_recovery_attempts = 0

    def _cancel_goal_async(self) -> None:
        threading.Thread(
            target=self._cancel_or_stop,
            kwargs={"emergency": False},
            daemon=True,
        ).start()

    def _cancel_or_stop(self, *, emergency: bool) -> None:
        try:
            if emergency:
                self._adapter.emergency_stop()
            else:
                self._adapter.cancel_goal()
        except Exception as exc:
            logger.exception("XR control command failed", emergency=emergency, error=str(exc))

    def _publish_nav_goal(
        self,
        goal: PoseStamped,
        msg: NavGoalMessage,
        odom_position: tuple[float, float, float],
        odom_orientation: tuple[float, float, float, float],
    ) -> None:
        """Publish goal to the adapter off the WebSocket event loop."""
        try:
            if not self._adapter.send_nav_goal(goal):
                raise RuntimeError("adapter rejected goal")
            logger.info(
                "XR navigation goal published",
                world_goal=[round(v, 3) for v in msg.position],
                odom_goal=[round(v, 3) for v in odom_position],
                world_goal_yaw_deg=(
                    _orientation_yaw_deg(msg.orientation) if msg.orientation is not None else None
                ),
                odom_goal_yaw_deg=_orientation_yaw_deg(odom_orientation),
            )
        except Exception as exc:
            self._goal_failed = True
            self._reset_goal_tracking(reset_recovery=False)
            self._nav_state = "idle"
            logger.exception("XR navigation goal publish failed", error=str(exc))
            self._broadcast_empty_path(ts=msg.ts)
            self.broadcast_nav_status(ts=msg.ts)

    def _recover_stuck_goal(self) -> None:
        self._goal_reached = False
        self._goal_failed = False
        self._nav_error_code = None
        self._nav_state = "idle"
        self._reset_goal_tracking(reset_recovery=False)
        self._nav_recovering = True
        self._broadcast_empty_path()
        self.broadcast_nav_status()
        self._cancel_goal_async()

    def _terminal_nav_failure(self) -> None:
        self._nav_degraded = True
        self._goal_reached = False
        self._goal_failed = True
        self._nav_error_code = NAV_GOAL_STALLED.code
        self._nav_state = "idle"
        self._nav_recovering = False
        self._reset_goal_tracking(reset_recovery=False)
        self._broadcast_empty_path()
        self.broadcast_nav_status()
        self._cancel_goal_async()

    def _promote_to_following_path(self, *, ts: float | None = None) -> None:
        with self._nav_watchdog_lock:
            if not self._nav_goal_pending:
                return
            self._nav_path_received = True
            self._nav_goal_dispatch_mono = None
            self._nav_recovering = False
        self._nav_state = "following_path"
        self._goal_failed = False
        self._nav_error_code = None
        self.broadcast_nav_status(ts=ts)

    def _broadcast_empty_path(self, *, ts: float | None = None) -> None:
        self._last_executing_path_payload = None
        self._sender.send(build_empty_path_payload(robot_id=self._robot_id, ts=ts))
