"""Bounded asynchronous admission to repository-owned native navigation."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
import logging
import time
from typing import Any

from dimos.ar.native_rpc import (
    CONTROL_LEASE_S,
    HEARTBEAT_INTERVAL_S,
    HEARTBEAT_TIMEOUT_S,
    NativeRPC,
)
from dimos.ar.navigation.control_spec import ARNavigationControlSpec
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped

logger = logging.getLogger(__name__)


class NavigationControlService:
    def __init__(
        self,
        runtime: ARNavigationControlSpec,
        state: Callable[[], tuple[str, int]],
        on_failure: Callable[[float], None],
        on_recovered: Callable[[], None] | None = None,
    ) -> None:
        self._rpc = NativeRPC(runtime)
        self._state = state
        self._on_failure = on_failure
        self._on_recovered = on_recovered
        self._heartbeat: asyncio.Task[None] | None = None
        self._worker: asyncio.Task[None] | None = None
        self._recovery: asyncio.Task[None] | None = None
        self._pending: tuple[PoseStamped, str, int, int] | None = None
        self._generation = 0
        self._closed = False
        self._fault = False

    @property
    def faulted(self) -> bool:
        return self._fault

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
                        time.monotonic() + CONTROL_LEASE_S,
                        timeout=HEARTBEAT_TIMEOUT_S,
                    )
                except Exception:
                    logger.exception("Native navigation heartbeat unavailable")
                    await self._rpc.wait_idle("ar_navigation_heartbeat")
            await asyncio.sleep(HEARTBEAT_INTERVAL_S)

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
        if self._fault and not self._closed and (self._recovery is None or self._recovery.done()):
            self._recovery = asyncio.create_task(self._recover())

    async def _recover(self) -> None:
        # A timeout does not cancel native work. An explicit Stop can recover
        # only after the actual old admission finishes and native stop is acknowledged.
        await self._rpc.wait_idle("ar_navigation_goal")
        await self._rpc.wait_idle("ar_navigation_recover")
        if self._closed:
            return
        epoch, revision = self._state()
        try:
            stopped = await self._rpc.call(
                "ar_navigation_recover", epoch, revision, time.monotonic() + 0.5
            )
        except Exception:
            logger.exception("Native navigation stop could not be confirmed")
            return
        if stopped and self._state()[0] == epoch and not self._closed:
            self._fault = False
            if self._on_recovered is not None:
                self._on_recovered()

    async def close(self) -> None:
        self._closed = True
        self.cancel()
        tasks: list[asyncio.Task[Any]] = [
            task for task in (self._heartbeat, self._worker, self._recovery) if task is not None
        ]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self._rpc.close()
