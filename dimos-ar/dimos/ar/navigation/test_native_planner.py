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


def test_expired_control_stops_velocity_without_taking_planner_lock(monkeypatch):
    from dimos.ar.navigation.control_fence import NavigationControlFence
    from dimos.ar.navigation.native_planner import _NavigationVelocityOutput
    from dimos.core.stream import Out
    from dimos.msgs.geometry_msgs.Twist import Twist

    now = [1.0]
    fence = NavigationControlFence(lambda: now[0])
    generation = fence.admit("epoch", 1, 1.5, 100)
    assert generation is not None and fence.activate(generation)
    sent = []
    monkeypatch.setattr(Out, "publish", lambda self, message: sent.append(message))
    output = _NavigationVelocityOutput(SimpleNamespace(), fence)
    moving = Twist(linear=[1, 0, 0])
    output.publish(moving)
    now[0] = 1.6
    output.publish(moving)
    assert sent[0].linear.x == 1
    assert sent[1].linear.x == 0


def test_native_stop_quarantines_a_hung_planner_once(monkeypatch):
    import time

    from dimos.ar.navigation.control_fence import NavigationControlFence
    from dimos.ar.navigation.native_planner import ARReplanningAStarPlanner
    from dimos.navigation.go2.replanning_a_star.module import ReplanningAStarPlanner

    stopped = threading.Event()
    entered = threading.Event()

    def blocking_stop(self):
        entered.set()
        stopped.wait(5)

    monkeypatch.setattr(ReplanningAStarPlanner, "stop", blocking_stop)
    owner = object.__new__(ARReplanningAStarPlanner)
    owner._ar_fence = NavigationControlFence()
    owner._ar_watchdog_stop = threading.Event()
    owner._ar_watchdog = None
    owner._ar_cleanup = None
    owner._ar_cleanup_lock = threading.Lock()
    owner.nav_cmd_vel = SimpleNamespace(publish=Mock())
    try:
        before = time.monotonic()
        owner.stop()
        assert time.monotonic() - before < 1
        assert entered.is_set()
        first = owner._ar_cleanup
        owner.stop()
        assert owner._ar_cleanup is first
        assert not owner._ar_fence.allowed()
    finally:
        stopped.set()
        if owner._ar_cleanup is not None:
            owner._ar_cleanup.join(timeout=1)


def test_synchronously_completed_goal_is_still_accepted():
    import time

    from dimos.ar.navigation.control_fence import NavigationControlFence
    from dimos.ar.navigation.native_planner import ARReplanningAStarPlanner

    owner = object.__new__(ARReplanningAStarPlanner)
    owner._ar_fence = NavigationControlFence()
    planner = SimpleNamespace(
        _lock=threading.RLock(), _ar_latest_goal_ts=float('-inf'),
        _ar_stopped_at=float('-inf'), _current_goal=None,
    )
    planner.handle_goal_request = lambda goal, **_kwargs: setattr(planner, '_ar_latest_goal_ts', goal.ts)
    owner._planner = planner
    assert owner.ar_navigation_goal(PoseStamped(ts=100), "epoch", 1, time.monotonic() + 0.5)
    assert not owner._ar_fence.allowed()


def test_failed_zero_publication_does_not_skip_native_cancellation():
    from dimos.ar.navigation.control_fence import NavigationControlFence
    from dimos.ar.navigation.native_planner import ARReplanningAStarPlanner

    owner = object.__new__(ARReplanningAStarPlanner)
    owner._ar_fence = NavigationControlFence()
    owner.nav_cmd_vel = SimpleNamespace(publish=Mock(side_effect=OSError("offline")))
    owner._planner = SimpleNamespace(retire_goal_requests=Mock())
    assert owner.cancel_goal()
    owner._planner.retire_goal_requests.assert_called_once()
    assert not owner._ar_fence.allowed()


def test_native_adapter_constructs_with_installed_planner_configuration():
    from dimos.ar.navigation.native_planner import ARReplanningAStarPlanner

    module = ARReplanningAStarPlanner(robot_width=0.73)
    assert isinstance(module._planner, ARGlobalPlanner)
    assert module.config.robot_width == 0.73
    assert module.nav_cmd_vel._fence is module._ar_fence
    config = getattr(module._planner, "_global_config", None)
    if config is not None:
        assert config.robot_width == 0.73


