from __future__ import annotations

import threading
import time
from unittest.mock import MagicMock

from dimos_lcm.std_msgs import Bool
import pytest

from dimos.ar.bridge.motion_router import MotionRouter
from dimos.msgs.geometry_msgs.PointStamped import PointStamped
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.geometry_msgs.Twist import Twist


def _make_router(
    *,
    slow_cmd_vel: bool = False,
) -> tuple[MotionRouter, list[Twist], list[PoseStamped], list[PointStamped], list[Bool]]:
    published_cmd_vel: list[Twist] = []
    published_nav: list[PoseStamped] = []
    published_point_nav: list[PointStamped] = []
    published_cancel: list[Bool] = []
    cmd_vel_lock = threading.Lock()

    def publish_cmd_vel(twist: Twist) -> None:
        if slow_cmd_vel:
            with cmd_vel_lock:
                time.sleep(0.2)
        published_cmd_vel.append(twist)

    router = MotionRouter(
        publish_cmd_vel=publish_cmd_vel,
        publish_nav_goal=published_nav.append,
        publish_nav_point_goal=published_point_nav.append,
        publish_stop_movement=published_cancel.append,
        publish_cancel_goal=published_cancel.append,
    )
    return router, published_cmd_vel, published_nav, published_point_nav, published_cancel


def _wait_for_cmd_vel_count(published: list[Twist], count: int) -> None:
    for _ in range(200):
        if len(published) >= count:
            return
        time.sleep(0.01)
    raise AssertionError(f"expected {count} cmd_vel publishes, got {len(published)}")


def test_joystick_cancels_active_navigation() -> None:
    router, _cmd_vel, _nav, _point_nav, cancel = _make_router()
    goal = PoseStamped(position=[1.0, 0.0, 0.0], orientation=[0.0, 0.0, 0.0, 1.0])

    router.send_nav_goal(goal)
    router.send_joystick_command(0.0, 0.3, 0.0)

    assert len(cancel) == 2
    assert cancel[0].data is True
    assert _cmd_vel[-1].linear.y == pytest.approx(0.3)


def test_nav_goal_zeros_active_joystick() -> None:
    router, cmd_vel, nav, point_nav, _cancel = _make_router()
    goal = PoseStamped(position=[1.0, 0.0, 0.0], orientation=[0.0, 0.0, 0.0, 1.0])

    router.send_joystick_command(0.0, 0.3, 0.0)
    cmd_vel.clear()
    router.send_nav_goal(goal)

    assert cmd_vel[-1].linear.y == pytest.approx(0.0)
    assert nav == [goal]
    assert point_nav[-1].x == pytest.approx(1.0)


def test_cancel_nav_goal_clears_intent() -> None:
    router, cmd_vel, _nav, _point_nav, cancel = _make_router()
    goal = PoseStamped(position=[1.0, 0.0, 0.0], orientation=[0.0, 0.0, 0.0, 1.0])
    router.send_nav_goal(goal)
    router.cancel_nav_goal()
    cmd_vel.clear()
    router.send_joystick_command(0.0, 0.2, 0.0)

    assert len(cancel) == 2
    assert cmd_vel[-1].linear.y == pytest.approx(0.2)


def test_emergency_stop_zeros_motion_and_publishes_cancel() -> None:
    hard_stop = MagicMock()
    published_cmd_vel: list[Twist] = []
    published_cancel: list[Bool] = []
    router = MotionRouter(
        publish_cmd_vel=published_cmd_vel.append,
        publish_nav_goal=lambda goal: None,
        publish_nav_point_goal=lambda goal: None,
        publish_stop_movement=published_cancel.append,
        publish_cancel_goal=published_cancel.append,
        hard_stop=hard_stop,
    )
    router.send_joystick_command(0.0, 0.3, 0.0)
    router.emergency_stop()

    assert published_cmd_vel[-1].linear.y == pytest.approx(0.0)
    assert len(published_cancel) == 2
    time.sleep(0.05)
    hard_stop.assert_called_once()


def test_emergency_stop_still_cancels_when_hard_stop_raises() -> None:
    published_cmd_vel: list[Twist] = []
    published_cancel: list[Bool] = []
    router = MotionRouter(
        publish_cmd_vel=published_cmd_vel.append,
        publish_nav_goal=lambda goal: None,
        publish_nav_point_goal=lambda goal: None,
        publish_stop_movement=published_cancel.append,
        publish_cancel_goal=published_cancel.append,
        hard_stop=MagicMock(side_effect=RuntimeError("boom")),
    )

    router.emergency_stop()

    assert published_cmd_vel[-1].linear.x == pytest.approx(0.0)
    assert len(published_cancel) == 2


def test_on_complete_invoked() -> None:
    router, _cmd_vel, _nav, _point_nav, _cancel = _make_router()
    seen: list[tuple[bool, BaseException | None]] = []
    done = threading.Event()

    def on_complete(ok: bool, err: BaseException | None) -> None:
        seen.append((ok, err))
        done.set()

    router.send_joystick_command(0.0, 0.3, 0.0, on_complete=on_complete)
    assert done.wait(timeout=2.0)
    assert seen == [(True, None)]


def test_joystick_republisher_keeps_publishing() -> None:
    router, cmd_vel, _nav, _point_nav, _cancel = _make_router()
    router.send_joystick_command(0.0, 0.2, 0.0)
    time.sleep(0.25)
    assert len(cmd_vel) >= 2
    router.send_joystick_command(0.0, 0.0, 0.0)


def test_non_blocking_under_slow_publish() -> None:
    router, cmd_vel, _nav, _point_nav, _cancel = _make_router(slow_cmd_vel=True)
    router.send_joystick_command(0.0, 0.3, 0.0)
    router.send_joystick_command(0.0, 0.0, 0.0)
    _wait_for_cmd_vel_count(cmd_vel, 2)
