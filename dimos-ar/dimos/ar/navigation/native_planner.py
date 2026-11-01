"""Repo-owned native planner adapter with source-correlated terminal facts.

The native Bool topic remains available to other DimOS modules. ARModule uses
this adapter's additional status topic so delayed transport facts retain the
identity of the goal that produced them.
"""

from __future__ import annotations

from collections.abc import Callable
import json
import math
import time
from typing import Any

from dimos_lcm.std_msgs import Bool, String

from dimos.core.core import rpc
from dimos.core.module import Module
from dimos.core.stream import Out
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.navigation.go2.replanning_a_star.global_planner import GlobalPlanner
from dimos.navigation.go2.replanning_a_star.module import ReplanningAStarPlanner


class ARGlobalPlanner(GlobalPlanner):  # type: ignore[misc]
    def __init__(self, emit_status: Callable[[float, str], None], **kwargs: Any) -> None:
        super().__init__(**kwargs)
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
        self._planner = ARGlobalPlanner(
            self._emit_navigation_status,
            robot_width=self.config.robot_width,
            robot_rotation_diameter=self.config.robot_rotation_diameter,
            nerf_speed=self.config.nerf_speed,
            simulation=bool(self.config.g.simulation),
        )

    def _on_stop_movement(self, msg: Bool) -> None:
        if msg.data:
            self._planner.retire_goal_requests()

    @rpc  # type: ignore[untyped-decorator]
    def cancel_goal(self) -> bool:
        self._planner.retire_goal_requests()
        return True

    def _emit_navigation_status(self, goal_ts: float, phase: str) -> None:
        self.ar_navigation_status.publish(String(json.dumps({"goal_ts": goal_ts, "phase": phase})))
