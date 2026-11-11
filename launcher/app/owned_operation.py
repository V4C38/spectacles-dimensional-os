"""One cancellable task for dependency work; process cleanup belongs to its coroutine."""

from __future__ import annotations

import asyncio
from collections.abc import Coroutine
from typing import Any


class OwnedOperation:
    def __init__(self) -> None:
        self.task: asyncio.Task[Any] | None = None
        self.process: asyncio.subprocess.Process | None = None

    @property
    def running(self) -> bool:
        return self.task is not None and not self.task.done()

    def start(self, work: Coroutine[Any, Any, Any]) -> asyncio.Task[Any]:
        if self.running:
            work.close()
            raise RuntimeError("another dependency operation is already running")
        self.task = asyncio.create_task(work)
        return self.task

    async def cancel(self) -> None:
        task, self.task = self.task, None
        if task is None or task.done():
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
