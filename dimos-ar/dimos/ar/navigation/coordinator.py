from __future__ import annotations

import threading
import time

from dimos_lcm.std_msgs import Bool

from dimos.ar.navigation.types import NavGoalFrame, NavGoalRequest, NavOutcome, NavState
from dimos.ar.robot.odometry_correction import correct_odom_path, uncorrect_odom_pose
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.nav_msgs.Path import Path


class NavGoalCoordinator:
    def __init__(self, *, odom_scale_correction_factor: float) -> None:
        self._odom_scale_correction_factor = odom_scale_correction_factor
        self._lock = threading.Lock()
        self._following_path = False
        self._outcome: NavOutcome | None = None
        self._retired_at = 0.0
        self._requested_goal_ts: float | None = None
        self._native_goal_ts: float | None = None
        self._correlated = False

    def nav_state(self) -> NavState:
        with self._lock:
            if self._outcome is not None:
                return NavState(state="resolved", outcome=self._outcome)
            if self._following_path:
                return NavState(state="following_path", outcome=None)
            return NavState(state="idle", outcome=None)

    def submit_goal(self, msg: NavGoalRequest) -> PoseStamped:
        client_pose = PoseStamped(
            ts=time.time(),
            frame_id="odom",
            position=list(msg.position),
            orientation=list(msg.orientation),
        )
        goal = uncorrect_odom_pose(client_pose, factor=self._odom_scale_correction_factor)
        with self._lock:
            self._outcome = None
            self._retired_at = time.time()
            self._requested_goal_ts = float(goal.ts)
            self._correlated = True
        return goal

    def on_path(self, msg: Path) -> tuple[NavGoalFrame | None, bool]:
        corrected = correct_odom_path(msg, factor=self._odom_scale_correction_factor)
        with self._lock:
            if self._retired_at and (not corrected.ts or corrected.ts <= self._retired_at):
                return None, False
            if not corrected.poses:
                return NavGoalFrame(
                    pose=None,
                    path_poses=[],
                    ts=corrected.ts or time.time(),
                ), False
            was_following = self._following_path
            was_resolved = self._outcome is not None
            self._following_path = True
            self._outcome = None
            path_poses = [(pose.x, pose.y, pose.z, pose.yaw) for pose in corrected.poses]
            nav_goal_frame = NavGoalFrame(
                pose=path_poses[-1],
                path_poses=path_poses,
                ts=corrected.ts,
            )
            state_changed = not was_following or was_resolved
            return nav_goal_frame, state_changed

    def on_goal_reached(self, msg: Bool) -> bool:
        with self._lock:
            if self._correlated:
                return False
            self._outcome = "succeeded" if msg.data else "failed"
            self._following_path = False
            self._retired_at = time.time()
            return True

    def on_native_status(self, goal_ts: float, phase: str) -> bool:
        with self._lock:
            if self._requested_goal_ts is not None and goal_ts != self._requested_goal_ts:
                return False
            if phase == "accepted":
                if self._requested_goal_ts is None and goal_ts <= self._retired_at:
                    return False
                if self._native_goal_ts is not None and goal_ts < self._native_goal_ts:
                    return False
                self._correlated = True
                self._native_goal_ts = goal_ts
                self._outcome = None
                return False
            if phase not in {"succeeded", "failed"} or goal_ts not in {
                self._requested_goal_ts,
                self._native_goal_ts,
            }:
                return False
            self._correlated = True
            self._requested_goal_ts = self._native_goal_ts = None
            self._outcome = "succeeded" if phase == "succeeded" else "failed"
            self._following_path = False
            self._retired_at = time.time()
            return True

    def on_estop(self) -> bool:
        with self._lock:
            changed = self._following_path or self._outcome is not None
            self._following_path = False
            self._outcome = None
            self._requested_goal_ts = self._native_goal_ts = None
            self._retired_at = time.time()
            return changed
