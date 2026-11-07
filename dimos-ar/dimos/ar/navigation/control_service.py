"""Bounded asynchronous admission to repository-owned native navigation."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
import logging
import time
from typing import Any

from dimos.ar.manipulation.rpc import ManipulationRPC
from dimos.ar.navigation.control_spec import ARNavigationControlSpec
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped

logger = logging.getLogger(__name__)


class NavigationControlService:
    def __init__(
        self,
        runtime: ARNavigationControlSpec,
        state: Callable[[], tuple[str, int]],
        on_failure: Callable[[float], None],
    ) -> None:
        self._rpc = ManipulationRPC(runtime)  # type: ignore[arg-type]
        self._state = state
        self._on_failure = on_failure
        self._heartbeat: asyncio.Task[None] | None = None
        self._worker: asyncio.Task[None] | None = None
        self._pending: tuple[PoseStamped, str, int, int] | None = None
        self._generation = 0
        self._closed = False
        self._fault = False

    def start(self) -> None:
        self._heartbeat = asyncio.create_task(self._renew())

    async def _renew(self) -> None:
        while not self._closed:
            if not self._fault:
                epoch, revision = self._state()
                try:
                    await self._rpc.call(
                        "ar_navigation_heartbeat",
                        epoch,
                        revision,
                        time.monotonic() + 0.5,
                        timeout=0.3,
                    )
                except Exception:
                    logger.exception("Native navigation heartbeat unavailable")
                    await self._rpc.wait_idle("ar_navigation_heartbeat")
            await asyncio.sleep(0.1)

    def submit(self, goal: PoseStamped, epoch: str, revision: int) -> bool:
        if self._closed or self._fault:
            return False
        self._pending = goal, epoch, revision, self._generation
        if self._worker is None or self._worker.done():
            self._worker = asyncio.create_task(self._drain())
        return True

    async def _drain(self) -> None:
        while self._pending is not None and not self._closed:
            goal, epoch, revision, generation = self._pending
            self._pending = None
            try:
                accepted = await self._rpc.call(
                    "ar_navigation_goal",
                    goal,
                    epoch,
                    revision,
                    time.monotonic() + 0.5,
                    timeout=2,
                )
            except Exception:
                logger.exception("Native navigation goal outcome unknown")
                accepted = False
                self._fault = True  # Withhold heartbeats: native watchdog stops motion.
            if generation == self._generation and not accepted:
                self._on_failure(float(goal.ts))

    def cancel(self) -> None:
        self._pending = None
        self._generation += 1

    async def close(self) -> None:
        self._closed = True
        self.cancel()
        tasks: list[asyncio.Task[Any]] = [
            task for task in (self._heartbeat, self._worker) if task is not None
        ]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self._rpc.close()
