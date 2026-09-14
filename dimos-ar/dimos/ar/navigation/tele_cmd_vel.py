from __future__ import annotations

import asyncio
from collections.abc import Callable

from dimos.ar.navigation.types import NavJoystickRequest
from dimos.msgs.geometry_msgs.Twist import Twist

HOLD_HZ = 10
HOLD_PERIOD_S = 1.0 / HOLD_HZ


def _clamp(value: float, limit: float) -> float:
    return max(-limit, min(limit, value))


class TeleCmdVelPublisher:
    def __init__(
        self,
        *,
        publish: Callable[[Twist], None],
        max_linear_mps: float,
        max_angular_rps: float,
        loop: asyncio.AbstractEventLoop,
    ) -> None:
        self._publish = publish
        self._max_linear_mps = max_linear_mps
        self._max_angular_rps = max_angular_rps
        self._loop = loop
        self._generation = 0
        self._task: asyncio.Task[None] | None = None
        self._last_nonzero = False

    def handle(self, msg: NavJoystickRequest) -> None:
        self._stop_hold()
        twist = self._twist_from(msg)
        moving = not twist.is_zero()
        if not moving:
            if not self._last_nonzero:
                return
            self._last_nonzero = False
            self._publish(twist)
            return
        self._last_nonzero = True
        self._publish(twist)
        if msg.duration:
            generation = self._generation
            self._task = self._loop.create_task(self._hold(twist, msg.duration, generation))

    def cancel(self) -> None:
        self._stop_hold()
        if self._last_nonzero:
            self._last_nonzero = False
            self._publish(Twist())

    def _stop_hold(self) -> None:
        self._generation += 1
        task = self._task
        self._task = None
        if task is not None and not task.done():
            self._cancel_task(task)

    def _cancel_task(self, task: asyncio.Task[None]) -> None:
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is self._loop:
            task.cancel()
            return
        self._loop.call_soon_threadsafe(task.cancel)

    async def _hold(self, twist: Twist, duration: float, generation: int) -> None:
        deadline = self._loop.time() + duration
        try:
            while True:
                remaining = deadline - self._loop.time()
                if remaining <= 0.0:
                    break
                await asyncio.sleep(min(HOLD_PERIOD_S, remaining))
                if generation != self._generation:
                    return
                remaining = deadline - self._loop.time()
                if remaining <= 0.0:
                    break
                self._publish(twist)
            if generation != self._generation:
                return
            self._last_nonzero = False
            self._publish(Twist())
        except asyncio.CancelledError:
            return

    def _twist_from(self, msg: NavJoystickRequest) -> Twist:
        return Twist(
            linear=(
                _clamp(msg.linear[0], self._max_linear_mps),
                _clamp(msg.linear[1], self._max_linear_mps),
                0.0,
            ),
            angular=(
                0.0,
                0.0,
                _clamp(msg.angular[2], self._max_angular_rps),
            ),
        )
