from __future__ import annotations

import threading
import time
from unittest.mock import MagicMock

from dimos.ar.bridge.adapter_command_queue import AdapterCommandQueue
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped


def _make_queue() -> tuple[AdapterCommandQueue, MagicMock]:
    adapter = MagicMock()
    adapter.baseline_set_lateral_velocity.return_value = True
    adapter.send_nav_goal.return_value = True
    adapter.cancel_goal.return_value = True
    adapter.emergency_stop.return_value = None
    queue = AdapterCommandQueue(adapter)
    return queue, adapter


def _wait_for_calls(adapter: MagicMock, method: str, count: int) -> None:
    for _ in range(200):
        if getattr(adapter, method).call_count >= count:
            return
        time.sleep(0.01)
    raise AssertionError(f"{method} was not called {count} times")


def test_baseline_fifo_preserves_order() -> None:
    queue, adapter = _make_queue()
    calls: list[float] = []

    def record(vy: float) -> bool:
        calls.append(vy)
        time.sleep(0.01)
        return True

    adapter.baseline_set_lateral_velocity.side_effect = record

    queue.submit_baseline_velocity(0.3)
    queue.submit_baseline_velocity(0.0)
    queue.submit_baseline_velocity(-0.3)

    _wait_for_calls(adapter, "baseline_set_lateral_velocity", 3)
    assert calls == [0.3, 0.0, -0.3]
    queue.shutdown()


def test_nav_coalesce_sends_only_latest_goal() -> None:
    queue, adapter = _make_queue()
    sent_goals: list[PoseStamped] = []
    callbacks: list[tuple[bool, BaseException | None]] = []

    def record(goal: PoseStamped) -> bool:
        sent_goals.append(goal)
        time.sleep(0.05)
        return True

    adapter.send_nav_goal.side_effect = record

    goal_a = PoseStamped(position=[1.0, 0.0, 0.0], orientation=[0.0, 0.0, 0.0, 1.0])
    goal_b = PoseStamped(position=[2.0, 0.0, 0.0], orientation=[0.0, 0.0, 0.0, 1.0])

    done = threading.Event()

    def on_a(ok: bool, err: BaseException | None) -> None:
        callbacks.append((ok, err))

    def on_b(ok: bool, err: BaseException | None) -> None:
        callbacks.append((ok, err))
        done.set()

    queue.submit_nav_goal(goal_a, on_complete=on_a)
    queue.submit_nav_goal(goal_b, on_complete=on_b)

    assert done.wait(timeout=2.0)
    assert len(sent_goals) == 1
    assert sent_goals[0].position == goal_b.position
    assert callbacks == [(True, None)]
    queue.shutdown()


def test_cancel_clears_pending_nav() -> None:
    queue, adapter = _make_queue()
    nav_called = threading.Event()
    baseline_release = threading.Event()

    def slow_baseline(_vy: float) -> bool:
        baseline_release.wait(timeout=2.0)
        return True

    adapter.baseline_set_lateral_velocity.side_effect = slow_baseline

    queue.submit_baseline_velocity(0.3)
    goal = PoseStamped(position=[1.0, 0.0, 0.0], orientation=[0.0, 0.0, 0.0, 1.0])
    queue.submit_nav_goal(goal, on_complete=lambda _ok, _err: nav_called.set())
    queue.submit_cancel_goal()

    baseline_release.set()
    _wait_for_calls(adapter, "cancel_goal", 1)
    time.sleep(0.2)
    assert nav_called.is_set() is False
    assert adapter.send_nav_goal.call_count == 0
    queue.shutdown()


