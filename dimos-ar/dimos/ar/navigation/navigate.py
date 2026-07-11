"""NavigateGoalHandler — navigation goal lifecycle, watchdog thread, and nav status."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import math
import threading
import time
from typing import TYPE_CHECKING, Literal

from dimos.ar.navigation.nav_state import normalize_nav_state
from dimos.ar.navigation.world_transform import resolve_world_goal
from dimos.ar.network.data_plane import (
    build_empty_path_payload,
    build_path_payload,
)
from dimos.ar.network.protocol import (
    NavGoalMessage,
    NavTerminalOutcome,
    encode_nav_status,
)
from dimos.ar.tag_tracking.solve import orientation_yaw_deg
from dimos.ar.utils.console import log_checkpoint
from dimos.ar.utils.log_on_change import log_info_on_change
from dimos.ar.world_frame.state import WorldFrameState
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from dimos_lcm.std_msgs import Bool

    from dimos.ar.bridge.motion_router import MotionRouter
    from dimos.ar.bridge.sender import BridgeSender
    from dimos.ar.navigation.world_transform import OdomGoal
    from dimos.ar.world_frame.transforms import OdomSample
    from dimos.msgs.nav_msgs.Path import Path

logger = setup_logger()

NAV_GOAL_PATH_TIMEOUT_S: float = 8.0
NAV_WATCHDOG_POLL_INTERVAL_S: float = 0.5
NAV_MESSAGE_AGE_LOG_INTERVAL_S: float = 5.0
NAV_GOAL_REDISPATCH_MIN_DELTA_M: float = 0.15
NAV_ARRIVAL_SHORTFALL_WARN_M: float = 0.25
NAV_ERROR_ROBOT_OFFLINE: int = 503
StallReason = str
SessionPhase = Literal["intent", "navigating"]


@dataclass
class NavSession:
    position: tuple[float, float, float]
    orientation: tuple[float, float, float, float] | None
    dispatched_mono: float | None
    path_received: bool
    last_path_mono: float | None
    phase: SessionPhase
    odom_position: tuple[float, float, float] | None = None
    odom_orientation: tuple[float, float, float, float] | None = None


class NavigateGoalHandler:
    """Navigation goal lifecycle, watchdog, and nav_status broadcaster."""

    def __init__(
        self,
        *,
        robot_id: str,
        sender: BridgeSender,
        world_frame: WorldFrameState,
        motion_router: MotionRouter,
        odom_latest: Callable[[], OdomSample | None] | None = None,
        robot_connected: Callable[[], bool] | None = None,
    ) -> None:
        self._robot_id = robot_id
        self._sender = sender
        self._world_frame = world_frame
        self._motion_router = motion_router
        self._odom_latest = odom_latest
        self._robot_connected = robot_connected

        self._session: NavSession | None = None
        self._terminalOutcome: NavTerminalOutcome | None = None
        self._nav_error_code: int | None = None
        self._stallLatched: bool = False
        self._nav_watchdog_lock = threading.Lock()
        self._nav_watchdog_stop = threading.Event()
        self._nav_watchdog_thread: threading.Thread | None = None
        # Reconnect-only path cache for runtime_snapshot — not live nav authority.
        self._last_navigating_path_waypoints: list[tuple[float, float, float]] | None = None
        self._nav_state_log_store: dict[str, str] = {}
        self._last_path_age_log_mono: float = 0.0
        self._last_goal_reached_age_log_mono: float = 0.0

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

    def nav_wire_dict(self) -> dict[str, object]:
        if self._terminalOutcome is not None:
            payload: dict[str, object] = {
                "state": "resolved",
                "outcome": self._terminalOutcome,
            }
            if self._nav_error_code is not None:
                payload["error_code"] = self._nav_error_code
            return payload
        if self._stallLatched:
            return {"state": "navIntent"}
        if self._session is None:
            return {"state": "idle"}
        if self._session.phase == "navigating":
            return {"state": "navigating"}
        return {"state": "navIntent"}

    def nav_status_payload(
        self,
        *,
        ts: float | None = None,
        retryable: bool | None = None,
        stall_reason: StallReason | None = None,
    ) -> str:
        wire = self.nav_wire_dict()
        state = wire["state"]
        outcome = wire.get("outcome")
        resolved_outcome = (
            outcome
            if state == "resolved" and isinstance(outcome, str)
            else None
        )
        error_code = (
            self._nav_error_code
            if state == "resolved" and resolved_outcome == "failed"
            else None
        )
        return encode_nav_status(
            ts=ts,
            state=state,  # type: ignore[arg-type]
            outcome=resolved_outcome,  # type: ignore[arg-type]
            error_code=error_code,
            retryable=retryable,
            stall_reason=stall_reason,
        )

    def runtime_snapshot_path(self) -> dict[str, object] | None:
        if self._last_navigating_path_waypoints is None:
            return None
        return {
            "waypoints": [list(point) for point in self._last_navigating_path_waypoints],
        }

    def broadcast_nav_status(self, *, ts: float | None = None) -> None:
        self._sender.send(self.nav_status_payload(ts=ts))

    # ------------------------------------------------------------------
    # Ingress core
    # ------------------------------------------------------------------

    def submit_goal(
        self,
        *,
        position: tuple[float, float, float],
        orientation: tuple[float, float, float, float] | None,
        ts: float,
    ) -> None:
        if not self._world_frame.is_committed:
            logger.warning("goal ignored before world frame committed")
            return
        if self._robot_connected is not None and not self._robot_connected():
            logger.error("AR navigation goal rejected — robot not connected")
            self._terminalOutcome = "failed"
            self._nav_error_code = NAV_ERROR_ROBOT_OFFLINE
            self._broadcast_empty_path(ts=ts)
            self.broadcast_nav_status(ts=ts)
            return
        msg = NavGoalMessage(
            ts=ts,
            robot_id=self._robot_id,
            position=position,
            orientation=orientation,
        )
        odom_goal = resolve_world_goal(self._world_frame, msg)
        if odom_goal is None:
            return
        was_navigating = (
            self._session is not None
            and self._session.phase == "navigating"
            and self._terminalOutcome is None
        )
        self._terminalOutcome = None
        self._nav_error_code = None
        self._stallLatched = False
        if was_navigating:
            assert self._session is not None
            self._session = NavSession(
                position=position,
                orientation=orientation,
                dispatched_mono=self._session.dispatched_mono,
                path_received=True,
                last_path_mono=self._session.last_path_mono,
                phase="navigating",
                odom_position=odom_goal.position,
                odom_orientation=odom_goal.orientation,
            )
        else:
            self._session = NavSession(
                position=position,
                orientation=orientation,
                dispatched_mono=None,
                path_received=False,
                last_path_mono=None,
                phase="intent",
                odom_position=odom_goal.position,
                odom_orientation=odom_goal.orientation,
            )
        goal = PoseStamped(
            position=list(odom_goal.position),
            orientation=list(odom_goal.orientation),
            ts=ts,
            frame_id="odom",
        )
        if not was_navigating:
            self.broadcast_nav_status(ts=ts)
        self._motion_router.send_nav_goal(
            goal,
            on_complete=lambda ok, err: self._on_goal_dispatched(
                ok,
                err,
                msg=msg,
                odom_goal=odom_goal,
            ),
        )

    # ------------------------------------------------------------------
    # WebSocket message handlers
    # ------------------------------------------------------------------

    def on_navigate_goal(self, msg: NavGoalMessage) -> None:
        self.submit_goal(
            position=msg.position,
            orientation=msg.orientation,
            ts=msg.ts,
        )

    def on_cancel_nav_goal(self, ts: float | None = None) -> None:
        logger.info("AR navigation goal cancelled")
        self._terminalOutcome = None
        self._nav_error_code = None
        self._clear_session()
        self._broadcast_empty_path(ts=ts)
        self.broadcast_nav_status(ts=ts)
        self._motion_router.cancel_nav_goal(on_complete=self._on_control_dispatched)

    def on_emergency_stop(self, ts: float | None = None) -> None:
        logger.info("AR emergency_stop handled nav_reset=true")
        self._terminalOutcome = None
        self._nav_error_code = None
        self._clear_session()
        self._broadcast_empty_path(ts=ts)
        self.broadcast_nav_status(ts=ts)
        self._motion_router.emergency_stop(on_complete=self._on_control_dispatched)

    def on_preempted(self, ts: float | None = None) -> None:
        """Joystick preemption: reset tracking without marking goal failed."""
        self._terminalOutcome = None
        self._nav_error_code = None
        self._clear_session()
        self._broadcast_empty_path(ts=ts)
        self.broadcast_nav_status(ts=ts)

    def on_world_frame_corrected(self) -> None:
        with self._nav_watchdog_lock:
            session = self._session
            if (
                session is None
                or self._terminalOutcome is not None
                or session.phase != "navigating"
            ):
                return
            position = session.position
            orientation = session.orientation
            prior_odom_position = session.odom_position

        msg = NavGoalMessage(
            ts=time.time(),
            robot_id=self._robot_id,
            position=position,
            orientation=orientation,
        )
        odom_goal = resolve_world_goal(self._world_frame, msg)
        if odom_goal is None:
            return
        if prior_odom_position is not None and _planar_odom_distance_m(
            prior_odom_position,
            odom_goal.position,
        ) < NAV_GOAL_REDISPATCH_MIN_DELTA_M:
            return

        goal = PoseStamped(
            position=list(odom_goal.position),
            orientation=list(odom_goal.orientation),
            ts=msg.ts,
            frame_id="odom",
        )
        self._motion_router.send_nav_goal(
            goal,
            on_complete=lambda ok, err: self._on_correction_redispatched(
                ok,
                err,
                odom_goal=odom_goal,
            ),
        )

    # ------------------------------------------------------------------
    # Stream handlers (called from ARBridge.handle_ar_*)
    # ------------------------------------------------------------------

    def on_path(self, msg: Path) -> None:
        self._maybe_log_message_age(
            msg,
            event="AR navigation path age",
            last_log_attr="_last_path_age_log_mono",
        )
        path_payload, waypoints = build_path_payload(
            msg,
            world_frame=self._world_frame,
        )
        if (
            waypoints
            and self._session is not None
            and self._terminalOutcome is None
            and not self._session.path_received
        ):
            self._promote_to_navigating(ts=msg.ts, path_waypoints=len(waypoints))
        if waypoints:
            self._last_navigating_path_waypoints = waypoints
            if self._session is not None:
                self._session.last_path_mono = time.monotonic()
        elif self._session is None or self._session.phase == "intent":
            self._last_navigating_path_waypoints = None
        self._sender.send(path_payload)

    def on_goal_reached(self, msg: Bool) -> None:
        self._maybe_log_message_age(
            msg,
            event="AR navigation goal_reached age",
            last_log_attr="_last_goal_reached_age_log_mono",
        )
        had_session = self._session is not None and self._terminalOutcome is None
        reached = bool(msg.data)
        session_odom_position: tuple[float, float, float] | None = None
        with self._nav_watchdog_lock:
            if self._session is not None:
                session_odom_position = self._session.odom_position
        if had_session and reached:
            self._terminalOutcome = "succeeded"
            log_checkpoint(logger, kind="success", event="AR navigation goal reached")
            self._log_arrival_shortfall(session_odom_position)
        elif had_session and not reached:
            self._terminalOutcome = "failed"
            logger.info("AR navigation goal failed")
        self._nav_error_code = None
        self._clear_session()
        if had_session and (reached or not reached):
            self._broadcast_empty_path()
        self.broadcast_nav_status()
        if had_session and not reached:
            self._motion_router.emergency_stop(on_complete=self._on_control_dispatched)

    def on_navigation_state(self, msg: str) -> None:
        """Upstream navigation_state — unreached on shipped blueprints; recovery uses watchdog."""
        normalized = normalize_nav_state(msg)
        if (
            normalized == "idle"
            and self._session is not None
            and self._terminalOutcome is None
            and not self._session.path_received
        ):
            self.handle_goal_stall(stall_reason="planner_idle")
            return
        if (
            normalized == "idle"
            and self._session is not None
            and self._terminalOutcome is None
            and self._session.path_received
            and self._session.phase == "navigating"
        ):
            self._stallLatched = True
            self.broadcast_nav_status()
            return
        log_info_on_change(
            logger,
            self._nav_state_log_store,
            field="nav_state",
            key=normalized,
            event="AR navigation state updated",
            state=normalized,
        )
        if self._session is not None and normalized == "navigating":
            self._terminalOutcome = None
            self._nav_error_code = None
            self._session.phase = "navigating"
            if not self._session.path_received:
                self._session.path_received = True
                self._session.dispatched_mono = None
        elif normalized == "recovering":
            self._stallLatched = True
        elif normalized == "idle":
            pass
        self.broadcast_nav_status()

    # ------------------------------------------------------------------
    # Stall recovery
    # ------------------------------------------------------------------

    def handle_goal_stall(self, *, stall_reason: StallReason) -> None:
        with self._nav_watchdog_lock:
            if self._session is None or self._terminalOutcome is not None:
                return
        logger.warning(
            "AR navigation goal stalled",
            stall_reason=stall_reason,
        )
        self._terminalOutcome = None
        self._nav_error_code = None
        self._stallLatched = True
        self._broadcast_empty_path()
        self._broadcast_stall_nav_status(stall_reason=stall_reason)
        self._clear_session()
        self._motion_router.cancel_nav_goal(on_complete=self._on_control_dispatched)

    # ------------------------------------------------------------------
    # Disconnect reset
    # ------------------------------------------------------------------

    def reset_on_disconnect(self) -> None:
        self._nav_error_code = None
        self._terminalOutcome = None
        self._stallLatched = False
        self._clear_session()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _watchdog_loop(self) -> None:
        while not self._nav_watchdog_stop.wait(timeout=NAV_WATCHDOG_POLL_INTERVAL_S):
            with self._nav_watchdog_lock:
                if self._session is None or self._terminalOutcome is not None:
                    continue
                dispatch_mono = self._session.dispatched_mono
                if dispatch_mono is None:
                    continue
                last_activity = dispatch_mono
                if self._session.last_path_mono is not None:
                    last_activity = max(last_activity, self._session.last_path_mono)
                elapsed = time.monotonic() - last_activity
                if elapsed < NAV_GOAL_PATH_TIMEOUT_S:
                    continue
            self.handle_goal_stall(stall_reason="no_path")

    def _clear_session(self) -> None:
        with self._nav_watchdog_lock:
            self._session = None

    def _on_control_dispatched(self, ok: bool, err: BaseException | None) -> None:
        if ok:
            return
        if err is not None:
            logger.warning("AR control command failed", error=str(err))
        else:
            logger.warning("AR control command rejected")

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
                if self._session is not None:
                    self._session.dispatched_mono = time.monotonic()
                    self._session.last_path_mono = None
                    self._session.odom_position = odom_goal.position
                    self._session.odom_orientation = odom_goal.orientation
            logger.info(
                "AR navigation goal published",
                world_goal=[round(v, 3) for v in msg.position],
                odom_goal=[round(v, 3) for v in odom_goal.position],
                world_goal_yaw_deg=(
                    orientation_yaw_deg(msg.orientation) if msg.orientation is not None else None
                ),
                odom_goal_yaw_deg=orientation_yaw_deg(odom_goal.orientation),
            )
            return
        self._terminalOutcome = "failed"
        self._clear_session()
        error = str(err) if err is not None else "goal publish rejected"
        logger.error("AR navigation goal publish failed", error=error)
        self._broadcast_empty_path(ts=msg.ts)
        self.broadcast_nav_status(ts=msg.ts)

    def _on_correction_redispatched(
        self,
        ok: bool,
        err: BaseException | None,
        *,
        odom_goal: OdomGoal,
    ) -> None:
        if not ok:
            if err is not None:
                logger.warning(
                    "AR navigation goal redispatch after world-frame correction failed",
                    error=str(err),
                )
            else:
                logger.warning(
                    "AR navigation goal redispatch after world-frame correction rejected",
                )
            return
        with self._nav_watchdog_lock:
            if self._session is not None:
                self._session.dispatched_mono = time.monotonic()
                self._session.odom_position = odom_goal.position
                self._session.odom_orientation = odom_goal.orientation
        logger.info(
            "AR navigation goal redispatched after world-frame correction",
            odom_goal=[round(v, 3) for v in odom_goal.position],
        )

    def _log_arrival_shortfall(
        self,
        dispatched_odom_position: tuple[float, float, float] | None,
    ) -> None:
        if dispatched_odom_position is None or self._odom_latest is None:
            return
        sample = self._odom_latest()
        if sample is None:
            return
        shortfall_m = _planar_odom_distance_m(
            dispatched_odom_position,
            sample.position,
        )
        log_fn = logger.warning if shortfall_m > NAV_ARRIVAL_SHORTFALL_WARN_M else logger.info
        log_fn(
            "AR navigation arrival shortfall",
            arrival_shortfall_m=round(shortfall_m, 3),
        )

    def _promote_to_navigating(
        self,
        *,
        ts: float | None = None,
        path_waypoints: int | None = None,
    ) -> None:
        with self._nav_watchdog_lock:
            if self._session is None or self._terminalOutcome is not None:
                return
            self._session.path_received = True
            self._session.dispatched_mono = None
            self._session.phase = "navigating"
        self._nav_error_code = None
        logger.info(
            "AR navigation navigating",
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

    def _maybe_log_message_age(
        self,
        msg: object,
        *,
        event: str,
        last_log_attr: str,
    ) -> None:
        source_ts = getattr(msg, "ts", None)
        if source_ts is None:
            return
        now = time.monotonic()
        last_log_mono = getattr(self, last_log_attr)
        if now - last_log_mono < NAV_MESSAGE_AGE_LOG_INTERVAL_S:
            return
        setattr(self, last_log_attr, now)
        logger.info(
            event,
            age_s=round(max(0.0, time.time() - float(source_ts)), 3),
        )


def _planar_odom_distance_m(
    a: tuple[float, float, float],
    b: tuple[float, float, float],
) -> float:
    # Odom-frame internal distance for arrival shortfall; intentionally not scaled.
    dx = a[0] - b[0]
    dz = a[2] - b[2]
    return math.hypot(dx, dz)
