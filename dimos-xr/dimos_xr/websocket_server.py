"""Daemon-thread WebSocket server for XR clients."""

from __future__ import annotations

import asyncio
import logging
import re
import threading
import time
from collections.abc import Awaitable, Callable
from typing import Any

import websockets
from dimos.constants import DEFAULT_THREAD_JOIN_TIMEOUT
from dimos.core.global_config import global_config
from dimos.utils.logging_config import setup_logger
from websockets.asyncio.server import Server, ServerConnection, serve

from dimos_xr.protocol import (
    AlignCommitMessage,
    AlignManualPoseMessage,
    AlignStartMessage,
    AlignStopMessage,
    CameraInfoMessage,
    CancelGoalMessage,
    EmergencyStopMessage,
    GetStatusMessage,
    InboundMessage,
    NavGoalMessage,
    PlanPathMessage,
    decode_inbound,
    encode_hello,
)
from dimos_xr.tag_tracker import parse_camera_frame

logger = setup_logger()

# Port probes / non-WebSocket clients (e.g. nc, browser) close immediately; avoid stack traces.
logging.getLogger("websockets").setLevel(logging.WARNING)

AlignStartHandler = Callable[[AlignStartMessage, ServerConnection], None]
AlignStopHandler = Callable[[AlignStopMessage, ServerConnection], None]
AlignCommitHandler = Callable[[AlignCommitMessage, ServerConnection], None]
CameraInfoHandler = Callable[[CameraInfoMessage, ServerConnection], None]
CameraFrameHandler = Callable[[dict[str, Any], bytes, ServerConnection], Awaitable[None]]
AlignManualPoseHandler = Callable[[AlignManualPoseMessage, ServerConnection], None]
NavGoalHandler = Callable[[NavGoalMessage], None]
PlanPathHandler = Callable[[PlanPathMessage], None]
CancelGoalHandler = Callable[[CancelGoalMessage], None]
EmergencyStopHandler = Callable[[EmergencyStopMessage], None]
GetStatusHandler = Callable[[GetStatusMessage, ServerConnection], None]
UnsupportedHandler = Callable[[InboundMessage], None]
StatusOnConnectHandler = Callable[[ServerConnection], None]
DisconnectHandler = Callable[[ServerConnection], None]
HelloSupplier = Callable[[], Any]

STARTUP_TIMEOUT_S = 10.0
OUTBOUND_FIFO_MAXSIZE = 64
OUTBOUND_BACKLOG_LOG_INTERVAL_S = 5.0
COALESCE_MESSAGE_TYPES = frozenset(
    {
        "lidar",
        "pose",
        "path",
        "path_preview",
        "nav_status",
        "bridge_status",
        "align_status",
        "camera_frame_ack",
    }
)
_MESSAGE_TYPE_RE = re.compile(r'"type"\s*:\s*"([^"]+)"')


def _peek_message_type(text: str) -> str | None:
    match = _MESSAGE_TYPE_RE.search(text)
    return match.group(1) if match else None


class _ConnectionOutbound:
    """Per-connection sender with latest-wins coalescing and bounded FIFO."""

    def __init__(self, websocket: ServerConnection) -> None:
        self._websocket = websocket
        self._queue: asyncio.Queue[tuple[int, str]] = asyncio.Queue(
            maxsize=OUTBOUND_FIFO_MAXSIZE,
        )
        self._coalesce_latest: dict[str, str] = {}
        self._sequence = 0
        self._sent_count = 0
        self._dropped_fifo_count = 0
        self._last_backlog_log_mono = 0.0
        self._work_available = asyncio.Event()
        self._task: asyncio.Task[None] | None = None
        self._closed = False

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._sender_loop())

    async def stop(self) -> None:
        self._closed = True
        self._work_available.set()
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    def enqueue(self, text: str) -> None:
        if self._closed:
            return
        msg_type = _peek_message_type(text)
        if msg_type in COALESCE_MESSAGE_TYPES:
            self._coalesce_latest[msg_type] = text
        else:
            self._sequence += 1
            item = (self._sequence, text)
            try:
                self._queue.put_nowait(item)
            except asyncio.QueueFull:
                try:
                    self._queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                self._dropped_fifo_count += 1
                try:
                    self._queue.put_nowait(item)
                except asyncio.QueueFull:
                    pass
        self._work_available.set()

    async def _sender_loop(self) -> None:
        try:
            while not self._closed:
                if self._queue.empty() and not self._coalesce_latest:
                    self._work_available.clear()
                    await self._work_available.wait()
                    if self._closed:
                        break

                try:
                    _seq, text = self._queue.get_nowait()
                except asyncio.QueueEmpty:
                    await self._flush_coalesced_batch()
                    continue

                await self._send(text)
                await self._flush_one_coalesced()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error(
                "XR WebSocket outbound sender crashed",
                error=str(exc),
            )

    async def _flush_one_coalesced(self) -> None:
        if not self._coalesce_latest:
            return
        msg_type = next(iter(self._coalesce_latest))
        text = self._coalesce_latest.pop(msg_type)
        await self._send(text)

    async def _flush_coalesced_batch(self) -> None:
        while self._coalesce_latest and not self._closed:
            await self._flush_one_coalesced()

    def _maybe_log_backlog(self) -> None:
        now = time.monotonic()
        if now - self._last_backlog_log_mono < OUTBOUND_BACKLOG_LOG_INTERVAL_S:
            return
        fifo_depth = self._queue.qsize()
        coalesce_depth = len(self._coalesce_latest)
        if fifo_depth == 0 and coalesce_depth == 0 and self._dropped_fifo_count == 0:
            return
        self._last_backlog_log_mono = now
        logger.debug(
            "XR WebSocket outbound backlog",
            fifo_depth=fifo_depth,
            coalesce_pending=coalesce_depth,
            dropped_fifo=self._dropped_fifo_count,
            sent_count=self._sent_count,
        )

    async def _send(self, text: str) -> None:
        try:
            await self._websocket.send(text)
            self._sent_count += 1
            self._maybe_log_backlog()
        except websockets.ConnectionClosed:
            self._closed = True
        except Exception as exc:
            msg_type = _peek_message_type(text)
            logger.warning(
                "XR WebSocket outbound send failed",
                error=str(exc),
                message_type=msg_type,
                payload_bytes=len(text.encode("utf-8")),
                sent_count=self._sent_count,
            )


