from __future__ import annotations

import asyncio
from typing import Any

from dimos.ar.manipulation.spec import ARManipulationSpec


class ManipulationRPC:
    def __init__(self, runtime: ARManipulationSpec) -> None:
        self.runtime = runtime

    async def call(self, method: str, *args: Any, timeout: float = 2.0) -> Any:
        """Unsubscribe the real RPC callback when its asyncio owner is cancelled."""
        backend = getattr(self.runtime, "rpc", None)
        remote = getattr(self.runtime, "remote_name", None)
        if backend is None or not isinstance(remote, str):
            return await asyncio.wait_for(
                asyncio.to_thread(getattr(self.runtime, method), *args), timeout
            )
        loop = asyncio.get_running_loop()
        future: asyncio.Future[Any] = loop.create_future()

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
        try:
            return await asyncio.wait_for(future, timeout)
        finally:
            if unsubscribe is not None:
                unsubscribe()
