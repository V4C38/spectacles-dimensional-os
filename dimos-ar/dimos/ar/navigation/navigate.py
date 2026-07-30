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
    WireGoalSource,
    encode_nav_status,
)
from dimos.ar.tag_tracking.solve import orientation_yaw_deg
from dimos.ar.utils.console import log_checkpoint
from dimos.ar.utils.log_on_change import log_info_on_change
from dimos.ar.world_frame.state import WorldFrameState
from dimos.ar.world_frame.transforms import pose_to_matrix, yaw_from_T
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
NAV_WATCHDOG_POLL_INTERVAL_S: float = 0.2
NAV_GOAL_REPUBLISH_MIN_INTERVAL_S: float = 1.0
NAV_MESSAGE_AGE_LOG_INTERVAL_S: float = 5.0
NAV_GOAL_REDISPATCH_MIN_DELTA_M: float = 0.75
NAV_ARRIVAL_SHORTFALL_WARN_M: float = 0.25
NAV_ERROR_ROBOT_OFFLINE: int = 503
APPROACH_STANDOFF_M: float = 0.8
APPROACH_MIN_HORIZONTAL_M: float = 0.05
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
    source: WireGoalSource = "user"
    odom_position: tuple[float, float, float] | None = None
    odom_orientation: tuple[float, float, float, float] | None = None


@dataclass
class _PendingRetarget:
    position: tuple[float, float, float]
    orientation: tuple[float, float, float, float] | None
    ts: float
    source: WireGoalSource
    coalesced_count: int


