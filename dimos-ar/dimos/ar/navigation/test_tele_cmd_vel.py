from __future__ import annotations

import asyncio

import pytest

from dimos.ar.navigation.tele_cmd_vel import TeleCmdVelPublisher
from dimos.ar.navigation.types import NavJoystickRequest
from dimos.msgs.geometry_msgs.Twist import Twist


def _publisher(published: list[Twist], loop: asyncio.AbstractEventLoop) -> TeleCmdVelPublisher:
    return TeleCmdVelPublisher(
        publish=published.append,
        max_linear_mps=1.5,
        max_angular_rps=2.0,
        loop=loop,
    )


def _cmd(
    *,
    linear: tuple[float, float, float] = (0.4, 0.0, 0.0),
    angular: tuple[float, float, float] = (0.0, 0.0, 0.0),
    duration: float | None = None,
) -> NavJoystickRequest:
    return NavJoystickRequest(linear=linear, angular=angular, duration=duration)


def test_idle_zeros_dropped_except_release_edge() -> None:
    published: list[Twist] = []
    pub = _publisher(published, asyncio.new_event_loop())
    pub.handle(_cmd(linear=(0.0, 0.0, 0.0)))
    assert published == []
    pub.handle(_cmd())
    assert len(published) == 1
    assert not published[0].is_zero()
    pub.handle(_cmd(linear=(0.0, 0.0, 0.0)))
    assert published[-1].is_zero()
    count = len(published)
    pub.handle(_cmd(linear=(0.0, 0.0, 0.0)))
    assert len(published) == count


def test_clamps_linear_and_angular() -> None:
    published: list[Twist] = []
    pub = _publisher(published, asyncio.new_event_loop())
    pub.handle(_cmd(linear=(9.0, -9.0, 0.0), angular=(0.0, 0.0, 9.0)))
    twist = published[-1]
    assert twist.linear.x == pytest.approx(1.5)
    assert twist.linear.y == pytest.approx(-1.5)
    assert twist.linear.z == pytest.approx(0.0)
    assert twist.angular.x == pytest.approx(0.0)
    assert twist.angular.y == pytest.approx(0.0)
    assert twist.angular.z == pytest.approx(2.0)


@pytest.mark.asyncio
async def test_duration_republishes_then_zeros() -> None:
    published: list[Twist] = []
    pub = _publisher(published, asyncio.get_running_loop())
    pub.handle(_cmd(duration=0.25))
    await asyncio.sleep(0.32)
    moving = [twist for twist in published if not twist.is_zero()]
    assert len(moving) >= 2
    assert published[-1].is_zero()


@pytest.mark.asyncio
async def test_second_command_replaces_hold_without_stale_zero() -> None:
    published: list[Twist] = []
    pub = _publisher(published, asyncio.get_running_loop())
    pub.handle(_cmd(linear=(0.4, 0.0, 0.0), duration=2.0))
    await asyncio.sleep(0.05)
    pub.handle(_cmd(linear=(0.2, 0.0, 0.0)))
    await asyncio.sleep(0.15)
    assert not published[-1].is_zero()
    assert published[-1].linear.x == pytest.approx(0.2)


@pytest.mark.asyncio
async def test_cancel_zeros_and_stops_hold() -> None:
    published: list[Twist] = []
    pub = _publisher(published, asyncio.get_running_loop())
    pub.handle(_cmd(duration=2.0))
    await asyncio.sleep(0.05)
    pub.cancel()
    assert published[-1].is_zero()
    count = len(published)
    await asyncio.sleep(0.15)
    assert len(published) == count
