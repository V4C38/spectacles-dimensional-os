"""Repo-owned native planner adapter with source-correlated terminal facts.

The native Bool topic remains available to other DimOS modules. ARModule uses
this adapter's additional status topic so delayed transport facts retain the
identity of the goal that produced them.
"""

from __future__ import annotations

from collections.abc import Callable
import inspect
import json
import math
import threading
import time
from typing import Any

from dimos_lcm.std_msgs import Bool, String

from dimos.ar.navigation.control_fence import NavigationControlFence
from dimos.core.core import rpc
from dimos.core.module import Module
from dimos.core.stream import Out
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.geometry_msgs.Twist import Twist
from dimos.navigation.go2.replanning_a_star.global_planner import GlobalPlanner
from dimos.navigation.go2.replanning_a_star.module import ReplanningAStarPlanner
from dimos.utils.logging_config import setup_logger

logger = setup_logger()


class ARGlobalPlanner(GlobalPlanner):  # type: ignore[misc]
    def __init__(self, emit_status: Callable[[float, str], None], *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._ar_emit_status = emit_status
        self._ar_latest_goal_ts = float("-inf")
        self._ar_stopped_at = float("-inf")

    def handle_goal_request(self, goal: PoseStamped) -> None:
        # Serialize accepted identity with cancellation/publication. The native
        # RLock is also used by its odometry and monitoring code.
        with self._lock:
            stamp = float(goal.ts)
            if not math.isfinite(stamp) or stamp <= max(
                self._ar_latest_goal_ts, self._ar_stopped_at
            ):
                return
            self._ar_latest_goal_ts = stamp
            self._ar_emit_status(stamp, "accepted")
            super().handle_goal_request(goal)

    def retire_goal_requests(self) -> None:
        # The stop and goal ports are independent transports. Record the stop
        # before canceling so queued pre-stop goals cannot restart the robot.
        with self._lock:
            self._ar_stopped_at = max(self._ar_stopped_at, time.time())
            self.cancel_goal()

    def cancel_goal(self, *, but_will_try_again: bool = False, arrived: bool = False) -> None:
        with self._lock:
            goal = self._current_goal
            super().cancel_goal(but_will_try_again=but_will_try_again, arrived=arrived)
            if goal is not None and not but_will_try_again:
                self._ar_emit_status(float(goal.ts), "succeeded" if arrived else "failed")


class ARReplanningAStarPlanner(ReplanningAStarPlanner):  # type: ignore[misc]
    ar_navigation_status: Out[String]
    _planner: ARGlobalPlanner

    def __init__(self, **kwargs: Any) -> None:
        # The upstream constructor only initializes Module and its planner. Use
        # the same configuration with our subclass, without editing upstream.
        Module.__init__(self, **kwargs)
        if "global_config" in inspect.signature(GlobalPlanner.__init__).parameters:
            overrides = {name: value for name, value in (
                ("robot_width", self.config.robot_width),
                ("robot_rotation_diameter", self.config.robot_rotation_diameter),
            ) if value is not None}
            config = self.config.g.model_copy(update=overrides) if overrides else self.config.g
            self._planner = ARGlobalPlanner(self._emit_navigation_status, config)
        else:
            self._planner = ARGlobalPlanner(
                self._emit_navigation_status,
                robot_width=self.config.robot_width,
                robot_rotation_diameter=self.config.robot_rotation_diameter,
                nerf_speed=self.config.nerf_speed,
                simulation=bool(self.config.g.simulation),
            )
        self._ar_fence = NavigationControlFence()
        self.nav_cmd_vel = _NavigationVelocityOutput(self, self._ar_fence)
        self._ar_watchdog_stop = threading.Event()
        self._ar_watchdog: threading.Thread | None = None
        self._ar_cleanup: threading.Thread | None = None
        self._ar_cleanup_lock = threading.Lock()
        self._ar_stop_write_failed = False

    @rpc  # type: ignore[untyped-decorator]
    def start(self) -> None:
        super().start()
        self._ar_watchdog_stop.clear()
        self._ar_watchdog = threading.Thread(target=self._watch_control, daemon=True,
                                             name="ar-navigation-watchdog")
        self._ar_watchdog.start()

    @rpc  # type: ignore[untyped-decorator]
    def stop(self) -> None:
        self._ar_watchdog_stop.set()
        self._ar_fence.halt()
        self._emit_stop_velocity()
        # Native stop may wait behind a hung planning RLock. Gate velocities
        # immediately and quarantine at most one cleanup thread.
        with self._ar_cleanup_lock:
            if self._ar_cleanup is None:
                self._ar_cleanup = threading.Thread(
                    target=self._cleanup_native, daemon=True, name="ar-navigation-cleanup"
                )
                self._ar_cleanup.start()
        self._ar_cleanup.join(timeout=0.2)
        if self._ar_watchdog is not None:
            self._ar_watchdog.join(timeout=0.2)

    def _cleanup_native(self) -> None:
        try:
            super().stop()
        except Exception:
            logger.exception("Native navigation cleanup failed")

    def _emit_stop_velocity(self) -> None:
        try:
            self.nav_cmd_vel.publish(Twist.zero())
            self._ar_stop_write_failed = False
        except Exception:
            if not getattr(self, "_ar_stop_write_failed", False):
                logger.exception("Native stop velocity output unavailable")
            self._ar_stop_write_failed = True

    def _watch_control(self) -> None:
        pending: tuple[int, float | None] | None = None
        while not self._ar_watchdog_stop.wait(0.025):
            expired = self._ar_fence.expire()
            if expired is not None:
                pending = expired
            if pending is not None:
                self._emit_stop_velocity()
            if pending is None or not self._planner._lock.acquire(blocking=False):
                continue
            try:
                generation, stamp = pending
                current = self._planner._current_goal
                if self._ar_fence.same_generation(generation) and (
                    stamp is None or (current is not None and current.ts == stamp)
                ):
                    self._planner.retire_goal_requests()
                pending = None
            except Exception:
                logger.exception("Native navigation retirement failed")
            finally:
                self._planner._lock.release()

    @rpc  # type: ignore[untyped-decorator]
    def ar_navigation_heartbeat(self, epoch: str, revision: int, deadline: float) -> bool:
        return self._ar_fence.heartbeat(epoch, revision, deadline)

    @rpc  # type: ignore[untyped-decorator]
    def ar_navigation_recover(self, epoch: str, revision: int, deadline: float) -> bool:
        if not self._ar_fence.heartbeat(epoch, revision, deadline):
            return False
        self._ar_fence.halt()
        self._emit_stop_velocity()
        if self._ar_stop_write_failed or not self._planner._lock.acquire(blocking=False):
            return False
        try:
            self._planner.retire_goal_requests()
            return self._planner._current_goal is None
        finally:
            self._planner._lock.release()

    @rpc  # type: ignore[untyped-decorator]
    def ar_navigation_goal(
        self, goal: PoseStamped, epoch: str, revision: int, deadline: float
    ) -> bool:
        generation = self._ar_fence.admit(epoch, revision, deadline, float(goal.ts))
        if generation is None:
            return False
        with self._planner._lock:
            if not self._ar_fence.current(generation) or float(goal.ts) <= max(
                self._planner._ar_latest_goal_ts, self._planner._ar_stopped_at
            ):
                return False
            self._planner.handle_goal_request(goal)
            current = self._planner._current_goal
            if current is None:
                # A close target may resolve synchronously while planning. It
                # was still admitted; do not report a false command rejection.
                self._ar_fence.retire_generation(generation)
                return self._planner._ar_latest_goal_ts == float(goal.ts)
            return (float(current.ts) == float(goal.ts)
                    and self._ar_fence.activate(generation))

    @rpc  # type: ignore[untyped-decorator]
    def set_goal(self, goal: PoseStamped) -> bool:
        if not self._ar_fence.admit_native_agent():
            return False
        self._planner.handle_goal_request(goal)
        return True

    def _on_stop_movement(self, msg: Bool) -> None:
        if msg.data:
            self._ar_fence.halt()
            self._emit_stop_velocity()
            self._planner.retire_goal_requests()

    @rpc  # type: ignore[untyped-decorator]
    def cancel_goal(self) -> bool:
        self._ar_fence.halt()
        self._emit_stop_velocity()
        self._planner.retire_goal_requests()
        return True

    def _emit_navigation_status(self, goal_ts: float, phase: str) -> None:
        self.ar_navigation_status.publish(String(json.dumps({"goal_ts": goal_ts, "phase": phase})))


class _NavigationVelocityOutput(Out[Twist]):  # type: ignore[misc]
    """Stop output even when native planning holds its own lock indefinitely."""

    def __init__(self, owner: Any, fence: NavigationControlFence) -> None:
        super().__init__(Twist, "nav_cmd_vel", owner)
        self._fence = fence

    def publish(self, message: Twist) -> None:
        super().publish(message if self._fence.allowed() else Twist.zero())