def test_recovery_requires_an_available_planner_and_confirmed_empty_goal():
    import time

    from dimos.ar.navigation.control_fence import NavigationControlFence
    from dimos.ar.navigation.native_planner import ARReplanningAStarPlanner

    module = object.__new__(ARReplanningAStarPlanner)
    module._ar_fence = NavigationControlFence()
    module._ar_stop_write_failed = False
    module._emit_stop_velocity = Mock()
    lock = threading.Lock()
    module._planner = SimpleNamespace(_lock=lock, _current_goal=object())
    module._planner.retire_goal_requests = Mock(side_effect=lambda: setattr(module._planner, "_current_goal", None))
    lock.acquire()
    try:
        assert not module.ar_navigation_recover("epoch", 1, time.monotonic() + 0.5)
        module._planner.retire_goal_requests.assert_not_called()
    finally:
        lock.release()
    assert module.ar_navigation_recover("epoch", 2, time.monotonic() + 0.5)
    module._planner.retire_goal_requests.assert_called_once()
    assert not module._ar_fence.allowed()


def takeover_planner(monkeypatch):
    from dimos.ar.navigation.control_fence import NavigationControlFence
    from dimos.ar.navigation.native_planner import ARReplanningAStarPlanner

    module = object.__new__(ARReplanningAStarPlanner)
    module._ar_fence = NavigationControlFence()
    module._ar_stop_write_failed = False
    module._emit_stop_velocity = Mock()
    planner = object.__new__(ARGlobalPlanner)
    planner._lock = threading.RLock()
    planner._ar_latest_goal_ts = float("-inf")
    planner._ar_stopped_at = float("-inf")
    planner._ar_control_fence = module._ar_fence
    planner._current_goal = None
    planner._ar_emit_status = Mock()
    module._planner = planner
    monkeypatch.setattr(GlobalPlanner, "handle_goal_request", lambda self, goal:
                        setattr(self, "_current_goal", goal))
    monkeypatch.setattr(GlobalPlanner, "cancel_goal", lambda self, **_kwargs:
                        setattr(self, "_current_goal", None))
    return module


def test_all_native_goal_entrypoints_respect_manual_latch_and_explicit_ar_goal(monkeypatch):
    import time

    module = takeover_planner(monkeypatch)
    assert module.set_goal(PoseStamped(ts=time.time() + 1))
    assert module.ar_navigation_agent_manual(True, 0)
    assert module._planner._current_goal is None
    assert not module.set_goal(PoseStamped(ts=time.time() + 2))
    # target, goal_request, and clicked_point subscriptions all call this same
    # native handler, so they cannot bypass the set_goal RPC admission.
    assert not module._planner.handle_goal_request(PoseStamped(ts=time.time() + 3))
    manual = PoseStamped(ts=time.time() + 4)
    assert module.ar_navigation_goal(manual, "human", 1, time.monotonic() + 1)
    assert module._planner._current_goal is manual
    assert not module._planner.handle_goal_request(PoseStamped(ts=time.time() + 5))
    assert module._planner._current_goal is manual
    assert not module.ar_navigation_agent_manual(False, 0)


def test_takeover_fences_planning_before_waiting_and_rejects_uncertain_stop(monkeypatch):
    import time

    module = takeover_planner(monkeypatch)
    entered, finish = threading.Event(), threading.Event()

    def plan(self, goal):
        entered.set()
        assert finish.wait(2)
        self._current_goal = goal

    monkeypatch.setattr(GlobalPlanner, "handle_goal_request", plan)
    results = []
    worker = threading.Thread(target=lambda: results.append(module.set_goal(PoseStamped(ts=time.time()))))
    worker.start()
    assert entered.wait(2)
    try:
        assert not module.ar_navigation_agent_manual(True, 0)
        assert not module._ar_fence.allowed()
        assert module._ar_fence.admit_native_agent() is None
        module._emit_stop_velocity.assert_called_once()
    finally:
        finish.set()
        worker.join(2)
    assert results == [False]
    assert module.ar_navigation_agent_manual(True, 0)
    assert module._planner._current_goal is None
    assert module.ar_navigation_agent_manual(False, 0)
