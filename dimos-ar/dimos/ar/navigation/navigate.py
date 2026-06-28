"""NavigateGoalHandler — navigation goal lifecycle, watchdog thread, and nav status."""

from __future__ import annotations

import threading
import time
from typing import TYPE_CHECKING

from dimos.ar.navigation.world_transform import resolve_world_goal
from dimos.ar.navigation.nav_state import normalize_nav_state
from dimos.ar.network.data_plane import (
    build_empty_path_payload,
    build_path_payload,
)
from dimos.ar.network.protocol import NavGoalMessage, encode_nav_status, nav_phase_payload
from dimos.ar.tag_tracking.solve import orientation_yaw_deg
from dimos.ar.world_frame.state import WorldFrameState
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.ar.utils.log_on_change import log_info_on_change
from dimos.ar.utils.console import log_checkpoint
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from dimos_lcm.std_msgs import Bool

    from dimos.ar.bridge.adapter_command_queue import AdapterCommandQueue
    from dimos.ar.navigation.world_transform import OdomGoal
    from dimos.ar.bridge.sender import BridgeSender
    from dimos.msgs.nav_msgs.Path import Path

logger = setup_logger()

NAV_GOAL_PATH_TIMEOUT_S: float = 8.0
NAV_WATCHDOG_POLL_INTERVAL_S: float = 0.5
StallReason = str