def test_cancel_runs_before_remaining_baseline() -> None:
    queue, adapter = _make_queue()
    calls: list[str] = []
    first_started = threading.Event()
    first_release = threading.Event()

    def slow_velocity(vy: float) -> bool:
        calls.append(f"velocity:{vy}")
        if vy == 0.3:
            first_started.set()
            first_release.wait(timeout=2.0)
        return True

    def record_cancel() -> bool:
        calls.append("cancel")
        return True

    adapter.baseline_set_lateral_velocity.side_effect = slow_velocity
    adapter.cancel_goal.side_effect = record_cancel

    queue.submit_baseline_velocity(0.3)
    assert first_started.wait(timeout=2.0)
    queue.submit_baseline_velocity(0.0)
    queue.submit_cancel_goal()
    first_release.set()

    _wait_for_calls(adapter, "cancel_goal", 1)
    time.sleep(0.05)
    assert calls[0] == "velocity:0.3"
    assert calls[1] == "cancel"
    assert "velocity:0.0" not in calls
    queue.shutdown()


def test_estop_drains_pending_baseline_and_nav() -> None:
    queue, adapter = _make_queue()
    nav_called = threading.Event()

    adapter.send_nav_goal.side_effect = lambda _goal: nav_called.set() or True

    queue.submit_baseline_velocity(0.3)
    queue.submit_baseline_velocity(-0.3)
    queue.submit_nav_goal(
        PoseStamped(position=[1.0, 0.0, 0.0], orientation=[0.0, 0.0, 0.0, 1.0]),
        on_complete=lambda _ok, _err: None,
    )
    queue.submit_emergency_stop()

    _wait_for_calls(adapter, "emergency_stop", 1)
    time.sleep(0.1)
    assert nav_called.is_set() is False
    queue.shutdown()


def test_on_complete_invoked_with_error() -> None:
    queue, adapter = _make_queue()
    adapter.baseline_set_lateral_velocity.side_effect = RuntimeError("boom")
    seen: list[tuple[bool, BaseException | None]] = []
    done = threading.Event()

    def on_complete(ok: bool, err: BaseException | None) -> None:
        seen.append((ok, err))
        done.set()

    queue.submit_baseline_velocity(0.3, on_complete=on_complete)
    assert done.wait(timeout=2.0)
    assert seen == [(False, seen[0][1])]
    assert isinstance(seen[0][1], RuntimeError)
    queue.shutdown()


def test_stop_priority_runs_before_stale_pending_velocity() -> None:
    queue, adapter = _make_queue()
    calls: list[float] = []
    first_started = threading.Event()
    first_release = threading.Event()

    def slow_velocity(vy: float) -> bool:
        calls.append(vy)
        if vy == 0.3 and len(calls) == 1:
            first_started.set()
            first_release.wait(timeout=2.0)
        return True

    adapter.baseline_set_lateral_velocity.side_effect = slow_velocity

    queue.submit_baseline_velocity(0.3)
    assert first_started.wait(timeout=2.0)
    queue.submit_baseline_velocity(0.3)
    queue.submit_baseline_velocity(0.0)
    queue.submit_baseline_velocity(-0.3)
    first_release.set()

    _wait_for_calls(adapter, "baseline_set_lateral_velocity", 3)
    assert calls == [0.3, 0.0, -0.3]
    queue.shutdown()


def test_stop_priority_preserves_order_after_slow_start() -> None:
    queue, adapter = _make_queue()
    calls: list[float] = []
    first_started = threading.Event()
    first_release = threading.Event()

    def slow_velocity(vy: float) -> bool:
        calls.append(vy)
        if vy == 0.3 and len([value for value in calls if value == 0.3]) == 1:
            first_started.set()
            first_release.wait(timeout=2.0)
        return True

    adapter.baseline_set_lateral_velocity.side_effect = slow_velocity

    queue.submit_baseline_velocity(0.3)
    assert first_started.wait(timeout=2.0)
    queue.submit_baseline_velocity(0.0)
    queue.submit_baseline_velocity(-0.3)
    first_release.set()

    _wait_for_calls(adapter, "baseline_set_lateral_velocity", 3)
    assert calls == [0.3, 0.0, -0.3]
    queue.shutdown()
