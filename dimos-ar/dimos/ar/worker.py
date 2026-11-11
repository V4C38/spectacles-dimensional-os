from __future__ import annotations

import asyncio
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import TypeVar

_T = TypeVar("_T")


class BoundedWorker:
    """Keep admission until native work finishes, even if its waiter is cancelled."""

    def __init__(self, thread_name: str = "ar-localization", *, parallelism: int = 1) -> None:
        self._executor = ThreadPoolExecutor(max_workers=parallelism, thread_name_prefix=thread_name)
        self._permit = asyncio.Semaphore(parallelism)
        self._closed = False

    async def run(self, work: Callable[[], _T]) -> _T:
        await self._permit.acquire()
        if self._closed:
            self._permit.release()
            raise RuntimeError("worker is closed")
        try:
            future = asyncio.get_running_loop().run_in_executor(self._executor, work)
        except BaseException:
            self._permit.release()
            raise
        future.add_done_callback(lambda _future: self._permit.release())
        future.add_done_callback(lambda done: None if done.cancelled() else done.exception())
        return await asyncio.shield(future)

    async def run_if_idle(self, work: Callable[[], _T]) -> _T | None:
        if self._closed or self._permit.locked():
            return None
        return await self.run(work)

    def close(self) -> None:
        self._closed = True
        self._executor.shutdown(wait=False, cancel_futures=True)
