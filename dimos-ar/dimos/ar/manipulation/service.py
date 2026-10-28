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
    ) -> None:
        self.runtime = runtime
        self._send = send
        self._broadcast = broadcast
        self._tasks: set[asyncio.Task[None]] = set()
        self._pending: set[tuple[str, str]] = set()
        self._closed = False
        self._poll: asyncio.Task[None] | None = None
        self._clients: set[str] = set()
        self._updates: dict[str, tuple[ManipulationRequest, float]] = {}

    def start(self) -> None:
        self._poll = asyncio.create_task(self._poll_state())

    def connect(self, client_id: str) -> None:
        self._clients.add(client_id)

    def submit(self, request: ManipulationRequest, client_id: str, clock_offset: float = 0) -> None:
        if self._closed or client_id not in self._clients:
            return
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
            result = await asyncio.to_thread(self.runtime.ar_manipulation_command, client_id, body)
        except Exception as exc:
            logger.exception("Manipulation command failed")
            result = {"status": "rejected", "message": str(exc)}
        if request.action != "update" or result.get("status") == "rejected":
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
                snapshot = await asyncio.to_thread(self.runtime.ar_manipulation_snapshot)
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
        self._spawn(
            asyncio.to_thread(self.runtime.ar_manipulation_disconnect, client_id),
            (client_id, "disconnect"),
        )

    async def close(self) -> None:
        self._closed = True
        clients = tuple(self._clients)
        self._clients.clear()
        self._updates.clear()
        await asyncio.gather(
            *(
                asyncio.to_thread(self.runtime.ar_manipulation_disconnect, client)
                for client in clients
            )
        )
        await asyncio.to_thread(self.runtime.ar_manipulation_stop)
        if self._poll:
            self._poll.cancel()
            await asyncio.gather(self._poll, return_exceptions=True)
        if self._tasks:
            await asyncio.gather(*tuple(self._tasks), return_exceptions=True)