class NavigateGoalHandler:
    """Navigation goal lifecycle, watchdog, and nav_status broadcaster."""

    def __init__(
        self,
        *,
        robot_id: str,
        sender: BridgeSender,
        world_frame: WorldFrameState,
        command_queue: AdapterCommandQueue,
    ) -> None:
        self._robot_id = robot_id
        self._sender = sender
        self._world_frame = world_frame
        self._command_queue = command_queue

        # Normalized DimOS nav-stack state (idle / navigating / recovery).
        self._dimos_nav_state: str = "idle"
        self._goal_reached: bool = False
        self._goal_failed: bool = False
        self._nav_goal_pending: bool = False
        self._nav_path_received: bool = False
        self._nav_goal_dispatch_mono: float | None = None
        self._nav_error_code: int | None = None
        self._nav_watchdog_lock = threading.Lock()
        self._nav_watchdog_stop = threading.Event()
        self._nav_watchdog_thread: threading.Thread | None = None
        # Reconnect-only path cache for runtime_snapshot — not live nav authority.
        self._last_navigating_path_waypoints: list[tuple[float, float, float]] | None = None
        self._nav_state_log_store: dict[str, str] = {}

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> None:
        if self._nav_watchdog_thread is not None:
            return
        self._nav_watchdog_stop.clear()
        self._nav_watchdog_thread = threading.Thread(
            target=self._watchdog_loop,
            name="ARBridgeNavWatchdog",
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

    def nav_phase_dict(self) -> dict[str, object]:
        return nav_phase_payload(
            goal_reached=self._goal_reached,
            goal_failed=self._goal_failed,
            nav_state=self._dimos_nav_state,
            nav_goal_pending=self._nav_goal_pending,
            error_code=self._nav_error_code,
        )

    def nav_status_payload(
        self,
        *,
        ts: float | None = None,
        retryable: bool | None = None,
        stall_reason: StallReason | None = None,
    ) -> str:
        phase_payload = self.nav_phase_dict()
        return encode_nav_status(
            ts=ts,
            phase=phase_payload["phase"],  # type: ignore[arg-type]
            error_code=self._nav_error_code,
            retryable=retryable,
            stall_reason=stall_reason,
        )

    def runtime_snapshot_path(self) -> dict[str, object] | None:
        if self._last_navigating_path_waypoints is None:
            return None
        return {
            "kind": "active",
            "waypoints": [list(point) for point in self._last_navigating_path_waypoints],
        }

    def broadcast_nav_status(self, *, ts: float | None = None) -> None:
        self._sender.send(self.nav_status_payload(ts=ts))

    # ------------------------------------------------------------------
    # WebSocket message handlers
    # ------------------------------------------------------------------

    def on_navigate_goal(self, msg: NavGoalMessage) -> None:
        if msg.intent != "navigate":
            return
        if not self._world_frame.is_committed:
            logger.warning("goal ignored before world frame committed")
            return
        odom_goal = resolve_world_goal(self._world_frame, msg)
        if odom_goal is None:
            return
        self._goal_reached = False
        self._goal_failed = False
        self._nav_error_code = None
        self._nav_path_received = False
        self._dimos_nav_state = "idle"
        with self._nav_watchdog_lock:
            self._nav_goal_pending = True
        goal = PoseStamped(
            position=list(odom_goal.position),
            orientation=list(odom_goal.orientation),
            ts=msg.ts,
            frame_id="odom",
        )
        self.broadcast_nav_status(ts=msg.ts)
        self._command_queue.submit_nav_goal(
            goal,
            on_complete=lambda ok, err: self._on_goal_dispatched(
                ok,
                err,
                msg=msg,
                odom_goal=odom_goal,
            ),
        )

    def on_cancel_nav_goal(self, ts: float | None = None) -> None:
        logger.info("XR navigation goal cancelled")
        self._goal_reached = False
        self._goal_failed = False
        self._nav_error_code = None
        self._dimos_nav_state = "idle"
        self._reset_goal_tracking()
        self._broadcast_empty_path(ts=ts)
        self.broadcast_nav_status(ts=ts)
        self._command_queue.submit_cancel_goal(on_complete=self._on_control_dispatched)

    def on_emergency_stop(self, ts: float | None = None) -> None:
        logger.info("XR emergency_stop handled nav_reset=true")
        self._goal_reached = False
        self._goal_failed = False
        self._nav_error_code = None
        self._dimos_nav_state = "idle"
        self._reset_goal_tracking()
        self._broadcast_empty_path(ts=ts)
        self.broadcast_nav_status(ts=ts)
        self._command_queue.submit_emergency_stop(on_complete=self._on_control_dispatched)

    # ------------------------------------------------------------------
    # Stream handlers (called from ARBridge.handle_ar_*)
    # ------------------------------------------------------------------

    def on_path(self, msg: Path) -> None:
        path_payload, waypoints = build_path_payload(
            msg,
            world_frame=self._world_frame,
        )
        if waypoints and self._nav_goal_pending and not self._nav_path_received:
            self._promote_to_navigating(ts=msg.ts, path_waypoints=len(waypoints))
        if waypoints:
            self._last_navigating_path_waypoints = waypoints
        elif self._dimos_nav_state == "idle":
            self._last_navigating_path_waypoints = None
        self._sender.send(path_payload)

    def on_goal_reached(self, msg: Bool) -> None:
        self._goal_reached = bool(msg.data)
        was_pending = self._nav_goal_pending
        self._goal_failed = was_pending and not self._goal_reached
        self._nav_error_code = None
        self._reset_goal_tracking()
        if self._goal_reached:
            log_checkpoint(logger, kind="success", event="XR navigation goal reached")
        elif self._goal_failed:
            logger.info("XR navigation goal failed")
        if self._goal_reached or self._goal_failed:
            self._dimos_nav_state = "idle"
            self._broadcast_empty_path()
        self.broadcast_nav_status()

    def on_navigation_state(self, msg: str) -> None:
        normalized = normalize_nav_state(msg)
        if normalized == "idle" and self._nav_goal_pending and not self._nav_path_received:
            self.handle_goal_stall(stall_reason="planner_idle")
            return
        if (
            normalized == "idle"
            and self._nav_goal_pending
            and self._nav_path_received
            and not self._goal_reached
            and not self._goal_failed
        ):
            self._dimos_nav_state = "recovery"
            self.broadcast_nav_status()
            return
        log_info_on_change(
            logger,
            self._nav_state_log_store,
            field="nav_state",
            key=normalized,
            event="XR navigation state updated",
            state=normalized,
        )
        self._dimos_nav_state = normalized
        if self._dimos_nav_state == "navigating":
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

    def handle_goal_stall(self, *, stall_reason: StallReason) -> None:
        with self._nav_watchdog_lock:
            if not self._nav_goal_pending or self._nav_path_received:
                return
        logger.warning(
            "XR navigation goal stalled",
            stall_reason=stall_reason,
        )
        self._goal_reached = False
        self._goal_failed = False
        self._nav_error_code = None
        self._reset_goal_tracking()
        self._dimos_nav_state = "recovery"
        self._broadcast_empty_path()
        self._broadcast_stall_nav_status(stall_reason=stall_reason)
        self._command_queue.submit_cancel_goal(on_complete=self._on_control_dispatched)

    # ------------------------------------------------------------------
    # Disconnect reset
    # ------------------------------------------------------------------

    def reset_on_disconnect(self) -> None:
        self._nav_error_code = None
        self._goal_failed = False
        self._goal_reached = False
        self._dimos_nav_state = "idle"
        self._reset_goal_tracking()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _watchdog_loop(self) -> None:
        while not self._nav_watchdog_stop.wait(timeout=NAV_WATCHDOG_POLL_INTERVAL_S):
            with self._nav_watchdog_lock:
                if (
                    not self._nav_goal_pending
                    or self._nav_path_received
                    or self._nav_goal_dispatch_mono is None
                ):
                    continue
                elapsed = time.monotonic() - self._nav_goal_dispatch_mono
                if elapsed < NAV_GOAL_PATH_TIMEOUT_S:
                    continue
            self.handle_goal_stall(stall_reason="no_path")

    def _reset_goal_tracking(self) -> None:
        with self._nav_watchdog_lock:
            self._nav_goal_pending = False
            self._nav_path_received = False
            self._nav_goal_dispatch_mono = None

    def _on_control_dispatched(self, ok: bool, err: BaseException | None) -> None:
        if ok:
            return
        if err is not None:
            logger.warning("XR control command failed", error=str(err))
        else:
            logger.warning("XR control command rejected by adapter")

    def _on_goal_dispatched(
        self,
        ok: bool,
        err: BaseException | None,
        *,
        msg: NavGoalMessage,
        odom_goal: OdomGoal,
    ) -> None:
        if ok:
            with self._nav_watchdog_lock:
                self._nav_goal_dispatch_mono = time.monotonic()
            logger.info(
                "XR navigation goal published",
                world_goal=[round(v, 3) for v in msg.position],
                odom_goal=[round(v, 3) for v in odom_goal.position],
                world_goal_yaw_deg=(
                    orientation_yaw_deg(msg.orientation) if msg.orientation is not None else None
                ),
                odom_goal_yaw_deg=orientation_yaw_deg(odom_goal.orientation),
            )
            return
        self._goal_failed = True
        self._reset_goal_tracking()
        self._dimos_nav_state = "idle"
        error = str(err) if err is not None else "adapter rejected goal"
        logger.error("XR navigation goal publish failed", error=error)
        self._broadcast_empty_path(ts=msg.ts)
        self.broadcast_nav_status(ts=msg.ts)

    def _promote_to_navigating(
        self,
        *,
        ts: float | None = None,
        path_waypoints: int | None = None,
    ) -> None:
        with self._nav_watchdog_lock:
            if not self._nav_goal_pending:
                return
            self._nav_path_received = True
            self._nav_goal_dispatch_mono = None
        self._dimos_nav_state = "navigating"
        self._goal_failed = False
        self._nav_error_code = None
        logger.info(
            "XR navigation navigating",
            path_waypoints=path_waypoints,
        )
        self.broadcast_nav_status(ts=ts)

    def _broadcast_empty_path(self, *, ts: float | None = None) -> None:
        self._last_navigating_path_waypoints = None
        self._sender.send(build_empty_path_payload(ts=ts))

    def _broadcast_stall_nav_status(self, *, stall_reason: StallReason, ts: float | None = None) -> None:
        self._sender.send(
            self.nav_status_payload(ts=ts, retryable=True, stall_reason=stall_reason)
        )
