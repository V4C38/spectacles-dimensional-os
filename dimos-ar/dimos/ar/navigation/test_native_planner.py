"""The installed native planner is adapted without upstream changes."""

import threading
from types import SimpleNamespace
from unittest.mock import Mock

from reactivex import Subject

from dimos.ar.navigation.native_planner import ARGlobalPlanner
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.navigation.base import NavigationState
from dimos.navigation.go2.replanning_a_star.global_planner import GlobalPlanner


def test_terminal_carries_goal_identity_captured_at_native_origin():
    planner = object.__new__(ARGlobalPlanner)
    planner._lock = threading.RLock()
    planner._current_goal = PoseStamped(ts=123, position=[1, 0, 0])
    planner._local_planner = SimpleNamespace(
        get_state=lambda: NavigationState.IDLE, stop_planning=Mock()
    )
    planner._position_tracker = SimpleNamespace(reset_data=Mock())
    planner._replan_limiter = SimpleNamespace(reset=Mock())
    planner.path = Subject()
    planner.goal_reached = Subject()
    emitted = []
    planner._ar_emit_status = lambda stamp, phase: emitted.append((stamp, phase))
    planner.cancel_goal(arrived=True)
    assert emitted == [(123, "succeeded")]
    planner._current_goal = PoseStamped(ts=456, position=[2, 0, 0])
    planner.cancel_goal(arrived=False)
    assert emitted == [(123, "succeeded"), (456, "failed")]
    planner.cancel_goal()
    assert len(emitted) == 2


def test_native_accept_and_plan_are_serialized_under_same_lock(monkeypatch):
    planner = object.__new__(ARGlobalPlanner)
    planner._lock = threading.RLock()
    planner._ar_latest_goal_ts = float("-inf")
    planner._ar_stopped_at = float("-inf")
    emitted = []
    planner._ar_emit_status = lambda stamp, phase: emitted.append((stamp, phase))

    def accept(self, goal):
        assert self._lock._is_owned()
        emitted.append((goal.ts, "native_plan"))

    monkeypatch.setattr(GlobalPlanner, "handle_goal_request", accept)
    planner.handle_goal_request(PoseStamped(ts=987, position=[1, 0, 0]))
    assert emitted == [(987, "accepted"), (987, "native_plan")]


def test_stop_tombstone_rejects_delayed_goal_then_accepts_new_goal(monkeypatch):
    from dimos.ar.navigation import native_planner

    planner = object.__new__(ARGlobalPlanner)
    planner._lock = threading.RLock()
    planner._current_goal = None
    planner._ar_latest_goal_ts = float("-inf")
    planner._ar_stopped_at = float("-inf")
    planner._ar_emit_status = Mock()
    accepted = []
    monkeypatch.setattr(
        GlobalPlanner, "handle_goal_request", lambda self, goal: accepted.append(goal)
    )
    monkeypatch.setattr(GlobalPlanner, "cancel_goal", lambda *args, **kwargs: None)
    monkeypatch.setattr(native_planner.time, "time", lambda: 200)
    planner.retire_goal_requests()
    planner.handle_goal_request(PoseStamped(ts=199))
    assert not accepted
    planner.handle_goal_request(PoseStamped(ts=201))
    assert len(accepted) == 1
    planner.handle_goal_request(PoseStamped(ts=201))
    planner.handle_goal_request(PoseStamped(ts=200.5))
    assert len(accepted) == 1