class NavigateGoalHandler:
    """Navigation goal lifecycle, watchdog, and nav_status broadcaster."""

    def __init__(
        self,
        *,
        robot_id: str,
        sender: BridgeSender,
        world_frame: WorldFrameState,
        motion_router: MotionRouter,
        base_height_m: float,
        odom_latest: Callable[[], OdomSample | None] | None = None,
        robot_connected: Callable[[], bool] | None = None,
    ) -> None:
        self._robot_id = robot_id
        self._sender = sender
        self._world_frame = world_frame
        self._motion_router = motion_router
        self._base_height_m = float(base_height_m)
        self._odom_latest = odom_latest
        self._robot_connected = robot_connected

        self._session: NavSession | None = None
        self._terminalOutcome: NavTerminalOutcome | None = None
        self._nav_error_code: int | None = None
        self._stallLatched: bool = False
        self._goal_lock = threading.Lock()
        # Alias: existing call sites / tests may still refer to the watchdog lock name.
        self._nav_watchdog_lock = self._goal_lock
        self._nav_watchdog_stop = threading.Event()
        self._nav_watchdog_thread: threading.Thread | None = None
        # Reconnect-only path cache for runtime_snapshot — not live nav authority.
        self._last_navigating_path_waypoints: list[tuple[float, float, float]] | None = None
        self._nav_state_log_store: dict[str, str] = {}
        self._last_path_age_log_mono: float = 0.0
        self._last_goal_reached_age_log_mono: float = 0.0
        self._last_goal_publish_mono: float | None = None
        self._pending_retarget: _PendingRetarget | None = None

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
        goal = self._goal_wire_block(self._session)
        if self._session.phase == "navigating":
            return {"state": "navigating", "goal": goal}
        return {"state": "navIntent", "goal": goal}

    @staticmethod
    def _goal_wire_block(session: NavSession) -> dict[str, object]:
        orientation = session.orientation if session.orientation is not None else (0.0, 0.0, 0.0, 1.0)
        return {
            "source": session.source,
            "position": list(session.position),
            "orientation": list(orientation),
        }

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
        goal = wire.get("goal")
        return encode_nav_status(
            ts=ts,
            state=state,  # type: ignore[arg-type]
            outcome=resolved_outcome,  # type: ignore[arg-type]
            error_code=error_code,
            retryable=retryable,
            stall_reason=stall_reason,
            goal=goal if isinstance(goal, dict) else None,
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
        source: WireGoalSource = "user",
        bypass_rate_limit: bool = False,
        coalesced_count: int = 0,
    ) -> None:
        if not self._world_frame.is_committed:
            logger.warning("goal ignored before world frame committed")
            return
        if self._robot_connected is not None and not self._robot_connected():
            logger.error("AR navigation goal rejected — robot not connected")
            with self._goal_lock:
                self._terminalOutcome = "failed"
                self._nav_error_code = NAV_ERROR_ROBOT_OFFLINE
                self._pending_retarget = None
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

        broadcast_status = False
        publish_coalesced = coalesced_count
        with self._goal_lock:
            was_navigating = (
                self._session is not None
                and self._session.phase == "navigating"
                and self._terminalOutcome is None
            )
            now = time.monotonic()
            if (
                was_navigating
                and not bypass_rate_limit
                and self._last_goal_publish_mono is not None
                and (now - self._last_goal_publish_mono) < NAV_GOAL_REPUBLISH_MIN_INTERVAL_S
            ):
                prev = self._pending_retarget
                merged = (prev.coalesced_count + 1) if prev is not None else 1
                self._pending_retarget = _PendingRetarget(
                    position=position,
                    orientation=orientation,
                    ts=ts,
                    source=source,
                    coalesced_count=merged,
                )
                assert self._session is not None
                self._session = NavSession(
                    position=position,
                    orientation=orientation,
                    dispatched_mono=self._session.dispatched_mono,
                    path_received=True,
                    last_path_mono=self._session.last_path_mono,
                    phase="navigating",
                    source=source,
                    odom_position=odom_goal.position,
                    odom_orientation=odom_goal.orientation,
                )
                return

            if self._pending_retarget is not None and bypass_rate_limit:
                publish_coalesced = max(publish_coalesced, self._pending_retarget.coalesced_count)
            self._pending_retarget = None
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
                    source=source,
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
                    source=source,
                    odom_position=odom_goal.position,
                    odom_orientation=odom_goal.orientation,
                )
            self._last_goal_publish_mono = now
            broadcast_status = not was_navigating

        goal = PoseStamped(
            position=list(odom_goal.position),
            orientation=list(odom_goal.orientation),
            ts=ts,
            frame_id="odom",
        )
        if broadcast_status:
            self.broadcast_nav_status(ts=ts)
        self._motion_router.send_nav_goal(
            goal,
            on_complete=lambda ok, err: self._on_goal_dispatched(
                ok,
                err,
                msg=msg,
                odom_goal=odom_goal,
                source=source,
                coalesced_count=publish_coalesced,
            ),
        )

    def _nav_context(self) -> tuple[OdomSample, float] | str:
        """Return ``(odom_sample, yaw_rad)`` or an explicit failure string."""
        if self._robot_connected is not None and not self._robot_connected():
            return "Robot is not connected"
        if not self._world_frame.is_committed:
            return "World frame is not committed"
        if self._odom_latest is None:
            return "No odometry available yet"
        sample = self._odom_latest()
        if sample is None:
            return "No odometry available yet"
        yaw = yaw_from_T(pose_to_matrix((0.0, 0.0, 0.0), sample.orientation))
        return sample, yaw

    @staticmethod
    def _relative_offset_odom(
        sample: OdomSample,
        yaw: float,
        forward: float,
        left: float,
        up: float = 0.0,
    ) -> tuple[float, float, float]:
        """Robot-relative meters → odom position (Y-up semantic on odom axes)."""
        # Y-up AR semantic: forward=(cos yaw, 0, -sin yaw); left=(-sin yaw, 0, -cos yaw).
        cos_y = math.cos(yaw)
        sin_y = math.sin(yaw)
        odom_x = sample.position[0] + float(forward) * cos_y + float(left) * (-sin_y)
        odom_y = sample.position[1] + float(up)
        odom_z = sample.position[2] + float(forward) * (-sin_y) + float(left) * (-cos_y)
        return odom_x, odom_y, odom_z

    def _robot_floor_world_y(self, robot_world_y: float) -> float:
        """Ground-contact world Y from visual-origin (marker / base_link) height."""
        return float(robot_world_y) - self._base_height_m

    def _pin_floor_y(
        self,
        world_position: tuple[float, float, float],
        *,
        robot_world_y: float,
    ) -> tuple[float, float, float]:
        """Keep world X/Z; replace Y with robot ground-contact height."""
        return (
            float(world_position[0]),
            self._robot_floor_world_y(robot_world_y),
            float(world_position[2]),
        )

    def robot_relative_to_world(
        self,
        forward: float,
        left: float,
        up: float = 0.0,
    ) -> tuple[float, float, float] | str:
        """Convert robot-relative meters to AR world position, or a failure string."""
        ctx = self._nav_context()
        if isinstance(ctx, str):
            return ctx
        sample, yaw = ctx
        odom_position = self._relative_offset_odom(sample, yaw, forward, left, up)
        world_position, _ = self._world_frame.transform_pose(
            odom_position,
            sample.orientation,
        )
        return world_position

    def world_to_robot_relative(
        self,
        world_position: tuple[float, float, float],
    ) -> tuple[float, float, float] | str:
        """Convert AR world position to robot-relative (forward, left, up) meters."""
        ctx = self._nav_context()
        if isinstance(ctx, str):
            return ctx
        sample, yaw = ctx
        odom_x, odom_y, odom_z = self._world_frame.inverse_transform_point(
            (
                float(world_position[0]),
                float(world_position[1]),
                float(world_position[2]),
            )
        )
        dx = odom_x - sample.position[0]
        dy = odom_y - sample.position[1]
        dz = odom_z - sample.position[2]
        cos_y = math.cos(yaw)
        sin_y = math.sin(yaw)
        # Inverse of _relative_offset_odom horizontal basis.
        forward = dx * cos_y - dz * sin_y
        left = -dx * sin_y - dz * cos_y
        return float(forward), float(left), float(dy)

    def world_yaw_degrees_ccw_from_robot(
        self,
        world_orientation: tuple[float, float, float, float],
    ) -> float | str:
        """World-frame yaw relative to the robot heading, in degrees CCW."""
        ctx = self._nav_context()
        if isinstance(ctx, str):
            return ctx
        sample, _robot_odom_yaw = ctx
        _robot_world, robot_world_ori = self._world_frame.transform_pose(
            sample.position,
            sample.orientation,
        )
        robot_world_yaw = yaw_from_T(
            pose_to_matrix((0.0, 0.0, 0.0), robot_world_ori)
        )
        user_yaw = yaw_from_T(pose_to_matrix((0.0, 0.0, 0.0), world_orientation))
        delta = math.degrees(user_yaw - robot_world_yaw)
        while delta <= -180.0:
            delta += 360.0
        while delta > 180.0:
            delta -= 360.0
        return delta

    def submit_relative_goal(
        self,
        forward: float,
        left: float,
        degrees: float,
    ) -> str:
        """Compute an odom-relative pose, transform to world, submit as agent goal."""
        ctx = self._nav_context()
        if isinstance(ctx, str):
            logger.warning("submit_relative_goal rejected", reason=ctx)
            return ctx
        sample, yaw = ctx
        odom_position = self._relative_offset_odom(
            sample,
            yaw,
            float(forward),
            float(left),
            up=0.0,
        )
        target_yaw = yaw + math.radians(float(degrees))
        half = target_yaw * 0.5
        odom_orientation = (0.0, math.sin(half), 0.0, math.cos(half))
        world_position, world_orientation = self._world_frame.transform_pose(
            odom_position,
            odom_orientation,
        )
        robot_world, _ = self._world_frame.transform_pose(
            sample.position,
            sample.orientation,
        )
        world_position = self._pin_floor_y(
            world_position,
            robot_world_y=robot_world[1],
        )
        ts = time.time()
        self.submit_goal(
            position=world_position,
            orientation=world_orientation,
            ts=ts,
            source="agent",
        )
        return (
            f"Navigating relative move forward={forward:.2f}m "
            f"left={left:.2f}m degrees={degrees:.1f}"
        )

    def submit_approach_goal(
        self,
        user_position: tuple[float, float, float],
        *,
        standoff_m: float = APPROACH_STANDOFF_M,
    ) -> str:
        """Navigate near the user (world frame), facing them, with ground standoff."""
        if self._robot_connected is not None and not self._robot_connected():
            message = "Robot is not connected"
            logger.warning("submit_approach_goal rejected", reason=message)
            return message
        if not self._world_frame.is_committed:
            message = "World frame is not committed"
            logger.warning("submit_approach_goal rejected", reason=message)
            return message
        if self._odom_latest is None:
            message = "No odometry available yet"
            logger.warning("submit_approach_goal rejected", reason=message)
            return message
        sample = self._odom_latest()
        if sample is None:
            message = "No odometry available yet"
            logger.warning("submit_approach_goal rejected", reason=message)
            return message

        robot_world, _robot_ori = self._world_frame.transform_pose(
            sample.position,
            sample.orientation,
        )
        user_x, _user_y, user_z = (
            float(user_position[0]),
            float(user_position[1]),
            float(user_position[2]),
        )
        # Y-up AR world: horizontal plane is XZ; pin to ground contact
        # (visual origin is base_height_m above the floor).
        ground_y = self._robot_floor_world_y(robot_world[1])
        dx = robot_world[0] - user_x
        dz = robot_world[2] - user_z
        horizontal = math.hypot(dx, dz)
        if horizontal < APPROACH_MIN_HORIZONTAL_M:
            # Degenerate: user is above/near the robot — approach along robot +X.
            yaw = yaw_from_T(pose_to_matrix((0.0, 0.0, 0.0), sample.orientation))
            robot_forward_world, _ = self._world_frame.transform_pose(
                (
                    sample.position[0] + math.cos(yaw),
                    sample.position[1],
                    sample.position[2] - math.sin(yaw),
                ),
                sample.orientation,
            )
            dx = robot_world[0] - robot_forward_world[0]
            dz = robot_world[2] - robot_forward_world[2]
            horizontal = math.hypot(dx, dz)
            if horizontal < APPROACH_MIN_HORIZONTAL_M:
                dx, dz, horizontal = 1.0, 0.0, 1.0

        dir_x = dx / horizontal
        dir_z = dz / horizontal
        standoff = max(0.0, float(standoff_m))
        goal_x = user_x + dir_x * standoff
        goal_z = user_z + dir_z * standoff
        # Face the user: forward=(cos yaw, 0, -sin yaw) toward user from goal.
        face_x = user_x - goal_x
        face_z = user_z - goal_z
        face_norm = math.hypot(face_x, face_z)
        if face_norm < APPROACH_MIN_HORIZONTAL_M:
            target_yaw = 0.0
        else:
            target_yaw = math.atan2(-face_z / face_norm, face_x / face_norm)
        half = target_yaw * 0.5
        world_orientation = (0.0, math.sin(half), 0.0, math.cos(half))
        ts = time.time()
        self.submit_goal(
            position=(goal_x, ground_y, goal_z),
            orientation=world_orientation,
            ts=ts,
            source="agent",
        )
        return (
            f"Navigating to user "
            f"(standoff={standoff:.2f}m, goal=[{goal_x:.2f}, {ground_y:.2f}, {goal_z:.2f}])"
        )

    # ------------------------------------------------------------------
    # WebSocket message handlers
    # ------------------------------------------------------------------

    def on_navigate_goal(self, msg: NavGoalMessage) -> None:
        self.submit_goal(
            position=msg.position,
            orientation=msg.orientation,
            ts=msg.ts,
            source="user",
        )

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
        if had_session:
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
        self._motion_router.emergency_stop(on_complete=self._on_control_dispatched)

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
            self._flush_pending_retarget_if_due()
            with self._goal_lock:
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

    def _flush_pending_retarget_if_due(self) -> None:
        with self._goal_lock:
            pending = self._pending_retarget
            if pending is None:
                return
            last = self._last_goal_publish_mono
            if (
                last is not None
                and (time.monotonic() - last) < NAV_GOAL_REPUBLISH_MIN_INTERVAL_S
            ):
                return
            # Claim under lock so a concurrent retarget cannot be dropped silently.
            self._pending_retarget = None
            position = pending.position
            orientation = pending.orientation
            ts = pending.ts
            source = pending.source
            coalesced = pending.coalesced_count
        self.submit_goal(
            position=position,
            orientation=orientation,
            ts=ts,
            source=source,
            bypass_rate_limit=True,
            coalesced_count=coalesced,
        )

    def _clear_session(self) -> None:
        with self._goal_lock:
            self._session = None
            self._pending_retarget = None

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
        source: WireGoalSource = "user",
        coalesced_count: int = 0,
    ) -> None:
        if ok:
            session_phase: SessionPhase | None = None
            with self._goal_lock:
                if self._session is not None:
                    session_phase = self._session.phase
                    self._session.dispatched_mono = time.monotonic()
                    self._session.last_path_mono = None
                    self._session.odom_position = odom_goal.position
                    self._session.odom_orientation = odom_goal.orientation
            goal_fields = {
                "world_goal": [round(v, 3) for v in msg.position],
                "odom_goal": [round(v, 3) for v in odom_goal.position],
                "world_goal_yaw_deg": (
                    orientation_yaw_deg(msg.orientation) if msg.orientation is not None else None
                ),
                "odom_goal_yaw_deg": orientation_yaw_deg(odom_goal.orientation),
                "source": source,
                "coalesced": coalesced_count,
            }
            # INFO only for first dispatch of a session; in-flight retargets at DEBUG.
            if session_phase == "intent":
                logger.info("AR navigation goal published", **goal_fields)
            else:
                logger.debug("AR navigation goal updated", **goal_fields)
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
        logger.debug(
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
        if shortfall_m <= NAV_ARRIVAL_SHORTFALL_WARN_M:
            return
        logger.warning(
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
        logger.debug(
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
        logger.debug(
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
