from __future__ import annotations

import threading
import time
from unittest.mock import MagicMock

import pytest

from dimos.ar.bridge.adapter_motion_router import AdapterMotionRouter
from dimos.ar.bridge.adapter_rpc_dispatch import dispatch_adapter_nowait
from dimos.ar.bridge.test_rpc_bindings import bind_mock_adapter_rpc
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped


def _make_router(*, async_dispatch: bool = False) -> tuple[AdapterMotionRouter, MagicMock]:
    adapter = MagicMock()
    adapter.send_joystick_command.return_value = True
    adapter.send_nav_goal.return_value = True
    adapter.cancel_nav_goal.return_value = True
    adapter.emergency_stop.return_value = None
    bind_mock_adapter_rpc(adapter, async_dispatch=async_dispatch)
    router = AdapterMotionRouter(adapter)
    return router, adapter


def _wait_for_calls(adapter: MagicMock, method: str, count: int) -> None:
    for _ in range(200):
        if getattr(adapter, method).call_count >= count:
            return
        time.sleep(0.01)
    raise AssertionError(f"{method} was not called {count} times")


def test_non_blocking_under_slow_joystick_rpc() -> None:
    router, adapter = _make_router(async_dispatch=True)
    release = threading.Event()

    def slow(_vx: float, _vy: float, _wz: float) -> bool:
        release.wait(timeout=2.0)
        return True

    adapter.send_joystick_command.side_effect = slow

    router.send_joystick_command(0.0, 0.3, 0.0)
    router.send_joystick_command(0.0, 0.0, 0.0)
    _wait_for_calls(adapter, "send_joystick_command", 2)
    release.set()


def test_joystick_cancels_active_navigation() -> None:
    router, adapter = _make_router()
    goal = PoseStamped(position=[1.0, 0.0, 0.0], orientation=[0.0, 0.0, 0.0, 1.0])

    router.send_nav_goal(goal)
    router.send_joystick_command(0.0, 0.3, 0.0)

    adapter.cancel_nav_goal.assert_called_once()
    adapter.send_joystick_command.assert_called_with(0.0, 0.3, 0.0)


def test_nav_goal_zeros_active_joystick() -> None:
    router, adapter = _make_router()
    goal = PoseStamped(position=[1.0, 0.0, 0.0], orientation=[0.0, 0.0, 0.0, 1.0])

    router.send_joystick_command(0.0, 0.3, 0.0)
    adapter.send_joystick_command.reset_mock()
    router.send_nav_goal(goal)

    adapter.send_joystick_command.assert_called_with(0.0, 0.0, 0.0)
    adapter.send_nav_goal.assert_called_once_with(goal)


def test_cancel_nav_goal_clears_intent() -> None:
    router, adapter = _make_router()
    goal = PoseStamped(position=[1.0, 0.0, 0.0], orientation=[0.0, 0.0, 0.0, 1.0])
    router.send_nav_goal(goal)
    router.cancel_nav_goal()
    adapter.send_joystick_command.reset_mock()
    router.send_joystick_command(0.0, 0.2, 0.0)
    adapter.cancel_nav_goal.assert_called_once()
    adapter.send_joystick_command.assert_called_with(0.0, 0.2, 0.0)


def test_emergency_stop_dispatched() -> None:
    router, adapter = _make_router()
    router.send_joystick_command(0.0, 0.3, 0.0)
    router.emergency_stop()
    adapter.emergency_stop.assert_called_once()


def test_on_complete_invoked() -> None:
    router, adapter = _make_router()
    seen: list[tuple[bool, BaseException | None]] = []
    done = threading.Event()

    def on_complete(ok: bool, err: BaseException | None) -> None:
        seen.append((ok, err))
        done.set()

    router.send_joystick_command(0.0, 0.3, 0.0, on_complete=on_complete)
    assert done.wait(timeout=2.0)
    assert seen == [(True, None)]
    adapter.send_joystick_command.assert_called_with(0.0, 0.3, 0.0)


def test_dispatch_adapter_nowait_rejects_non_rpc_call() -> None:
    with pytest.raises(TypeError, match="DimOS RpcCall"):
        dispatch_adapter_nowait(lambda: None)
