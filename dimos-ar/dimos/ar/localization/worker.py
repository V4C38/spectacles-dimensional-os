from __future__ import annotations

import asyncio
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import TypeVar

_T = TypeVar("_T")


class LocalizationWorker:
    """One CPU job at a time, including after its awaiting episode is cancelled.

    Cancelling an asyncio task does not stop a native detector/encoder. Keep the
    permit until the actual worker finishes so replacements cannot fill an
    executor's otherwise unbounded submission queue. Jobs must not mutate policy.
    """

    def __init__(self) -> None:
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ar-localization")
        self._permit = asyncio.Semaphore(1)
        self._closed = False

    async def run(self, work: Callable[[], _T]) -> _T:
        await self._permit.acquire()
        if self._closed:
            self._permit.release()
            raise RuntimeError("localization worker is closed")
        loop = asyncio.get_running_loop()
        future = loop.run_in_executor(self._executor, work)
        future.add_done_callback(lambda _future: self._permit.release())
        # Observe exceptions even when the original waiter has gone away.
        future.add_done_callback(lambda done: None if done.cancelled() else done.exception())
        return await asyncio.shield(future)

    def close(self) -> None:
        self._closed = True
        self._executor.shutdown(wait=False, cancel_futures=True)
