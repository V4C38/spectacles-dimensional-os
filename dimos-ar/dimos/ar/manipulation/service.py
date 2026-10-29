"""Bounded asynchronous dispatch to the optional manipulation Spec."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
import logging
from typing import Any

from dimos.ar.manipulation.protocol import ManipulationRequest
from dimos.ar.manipulation.spec import ARManipulationSpec
from dimos.ar.websocket.protocol import encode_text

logger = logging.getLogger(__name__)


class ManipulationService:
    def __init__(
        self,
        runtime: ARManipulationSpec,
        send: Callable[[str, str], None],
        broadcast: Callable[[str], None],
        on_ready: Callable[[], None] | None = None,
    ) -> None:
        self.runtime = runtime
        self._send = send
        self._broadcast = broadcast
        self._on_ready = on_ready
        self._tasks: set[asyncio.Task[None]] = set()
        self._pending: set[tuple[str, str]] = set()
        self._closed = False
        self._poll: asyncio.Task[None] | None = None
        self._clients: set[str] = set()
        self._updates: dict[str, tuple[ManipulationRequest, float]] = {}
        self._ready_reported = False
        self._quiescing = False
        self._shutdown_prepared = False

    async def _call(self, method: str, *args: Any, timeout: float = 2.0) -> Any:
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

    def start(self) -> None:
        self._poll = asyncio.create_task(self._poll_state())

    def connect(self, client_id: str) -> None:
        self._clients.add(client_id)

    def submit(self, request: ManipulationRequest, client_id: str, clock_offset: float = 0) -> None:
        if self._closed or client_id not in self._clients:
            return
        if self._quiescing and request.action not in {"cancel", "release"}:
            self._reply(
                client_id,
                request,
                {"status": "rejected", "code": "stopping", "message": "Stopping"},
            )
            return
        if request.action == "prepare_shutdown":
            self._quiescing = True
            self._updates.clear()
        if request.action == "update":
            self._updates[client_id] = (request, clock_offset)
            key = (client_id, "update")
            if key not in self._pending and len(self._tasks) >= 16:
                self._updates.pop(client_id, None)
                self._reply(client_id, request, {"status": "rejected", "message": "server busy"})
                return
            if key not in self._pending:
                self._spawn(self._drain_updates(client_id), key)
            return
        key = (client_id, "advisory" if request.action == "evaluate" else request.action)
        if key in self._pending or (
            len(self._tasks) >= 16 and request.action not in {"cancel", "release"}
        ):
            self._reply(
                client_id,
                request,
                {"status": "rejected", "message": "request already pending or server busy"},
            )
            return
        self._spawn(self._dispatch(request, client_id, clock_offset), key)

    def _spawn(self, coroutine: Any, key: tuple[str, str]) -> None:
        self._pending.add(key)
        task = asyncio.create_task(coroutine)
        self._tasks.add(task)

        def done(finished: asyncio.Task[None]) -> None:
            self._tasks.discard(finished)
            self._pending.discard(key)

        task.add_done_callback(done)

    async def _drain_updates(self, client_id: str) -> None:
        while client_id in self._updates and client_id in self._clients:
            request, offset = self._updates.pop(client_id)
            await self._dispatch(request, client_id, offset)

    async def _dispatch(
        self, request: ManipulationRequest, client_id: str, clock_offset: float
    ) -> None:
        body = {**request.payload, "action": request.action, "group_id": request.group_id}
        if request.action == "update":
            body["ts"] += clock_offset
        try:
            result = await self._call(
                "ar_manipulation_command",
                client_id,
                body,
                timeout=57 if request.action in {"reset_joints", "prepare_shutdown"} else 20,
            )
            if request.action == "prepare_shutdown":
                self._shutdown_prepared = True
        except ValueError as exc:
            result = {"status": "rejected", "code": "rejected", "message": str(exc)}
            logger.info("Manipulation request rejected: %s: %s", request.action, str(exc))
        except Exception as exc:
            logger.exception("Manipulation command failed")
            result = {"status": "rejected", "message": str(exc)}
        if request.action == "update":
            result.setdefault("sequence", request.payload["sequence"])
        if request.action != "update" or result.get("status") in {
            "rejected",
            "infeasible",
            "feasible",
        }:
            self._reply(client_id, request, result)

    def _reply(self, client_id: str, request: ManipulationRequest, result: dict[str, Any]) -> None:
        if client_id in self._clients and not self._closed:
            self._send(
                client_id,
                encode_text(
                    {
                        **result,
                        "type": "manipulation_result",
                        "request_id": request.request_id,
                        "action": request.action,
                        "group_id": request.group_id,
                    }
                ),
            )

    async def _poll_state(self) -> None:
        while not self._closed:
            try:
                snapshot = await self._call("ar_manipulation_snapshot")
                if snapshot.get("available") and not self._ready_reported:
                    if self._on_ready is not None:
                        self._on_ready()
                    self._ready_reported = True
                self._broadcast(encode_text({**snapshot, "type": "manipulation_state"}))
            except Exception as exc:
                logger.exception("Manipulation observation failed")
                self._broadcast(
                    encode_text(
                        {"type": "manipulation_state", "available": False, "message": str(exc)}
                    )
                )
            await asyncio.sleep(0.1)

    def disconnect(self, client_id: str) -> None:
        self._clients.discard(client_id)
        self._updates.pop(client_id, None)
        if self._closed or self._shutdown_prepared:
            return
        self._spawn(
            self._call("ar_manipulation_disconnect", client_id),
            (client_id, "disconnect"),
        )

    async def close(self) -> None:
        self._closed = True
        # Retire observation calls before the runtime and its RPC session shut down.
        if self._poll:
            self._poll.cancel()
            await asyncio.gather(self._poll, return_exceptions=True)
            self._poll = None
        clients = tuple(self._clients)
        self._clients.clear()
        self._updates.clear()
        if not self._shutdown_prepared:
            # Stop once before retiring individual leases, with a bounded RPC deadline.
            try:
                await self._call("ar_manipulation_stop", timeout=0.8)
                await asyncio.gather(
                    *(
                        self._call("ar_manipulation_disconnect", client, timeout=0.3)
                        for client in clients
                    ),
                    return_exceptions=True,
                )
            except (TimeoutError, ValueError):
                logger.warning("Manipulation stop acknowledgement unavailable during teardown")
        for task in tuple(self._tasks):
            task.cancel()
        await asyncio.gather(*tuple(self._tasks), return_exceptions=True)
