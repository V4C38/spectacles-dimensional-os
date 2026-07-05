"""WebSocket inbound scheduling for AR text messages.

The WebSocket read loop decodes text frames and submits them here. It must not
await synchronous handlers directly. Lanes describe scheduling semantics:
ORDERED preserves FIFO for session state, BACKGROUND runs independent sync
handlers on a bounded executor, and ASYNC schedules native coroutine handlers.
Binary camera frames stay outside this dispatcher to preserve existing frame
backpressure.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING, cast

from dimos.ar.network.protocol import (
    CameraInfoMessage,
    CancelNavGoalMessage,
    EmergencyStopMessage,
    GetStatusMessage,
    InboundMessage,
    JoystickCommandMessage,
    NavGoalMessage,
    PingMessage,
    RegistrationCommandMessage,
    RegistrationPoseMessage,
    SetLidarModeMessage,
)
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from websockets.asyncio.server import ServerConnection

logger = setup_logger()

BACKGROUND_WORKERS = 4

SyncInboundHandler = Callable[[InboundMessage, "ServerConnection"], None]
AsyncInboundHandler = Callable[[InboundMessage, "ServerConnection"], Awaitable[None]]
AnyInboundHandler = SyncInboundHandler | AsyncInboundHandler


class DispatchLane(StrEnum):
    ORDERED = "ordered"
    BACKGROUND = "background"
    ASYNC = "async"
    INLINE = "inline"


MESSAGE_LANES: dict[type[InboundMessage], DispatchLane] = {
    RegistrationCommandMessage: DispatchLane.ORDERED,
    RegistrationPoseMessage: DispatchLane.ORDERED,
    CameraInfoMessage: DispatchLane.BACKGROUND,
    GetStatusMessage: DispatchLane.BACKGROUND,
    SetLidarModeMessage: DispatchLane.BACKGROUND,
    NavGoalMessage: DispatchLane.BACKGROUND,
    CancelNavGoalMessage: DispatchLane.BACKGROUND,
    EmergencyStopMessage: DispatchLane.BACKGROUND,
    JoystickCommandMessage: DispatchLane.BACKGROUND,
    PingMessage: DispatchLane.ASYNC,
}


@dataclass(frozen=True)
class _DispatchJob:
    inbound: InboundMessage
    websocket: ServerConnection
    handler: SyncInboundHandler


def lane_for_message(inbound: InboundMessage) -> DispatchLane:
    """Return the scheduling lane for an inbound text message."""
    return MESSAGE_LANES[type(inbound)]


class InboundDispatcher:
    """Owns text inbound worker lifecycle for an ``ARWebSocketServer``."""

    def __init__(self, *, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop
        self._ordered_queue: asyncio.Queue[_DispatchJob] | None = None
        self._ordered_task: asyncio.Task[None] | None = None
        self._background_executor: ThreadPoolExecutor | None = None
        self._background_tasks: set[asyncio.Future[object]] = set()
        self._async_tasks: set[asyncio.Task[None]] = set()
        self._running = False

    def start(self) -> None:
        if self._running:
            return
        self._ordered_queue = asyncio.Queue()
        self._background_executor = ThreadPoolExecutor(
            max_workers=BACKGROUND_WORKERS,
            thread_name_prefix="ARInbound",
        )
        self._ordered_task = asyncio.create_task(self._ordered_worker())
        self._running = True

    async def stop(self) -> None:
        self._running = False
        if self._ordered_task is not None:
            self._ordered_task.cancel()
            try:
                await self._ordered_task
            except asyncio.CancelledError:
                pass
            self._ordered_task = None
        self._ordered_queue = None
        for task in list(self._async_tasks):
            task.cancel()
        if self._async_tasks:
            await asyncio.gather(*self._async_tasks, return_exceptions=True)
        self._async_tasks.clear()
        executor = self._background_executor
        self._background_executor = None
        if executor is not None:
            executor.shutdown(wait=False, cancel_futures=True)
        self._background_tasks.clear()

    def submit(
        self,
        inbound: InboundMessage,
        websocket: ServerConnection,
        handler: AnyInboundHandler | None,
    ) -> None:
        """Submit work and return immediately to the WebSocket read loop."""
        if not self._running:
            logger.warning("Inbound message dropped: dispatcher stopped", type=type(inbound).__name__)
            return
        if handler is None:
            return
        lane = lane_for_message(inbound)
        if lane == DispatchLane.ORDERED:
            queue = self._ordered_queue
            if queue is None:
                logger.warning("ORDERED inbound dropped: dispatcher queue missing")
                return
            queue.put_nowait(
                _DispatchJob(
                    inbound=inbound,
                    websocket=websocket,
                    handler=handler,  # type: ignore[arg-type]
                )
            )
            return
        if lane == DispatchLane.BACKGROUND:
            executor = self._background_executor
            if executor is None:
                logger.warning("BACKGROUND inbound dropped: dispatcher executor missing")
                return
            future = cast(
                "asyncio.Future[object]",
                self._loop.run_in_executor(
                    executor,
                    InboundDispatcher._run_sync_handler,
                    inbound,
                    websocket,
                    cast("SyncInboundHandler", handler),
                ),
            )
            self._background_tasks.add(future)
            future.add_done_callback(self._background_tasks.discard)
            return
        if lane == DispatchLane.ASYNC:
            task = asyncio.create_task(
                self._run_async_handler(
                    inbound,
                    websocket,
                    handler,  # type: ignore[arg-type]
                )
            )
            self._async_tasks.add(task)
            task.add_done_callback(self._async_tasks.discard)
            return
        raise ValueError(f"Unsupported text dispatch lane: {lane}")

    async def _ordered_worker(self) -> None:
        assert self._ordered_queue is not None
        while True:
            job = await self._ordered_queue.get()
            try:
                await asyncio.to_thread(job.handler, job.inbound, job.websocket)
            except Exception as exc:
                logger.exception(
                    "ORDERED inbound handler failed",
                    type=type(job.inbound).__name__,
                    error=str(exc),
                )

    @staticmethod
    def _run_sync_handler(
        inbound: InboundMessage,
        websocket: ServerConnection,
        handler: SyncInboundHandler,
    ) -> None:
        try:
            handler(inbound, websocket)
        except Exception as exc:
            logger.exception(
                "BACKGROUND inbound handler failed",
                type=type(inbound).__name__,
                error=str(exc),
            )

    @staticmethod
    async def _run_async_handler(
        inbound: InboundMessage,
        websocket: ServerConnection,
        handler: AsyncInboundHandler,
    ) -> None:
        try:
            await handler(inbound, websocket)
        except Exception as exc:
            logger.exception(
                "ASYNC inbound handler failed",
                type=type(inbound).__name__,
                error=str(exc),
            )
