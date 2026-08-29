from __future__ import annotations

import threading
import time

from dimos_lcm.std_msgs import Bool

from dimos.ar.navigation.types import NavGoalFrame, NavGoalRequest, NavOutcome, NavState
from dimos.ar.robot.odom_correction import correct_odom_path, uncorrect_odom_pose
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.nav_msgs.Path import Path


class NavGoalCoordinator:
    def __init__(self, *, odom_scale_correction_factor: float) -> None:
        self._odom_scale_correction_factor = odom_scale_correction_factor
        self._lock = threading.Lock()
        self._following_path = False
        self._outcome: NavOutcome | None = None

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
        return goal

    def on_path(self, msg: Path) -> tuple[NavGoalFrame, bool]:
        corrected = correct_odom_path(msg, factor=self._odom_scale_correction_factor)
        with self._lock:
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

    def on_goal_reached(self, msg: Bool) -> None:
        with self._lock:
            self._outcome = "succeeded" if msg.data else "failed"
            self._following_path = False

    def on_estop(self) -> bool:
        with self._lock:
            changed = self._following_path or self._outcome is not None
            self._following_path = False
            self._outcome = None
            return changed