class XRWebSocketServer:
    def __init__(
        self,
        *,
        port: int,
        hello_supplier: HelloSupplier,
        max_message_bytes: int,
        on_align_start: AlignStartHandler | None = None,
        on_align_stop: AlignStopHandler | None = None,
        on_align_commit: AlignCommitHandler | None = None,
        on_camera_info: CameraInfoHandler | None = None,
        on_camera_frame: CameraFrameHandler | None = None,
        on_align_manual_pose: AlignManualPoseHandler | None = None,
        on_nav_goal: NavGoalHandler | None = None,
        on_plan_path: PlanPathHandler | None = None,
        on_cancel_goal: CancelGoalHandler | None = None,
        on_emergency_stop: EmergencyStopHandler | None = None,
        on_get_status: GetStatusHandler | None = None,
        on_unsupported: UnsupportedHandler | None = None,
        on_status_connect: StatusOnConnectHandler | None = None,
        on_disconnect: DisconnectHandler | None = None,
    ) -> None:
        self._port = port
        self._hello_supplier = hello_supplier
        self._max_message_bytes = max_message_bytes
        self._on_align_start = on_align_start
        self._on_align_stop = on_align_stop
        self._on_align_commit = on_align_commit
        self._on_camera_info = on_camera_info
        self._on_camera_frame = on_camera_frame
        self._on_align_manual_pose = on_align_manual_pose
        self._on_nav_goal = on_nav_goal
        self._on_plan_path = on_plan_path
        self._on_cancel_goal = on_cancel_goal
        self._on_emergency_stop = on_emergency_stop
        self._on_get_status = on_get_status
        self._on_unsupported = on_unsupported
        self._on_status_connect = on_status_connect
        self._on_disconnect = on_disconnect

        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._server: Server | None = None
        self._connections: set[ServerConnection] = set()
        self._outbound: dict[ServerConnection, _ConnectionOutbound] = {}
        self._stop_future: asyncio.Future[None] | None = None
        self._ready = threading.Event()
        self._startup_error: BaseException | None = None

    @property
    def port(self) -> int:
        return self._port

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return

        self._ready.clear()
        self._startup_error = None

        def run_loop() -> None:
            loop = asyncio.new_event_loop()
            self._loop = loop
            asyncio.set_event_loop(loop)
            try:
                loop.run_until_complete(self._run_server())
            except BaseException as exc:
                self._startup_error = exc
                self._ready.set()
                raise
            finally:
                loop.close()
                self._loop = None

        self._thread = threading.Thread(target=run_loop, daemon=True, name="ar-ws")
        self._thread.start()

        host = global_config.listen_host
        logger.info("XR WebSocket server starting", host=host, port=self._port)

        if not self._ready.wait(timeout=STARTUP_TIMEOUT_S):
            raise TimeoutError(
                f"XR WebSocket server did not start within {STARTUP_TIMEOUT_S}s",
            )
        if self._startup_error is not None:
            raise RuntimeError("XR WebSocket server failed to start") from self._startup_error

    async def _run_server(self) -> None:
        loop = asyncio.get_running_loop()
        self._stop_future = loop.create_future()
        host = global_config.listen_host
        try:
            async with serve(
                self._handler,
                host,
                self._port,
                ping_interval=20,
                ping_timeout=20,
                max_size=self._max_message_bytes,
            ) as server:
                self._server = server
                logger.info("XR WebSocket server listening", host=host, port=self._port)
                if host in ("127.0.0.1", "localhost"):
                    logger.warning(
                        "WebSocket is localhost-only; Spectacles/phone cannot connect. "
                        "Restart without --local (default binds 0.0.0.0).",
                    )
                self._ready.set()
                await self._stop_future
        except BaseException:
            if not self._ready.is_set():
                self._ready.set()
            raise

    async def _handler(self, websocket: ServerConnection) -> None:
        self._connections.add(websocket)
        outbound = _ConnectionOutbound(websocket)
        self._outbound[websocket] = outbound
        outbound.start()
        try:
            hello = self._hello_supplier()
            await websocket.send(
                encode_hello(hello),
            )
            if self._on_status_connect is not None:
                self._on_status_connect(websocket)
            async for message in websocket:
                try:
                    if isinstance(message, bytes):
                        if self._on_camera_frame is None:
                            logger.warning("Binary camera_frame received but no handler")
                            continue
                        header, jpeg = parse_camera_frame(message)
                        if header.get("robot_id") != hello.robot_id:
                            raise ValueError(
                                f"camera_frame robot_id mismatch: {header.get('robot_id')}"
                            )
                        await self._on_camera_frame(header, jpeg, websocket)
                        continue
                    if not isinstance(message, str):
                        raise ValueError("Unsupported WebSocket frame type")
                    inbound = decode_inbound(message, expected_robot_id=hello.robot_id)
                    self._dispatch_inbound(inbound, websocket)
                except ValueError as exc:
                    logger.warning("Invalid inbound WebSocket message", error=str(exc))
                except Exception as exc:
                    logger.error(
                        "Unhandled inbound WebSocket handler error",
                        error=str(exc),
                    )
        except websockets.ConnectionClosed:
            pass
        finally:
            await outbound.stop()
            self._outbound.pop(websocket, None)
            self._connections.discard(websocket)
            if self._on_disconnect is not None:
                self._on_disconnect(websocket)

    def _dispatch_inbound(self, inbound: InboundMessage, websocket: ServerConnection) -> None:
        if isinstance(inbound, AlignStartMessage):
            if self._on_align_start is not None:
                self._on_align_start(inbound, websocket)
        elif isinstance(inbound, AlignStopMessage):
            if self._on_align_stop is not None:
                self._on_align_stop(inbound, websocket)
        elif isinstance(inbound, AlignCommitMessage):
            if self._on_align_commit is not None:
                self._on_align_commit(inbound, websocket)
        elif isinstance(inbound, CameraInfoMessage):
            if self._on_camera_info is not None:
                self._on_camera_info(inbound, websocket)
        elif isinstance(inbound, AlignManualPoseMessage):
            if self._on_align_manual_pose is not None:
                self._on_align_manual_pose(inbound, websocket)
        elif isinstance(inbound, NavGoalMessage):
            if self._on_nav_goal is not None:
                self._on_nav_goal(inbound)
            elif self._on_unsupported is not None:
                self._on_unsupported(inbound)
            else:
                logger.warning("nav_goal received but not supported in this blueprint")
        elif isinstance(inbound, PlanPathMessage):
            if self._on_plan_path is not None:
                self._on_plan_path(inbound)
            elif self._on_unsupported is not None:
                self._on_unsupported(inbound)
            else:
                logger.warning("plan_path received but not supported in this blueprint")
        elif isinstance(inbound, CancelGoalMessage):
            if self._on_cancel_goal is not None:
                self._on_cancel_goal(inbound)
            elif self._on_unsupported is not None:
                self._on_unsupported(inbound)
            else:
                logger.warning("cancel_goal received but not supported in this blueprint")
        elif isinstance(inbound, EmergencyStopMessage):
            if self._on_emergency_stop is not None:
                self._on_emergency_stop(inbound)
            elif self._on_unsupported is not None:
                self._on_unsupported(inbound)
            else:
                logger.warning(
                    "emergency_stop received but not supported in this blueprint"
                )
        elif isinstance(inbound, GetStatusMessage):
            if self._on_get_status is not None:
                self._on_get_status(inbound, websocket)

    def schedule_send(self, text: str) -> None:
        """Schedule a send on the WS event loop from any thread."""
        if self._loop is None or self._loop.is_closed():
            return
        asyncio.run_coroutine_threadsafe(self._enqueue_all(text), self._loop)

    def schedule_send_to(self, websocket: ServerConnection, text: str) -> None:
        if self._loop is None or self._loop.is_closed():
            return
        asyncio.run_coroutine_threadsafe(self._enqueue_one(websocket, text), self._loop)

    async def _enqueue_all(self, text: str) -> None:
        if not self._outbound:
            return
        for outbound in list(self._outbound.values()):
            outbound.enqueue(text)

    async def _enqueue_one(self, websocket: ServerConnection, text: str) -> None:
        outbound = self._outbound.get(websocket)
        if outbound is not None:
            outbound.enqueue(text)

    def stop(self) -> None:
        if self._loop is not None and not self._loop.is_closed():
            if self._stop_future is not None and not self._stop_future.done():

                def _set_stop() -> None:
                    if self._stop_future is not None and not self._stop_future.done():
                        self._stop_future.set_result(None)

                self._loop.call_soon_threadsafe(_set_stop)
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=DEFAULT_THREAD_JOIN_TIMEOUT)
        self._thread = None
        self._loop = None
        self._server = None
        self._stop_future = None
        self._connections.clear()
        self._outbound.clear()
        self._ready.clear()
        logger.info("XR WebSocket server stopped")
