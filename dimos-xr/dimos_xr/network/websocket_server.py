"""XR WebSocket server — mirrors RerunWebSocketServer lifecycle.

Lifecycle runs on the Module's own asyncio loop (self._loop) via
asyncio.run_coroutine_threadsafe. Stop is signalled via loop.call_soon_threadsafe.
Liveness relies solely on WebSocket protocol-level ping/pong — there is no
application-level heartbeat in the XR bridge protocol.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
import logging
import os
import re
import threading
import time
from typing import Any

from dimos.core.global_config import global_config
from dimos.utils.logging_config import setup_logger
import websockets
import websockets.asyncio.server as ws_server

from dimos_xr.network.protocol import (
    AlignCommitMessage,
    AlignManualPoseMessage,
    AlignStartMessage,
    AlignStopMessage,
    AssistConfirmMessage,
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
from dimos_xr.tracking.tag_tracker import parse_camera_frame

logger = setup_logger()

AlignStartHandler = Callable[[AlignStartMessage, "ws_server.ServerConnection"], None]
AlignStopHandler = Callable[[AlignStopMessage, "ws_server.ServerConnection"], None]
AlignCommitHandler = Callable[[AlignCommitMessage, "ws_server.ServerConnection"], None]
AssistConfirmHandler = Callable[[AssistConfirmMessage, "ws_server.ServerConnection"], None]
CameraInfoHandler = Callable[[CameraInfoMessage, "ws_server.ServerConnection"], None]
CameraFrameHandler = Callable[
    [dict[str, Any], bytes, "ws_server.ServerConnection"], Awaitable[None]
]
AlignManualPoseHandler = Callable[[AlignManualPoseMessage, "ws_server.ServerConnection"], None]
NavGoalHandler = Callable[[NavGoalMessage], None]
PlanPathHandler = Callable[[PlanPathMessage], None]
CancelGoalHandler = Callable[[CancelGoalMessage], None]
EmergencyStopHandler = Callable[[EmergencyStopMessage], None]
GetStatusHandler = Callable[[GetStatusMessage, "ws_server.ServerConnection"], None]
UnsupportedHandler = Callable[[InboundMessage], None]
StatusOnConnectHandler = Callable[["ws_server.ServerConnection"], None]
DisconnectHandler = Callable[["ws_server.ServerConnection"], None]
HelloSupplier = Callable[[], Any]

OUTBOUND_FIFO_MAXSIZE = 64
OUTBOUND_BACKLOG_LOG_INTERVAL_S = 5.0
# High-frequency inbound message types that need throttled RX logging (~3 Hz).
INBOUND_TEXT_LOG_INTERVAL_S = 1.0
_THROTTLED_INBOUND_TYPES = frozenset({"align_manual_pose", "get_status"})
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
_ALIGN_STATUS_STATE_RE = re.compile(r'"state"\s*:\s*"([^"]+)"')
# Terminal align_status states that must never be silently overwritten by a
# later coalesced message.  If one of these is already pending in the coalesce
# slot, only another terminal state is allowed to replace it.
_ALIGN_STATUS_TERMINAL_STATES = frozenset({"aligned", "failed"})
PING_INTERVAL_S = 30
PING_TIMEOUT_S = 30

# Gate per-frame / per-message firehose logs. Set DIMOS_XR_TRACE=1 to enable.
_TRACE = os.getenv("DIMOS_XR_TRACE", "") not in ("", "0", "false")
# Inbound message types logged only under trace (too frequent for normal DEBUG).
_TRACE_ONLY_INBOUND_TYPES = frozenset({"get_status"})


def _handshake_noise_filter(record: logging.LogRecord) -> bool:
    """Drop noisy handshake-failed records from port scanners and non-WS clients."""
    msg = record.getMessage()
    return not ("opening handshake failed" in msg or "did not receive a valid HTTP request" in msg)


def _peek_message_type(text: str) -> str | None:
    match = _MESSAGE_TYPE_RE.search(text)
    return match.group(1) if match else None



class _ConnectionOutbound:
    """Per-connection sender with latest-wins coalescing and bounded FIFO."""

    def __init__(self, websocket: ws_server.ServerConnection) -> None:
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
            # Terminal align_status (aligned/failed) must not be overwritten by a
            # non-terminal one.  Check the pending slot before clobbering it.
            if msg_type == "align_status":
                pending = self._coalesce_latest.get("align_status")
                if pending is not None:
                    pending_state_match = _ALIGN_STATUS_STATE_RE.search(pending)
                    if pending_state_match and pending_state_match.group(1) in _ALIGN_STATUS_TERMINAL_STATES:
                        new_state_match = _ALIGN_STATUS_STATE_RE.search(text)
                        new_state = new_state_match.group(1) if new_state_match else ""
                        if new_state not in _ALIGN_STATUS_TERMINAL_STATES:
                            # Incoming non-terminal must not overwrite a pending terminal.
                            self._work_available.set()
                            return
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
            logger.exception("XR WebSocket outbound sender crashed", error=str(exc))

    async def _flush_one_coalesced(self) -> None:
        if not self._coalesce_latest:
            return
        msg_type = next(iter(self._coalesce_latest))
        text = self._coalesce_latest.pop(msg_type)
        await self._send(text)

    async def _flush_coalesced_batch(self) -> None:
        while self._coalesce_latest and not self._closed:
            await self._flush_one_coalesced()

    async def _send(self, text: str) -> None:
        import time

        try:
            await self._websocket.send(text)
            self._sent_count += 1
            msg_type = _peek_message_type(text)
            if _TRACE and msg_type == "align_status":
                logger.debug("XR WebSocket outbound align_status sent", bytes=len(text))
            now = time.monotonic()
            if now - self._last_backlog_log_mono >= OUTBOUND_BACKLOG_LOG_INTERVAL_S:
                fifo_depth = self._queue.qsize()
                coalesce_depth = len(self._coalesce_latest)
                if fifo_depth > 0 or coalesce_depth > 0 or self._dropped_fifo_count > 0:
                    self._last_backlog_log_mono = now
                    logger.info(
                        "XR WebSocket outbound backlog",
                        fifo_depth=fifo_depth,
                        coalesce_pending=coalesce_depth,
                        dropped_fifo=self._dropped_fifo_count,
                    )
        except websockets.ConnectionClosed:
            self._closed = True
        except (OSError, websockets.WebSocketException) as exc:
            msg_type = _peek_message_type(text)
            logger.warning(
                "XR WebSocket outbound send failed",
                error=str(exc),
                message_type=msg_type,
            )


class XRWebSocketServer:
    """WebSocket server running on the Module's asyncio loop.

    Lifecycle adopts the RerunWebSocketServer pattern: start() schedules
    _serve() on self._loop via asyncio.run_coroutine_threadsafe; stop() signals
    via loop.call_soon_threadsafe. The module must call start() after assigning
    loop and stop() before its loop closes.
    """

    def __init__(
        self,
        *,
        port: int,
        hello_supplier: HelloSupplier,
        max_message_bytes: int,
        loop: asyncio.AbstractEventLoop,
        on_align_start: AlignStartHandler | None = None,
        on_align_stop: AlignStopHandler | None = None,
        on_align_commit: AlignCommitHandler | None = None,
        on_assist_confirm: AssistConfirmHandler | None = None,
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
        self._loop = loop
        self._on_align_start = on_align_start
        self._on_align_stop = on_align_stop
        self._on_align_commit = on_align_commit
        self._on_assist_confirm = on_assist_confirm
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

        self._stop_event: asyncio.Event | None = None
        self._server_ready = threading.Event()
        self.client_connected = threading.Event()
        self._connections: set[ws_server.ServerConnection] = set()
        self._outbound: dict[ws_server.ServerConnection, _ConnectionOutbound] = {}

    @property
    def port(self) -> int:
        return self._port

    def start(self) -> None:
        """Schedule _serve() on the Module loop; block until server is accepting."""
        asyncio.run_coroutine_threadsafe(self._serve(), self._loop)
        self._server_ready.wait()

    def stop(self) -> None:
        """Signal _serve() to exit from any thread."""
        if not self._server_ready.is_set():
            return
        if self._stop_event is not None:
            self._loop.call_soon_threadsafe(self._stop_event.set)
        self._server_ready.clear()
        self.client_connected.clear()

    async def _serve(self) -> None:
        self._stop_event = asyncio.Event()

        ws_logger = logging.getLogger("websockets.server")
        ws_logger.addFilter(_handshake_noise_filter)

        host = global_config.listen_host
        try:
            async with ws_server.serve(
                self._handler,
                host,
                self._port,
                ping_interval=PING_INTERVAL_S,
                ping_timeout=PING_TIMEOUT_S,
                max_size=self._max_message_bytes,
                logger=ws_logger,
            ):
                logger.info("XR WebSocket server listening", host=host, port=self._port)
                if host in ("127.0.0.1", "localhost"):
                    logger.warning(
                        "WebSocket is localhost-only; Spectacles cannot connect. "
                        "Restart without --local (default binds 0.0.0.0).",
                    )
                self._server_ready.set()
                await self._stop_event.wait()
        except Exception as exc:
            logger.exception("XR WebSocket server crashed", error=str(exc))
            if not self._server_ready.is_set():
                self._server_ready.set()
            raise

    async def _handler(self, websocket: ws_server.ServerConnection) -> None:
        req = getattr(websocket, "request", None)
        if req is not None and req.path not in ("/", "/ws"):
            await websocket.close(1008, "Not Found")
            return
        self._connections.add(websocket)
        outbound = _ConnectionOutbound(websocket)
        self._outbound[websocket] = outbound
        outbound.start()
        remote = getattr(websocket, "remote_address", None)
        logger.info("XR client connected", remote=str(remote))
        try:
            hello = self._hello_supplier()
            await websocket.send(encode_hello(hello))
            if self._on_status_connect is not None:
                self._on_status_connect(websocket)
            self.client_connected.set()
            _last_inbound_text_log: dict[str, float] = {}
            async for message in websocket:
                try:
                    if isinstance(message, bytes):
                        if _TRACE:
                            logger.debug(
                                "XR inbound binary frame",
                                bytes=len(message),
                            )
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
                    msg_type = _peek_message_type(message)
                    now_mono = time.monotonic()
                    _should_log = (
                        msg_type not in _THROTTLED_INBOUND_TYPES
                        and (not _TRACE_ONLY_INBOUND_TYPES or msg_type not in _TRACE_ONLY_INBOUND_TYPES)
                    ) or (
                        msg_type in _THROTTLED_INBOUND_TYPES
                        and now_mono - _last_inbound_text_log.get(msg_type, 0.0) >= INBOUND_TEXT_LOG_INTERVAL_S
                    ) or (
                        msg_type in _TRACE_ONLY_INBOUND_TYPES and _TRACE
                    )
                    if _should_log:
                        if msg_type is not None:
                            _last_inbound_text_log[msg_type] = now_mono
                        logger.info("XR inbound text message", type=msg_type)
                    inbound = decode_inbound(message, expected_robot_id=hello.robot_id)
                    self._dispatch_inbound(inbound, websocket)
                except ValueError as exc:
                    logger.warning("Invalid inbound WebSocket message", error=str(exc))
                except Exception as exc:
                    logger.exception(
                        "Unhandled inbound WebSocket handler error",
                        error=str(exc),
                    )
        except websockets.ConnectionClosed as exc:
            logger.info(
                "XR client disconnected",
                remote=str(remote),
                code=exc.rcvd.code if exc.rcvd is not None else None,
                reason=exc.rcvd.reason if exc.rcvd is not None else None,
            )
        finally:
            await outbound.stop()
            self._outbound.pop(websocket, None)
            self._connections.discard(websocket)
            if self._on_disconnect is not None:
                self._on_disconnect(websocket)

    def _dispatch_inbound(
        self, inbound: InboundMessage, websocket: ws_server.ServerConnection
    ) -> None:
        if isinstance(inbound, AlignStartMessage):
            if self._on_align_start is not None:
                self._on_align_start(inbound, websocket)
        elif isinstance(inbound, AlignStopMessage):
            if self._on_align_stop is not None:
                self._on_align_stop(inbound, websocket)
        elif isinstance(inbound, AlignCommitMessage):
            if self._on_align_commit is not None:
                self._on_align_commit(inbound, websocket)
        elif isinstance(inbound, AssistConfirmMessage):
            if self._on_assist_confirm is not None:
                self._on_assist_confirm(inbound, websocket)
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
                logger.warning("emergency_stop received but not supported in this blueprint")
        elif isinstance(inbound, GetStatusMessage):
            if self._on_get_status is not None:
                self._on_get_status(inbound, websocket)

    def schedule_send(self, text: str) -> None:
        """Enqueue a broadcast from any thread onto the server loop."""
        asyncio.run_coroutine_threadsafe(self._enqueue_all(text), self._loop)

    def schedule_send_binary(self, data: bytes) -> None:
        """Broadcast a raw binary WebSocket frame to all connected clients."""
        asyncio.run_coroutine_threadsafe(self._broadcast_binary(data), self._loop)

    def schedule_send_to(self, websocket: ws_server.ServerConnection, text: str) -> None:
        asyncio.run_coroutine_threadsafe(self._enqueue_one(websocket, text), self._loop)

    async def _enqueue_all(self, text: str) -> None:
        for outbound in list(self._outbound.values()):
            outbound.enqueue(text)

    async def _broadcast_binary(self, data: bytes) -> None:
        for websocket in list(self._outbound.keys()):
            try:
                await websocket.send(data)
            except Exception:
                pass

    async def _enqueue_one(self, websocket: ws_server.ServerConnection, text: str) -> None:
        outbound = self._outbound.get(websocket)
        if outbound is not None:
            outbound.enqueue(text)
