"""Bounded thread work and native RPC admission with independent lifecycles."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any, TypeVar

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


CONTROL_LEASE_S = 0.5
HEARTBEAT_TIMEOUT_S = 0.3
HEARTBEAT_INTERVAL_S = 0.1


class NativeRPCQuarantinedError(TimeoutError):
    """The previous actual native operation has not returned."""


class NativeRPC:
    def __init__(self, runtime: object) -> None:
        self.runtime = runtime
        self._inflight: dict[str, asyncio.Future[Any]] = {}
        self._subscriptions: dict[str, Callable[[], None]] = {}
        self._closed = False

    @staticmethod
    def _category(method: str, args: tuple[Any, ...]) -> str:
        if method == "ar_manipulation_command" and len(args) > 1:
            return method + ":" + str(args[1].get("action"))
        if method == "ar_manipulation_asset" and args:
            return method + ":" + str(args[0])
        return method

    async def call(self, method: str, *args: Any, timeout: float = 2.0) -> Any:
        """Timeout retires a waiter, never the actual native admission slot."""
        if self._closed:
            raise RuntimeError("native RPC owner is closed")
        category = self._category(method, args)
        if category in self._inflight:
            raise NativeRPCQuarantinedError(f"native operation still running: {category}")
        loop = asyncio.get_running_loop()
        backend = getattr(self.runtime, "rpc", None)
        remote = getattr(self.runtime, "remote_name", None)
        if backend is None or not isinstance(remote, str):
            future: asyncio.Future[Any] = asyncio.create_task(
                asyncio.to_thread(getattr(self.runtime, method), *args)
            )
        else:
            future = loop.create_future()

            def finish(value: Any) -> None:
                if future.done():
                    return
                if isinstance(value, BaseException):
                    future.set_exception(value)
                else:
                    future.set_result(value)

            def receive(value: Any) -> None:
                if not loop.is_closed():
                    loop.call_soon_threadsafe(finish, value)

            unsubscribe = backend.call(f"{remote}/{method}", (list(args), {}), receive)
            if unsubscribe is not None:
                self._subscriptions[category] = unsubscribe
        self._inflight[category] = future

        def done(completed: asyncio.Future[Any]) -> None:
            if self._inflight.get(category) is completed:
                self._inflight.pop(category, None)
                unsubscribe = self._subscriptions.pop(category, None)
                if unsubscribe is not None:
                    unsubscribe()
            if not completed.cancelled():
                completed.exception()  # Observe late errors after waiter timeout.

        future.add_done_callback(done)
        return await asyncio.wait_for(asyncio.shield(future), timeout)

    async def wait_idle(self, method: str, *args: Any) -> None:
        future = self._inflight.get(self._category(method, args))
        if future is not None:
            await asyncio.gather(asyncio.shield(future), return_exceptions=True)

    async def wait_readers(self) -> None:
        pending = [
            future
            for key, future in self._inflight.items()
            if key.startswith(("ar_manipulation_snapshot", "ar_manipulation_asset"))
        ]
        if pending:
            await asyncio.gather(
                *(asyncio.shield(future) for future in pending), return_exceptions=True
            )

    def close(self) -> None:
        self._closed = True
        for unsubscribe in tuple(self._subscriptions.values()):
            unsubscribe()
        self._subscriptions.clear()
        # The process owner handles any native work that outlives shutdown.
        # No replacement calls are admitted after these callbacks are detached.
        self._inflight.clear()
