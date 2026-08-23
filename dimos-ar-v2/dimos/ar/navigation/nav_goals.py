from __future__ import annotations

import threading
import time

from dimos_lcm.std_msgs import Bool

from dimos.ar.robot.odom_correction import uncorrect_odom_pose
from dimos.ar.websocket.protocol import NavGoal, NavOutcome, NavState
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped


class NavGoalCoordinator:
    def __init__(self, *, odom_correction_factor: float) -> None:
        self._odom_correction_factor = odom_correction_factor
        self._lock = threading.Lock()
        self._client_session_active = False
        self._outcome: NavOutcome | None = None

    def nav_state(self) -> NavState:
        with self._lock:
            if self._outcome is not None:
                return NavState(state="resolved", outcome=self._outcome)
            if self._client_session_active:
                return NavState(state="following_path", outcome=None)
            return NavState(state="idle", outcome=None)

    def submit_client_goal(self, msg: NavGoal) -> PoseStamped:
        client_pose = PoseStamped(
            ts=time.time(),
            frame_id="world",
            position=list(msg.position),
            orientation=list(msg.orientation),
        )
        goal = uncorrect_odom_pose(client_pose, factor=self._odom_correction_factor)
        with self._lock:
            self._client_session_active = True
            self._outcome = None
        return goal

    def on_goal_reached(self, msg: Bool) -> bool:
        with self._lock:
            if not self._client_session_active:
                return False
            self._outcome = "succeeded" if msg.data else "failed"
            self._client_session_active = False
            return True

    def on_estop(self) -> bool:
        with self._lock:
            if not self._client_session_active and self._outcome is None:
                return False
            self._client_session_active = False
            self._outcome = None
            return True
