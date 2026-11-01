"""Bounded asynchronous dispatch to the optional manipulation Spec."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
import logging
from typing import Any

from dimos.ar.manipulation.protocol import ManipulationRequest
from dimos.ar.manipulation.rpc import ManipulationRPC
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
        on_snapshot: Callable[[dict[str, Any]], None] | None = None,
        on_result: Callable[[ManipulationRequest, dict[str, Any]], None] | None = None,
    ) -> None:
        self._rpc = ManipulationRPC(runtime)
        self._send = send
        self._broadcast = broadcast
        self._on_ready = on_ready
        self._on_snapshot = on_snapshot
        self._on_result = on_result
        self._latest_snapshot: dict[str, Any] | None = None
        self._tasks: set[asyncio.Task[None]] = set()
        self._pending: set[tuple[str, str]] = set()
        self._closed = False
        self._poll: asyncio.Task[None] | None = None
        self._clients: set[str] = set()
        self._updates: dict[str, tuple[ManipulationRequest, float]] = {}
        self._ready_reported = False
        self._quiescing = False
        self._quiescent = False
        self._pending_stop: tuple[str | None, int | None] | None = None
        self._authority_epoch: str | None = None
        self._authority_revision = -1

    def start(self) -> None:
        self._poll = asyncio.create_task(self._poll_state())

    def connect(self, client_id: str) -> None:
        self._clients.add(client_id)
        if self._latest_snapshot is not None:
            self._send(
                client_id, encode_text({**self._latest_snapshot, "type": "manipulation_state"})
            )

    def submit(self, request: ManipulationRequest, client_id: str, clock_offset: float = 0) -> None:
        if self._closed or client_id not in self._clients:
            return
        self._record_authority(
            request.payload.get("authority_epoch"), request.payload.get("authority_revision")
        )
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
            if not finished.cancelled() and (error := finished.exception()) is not None:
                logger.error(
                    "Manipulation RPC task failed: %s",
                    key,
                    exc_info=(type(error), error, error.__traceback__),
                )

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
            result = await self._rpc.call(
                "ar_manipulation_command",
                client_id,
                body,
                timeout=57 if request.action in {"reset_joints", "prepare_shutdown"} else 20,
            )
            if request.action == "prepare_shutdown":
                self._quiescent = result.get("quiescent") is True
        except ValueError as exc:
            result = {"status": "rejected", "code": "rejected", "message": str(exc)}
            logger.info("Manipulation request rejected: %s: %s", request.action, str(exc))
        except Exception as exc:
            logger.exception("Manipulation command failed")
            result = {
                "status": "uncertain"
                if request.action in {"execute", "reset_joints", "prepare_shutdown"}
                else "rejected",
                "code": "rpc_uncertain",
                "message": str(exc),
            }
        if request.action == "update":
            result.setdefault("sequence", request.payload["sequence"])
        if request.action != "update" or result.get("status") in {
            "rejected",
            "infeasible",
            "feasible",
        }:
            self._reply(client_id, request, result)

    def _reply(self, client_id: str, request: ManipulationRequest, result: dict[str, Any]) -> None:
        if self._on_result is not None:
            self._on_result(request, result)
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
                snapshot = await self._rpc.call("ar_manipulation_snapshot")
                self._latest_snapshot = snapshot
                if self._on_snapshot is not None:
                    self._on_snapshot(snapshot)
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

    def _record_authority(self, epoch: object, revision: object) -> None:
        if (
            isinstance(epoch, str)
            and epoch
            and isinstance(revision, int)
            and not isinstance(revision, bool)
            and revision >= self._authority_revision
        ):
            self._authority_epoch, self._authority_revision = epoch, revision

    def revoke(self, epoch: str, lease_id: str, revision: int, reason: str) -> None:
        self._record_authority(epoch, revision)
        if not self._closed:
            self._spawn(
                self._rpc.call("ar_manipulation_revoke", epoch, lease_id, revision, reason),
                ("server", f"revoke-{revision}"),
            )

    def emergency_stop(self, epoch: str | None = None, revision: int | None = None) -> None:
        key = ("server", "estop")
        if self._closed:
            return
        self._updates.clear()
        self._record_authority(epoch, revision)
        self._pending_stop = (epoch, revision)
        if key not in self._pending:
            self._spawn(self._drain_stops(), key)

    async def _drain_stops(self) -> None:
        while self._pending_stop is not None:
            epoch, revision = self._pending_stop
            self._pending_stop = None
            args = () if epoch is None else (epoch, revision)
            await self._rpc.call("ar_manipulation_stop", *args)

    def disconnect(self, client_id: str) -> None:
        self._clients.discard(client_id)
        self._updates.pop(client_id, None)
        if self._closed or self._quiescent:
            return
        self._spawn(
            self._rpc.call("ar_manipulation_disconnect", client_id),
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
        if not self._quiescent:
            # Stop once before retiring individual leases, with a bounded RPC deadline.
            try:
                stop_args = (
                    ()
                    if self._authority_epoch is None
                    else (self._authority_epoch, self._authority_revision + 1)
                )
                await self._rpc.call("ar_manipulation_stop", *stop_args, timeout=0.8)
                await asyncio.gather(
                    *(
                        self._rpc.call("ar_manipulation_disconnect", client, timeout=0.3)
                        for client in clients
                    ),
                    return_exceptions=True,
                )
            except Exception:
                logger.warning(
                    "Manipulation stop acknowledgement unavailable during teardown", exc_info=True
                )
        for task in tuple(self._tasks):
            task.cancel()
        await asyncio.gather(*tuple(self._tasks), return_exceptions=True)
