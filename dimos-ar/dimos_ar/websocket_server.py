"""Daemon-thread WebSocket server for AR clients."""

from __future__ import annotations

import asyncio
import logging
import threading
from collections.abc import Callable

import websockets
from dimos.constants import DEFAULT_THREAD_JOIN_TIMEOUT
from dimos.core.global_config import global_config
from dimos.utils.logging_config import setup_logger
from websockets.asyncio.server import Server, ServerConnection, serve

from dimos_ar.protocol import (
    AlignCommitMessage,
    AlignManualPoseMessage,
    AlignMarkerMessage,
    AlignStartMessage,
    AlignStopMessage,
    CancelGoalMessage,
    EmergencyStopMessage,
    GetStatusMessage,
    InboundMessage,
    NavGoalMessage,
    RegisterMessage,
    decode_inbound,
    encode_hello,
)

logger = setup_logger()

# Port probes / non-WebSocket clients (e.g. nc, browser) close immediately; avoid stack traces.
logging.getLogger("websockets").setLevel(logging.WARNING)

RegisterHandler = Callable[[RegisterMessage, ServerConnection], None]
AlignStartHandler = Callable[[AlignStartMessage, ServerConnection], None]
AlignStopHandler = Callable[[AlignStopMessage, ServerConnection], None]
AlignCommitHandler = Callable[[AlignCommitMessage, ServerConnection], None]
AlignMarkerHandler = Callable[[AlignMarkerMessage, ServerConnection], None]
AlignManualPoseHandler = Callable[[AlignManualPoseMessage, ServerConnection], None]
NavGoalHandler = Callable[[NavGoalMessage], None]
CancelGoalHandler = Callable[[CancelGoalMessage], None]
EmergencyStopHandler = Callable[[EmergencyStopMessage], None]
GetStatusHandler = Callable[[GetStatusMessage, ServerConnection], None]
UnsupportedHandler = Callable[[InboundMessage], None]
StatusOnConnectHandler = Callable[[ServerConnection], None]
DisconnectHandler = Callable[[ServerConnection], None]

STARTUP_TIMEOUT_S = 10.0


class ARWebSocketServer:
    def __init__(
        self,
        *,
        port: int,
        capabilities: list[str],
        robot_id: str,
        max_message_bytes: int,
        on_register: RegisterHandler,
        on_align_start: AlignStartHandler | None = None,
        on_align_stop: AlignStopHandler | None = None,
        on_align_commit: AlignCommitHandler | None = None,
        on_align_marker: AlignMarkerHandler | None = None,
        on_align_manual_pose: AlignManualPoseHandler | None = None,
        on_nav_goal: NavGoalHandler | None = None,
        on_cancel_goal: CancelGoalHandler | None = None,
        on_emergency_stop: EmergencyStopHandler | None = None,
        on_get_status: GetStatusHandler | None = None,
        on_unsupported: UnsupportedHandler | None = None,
        on_status_connect: StatusOnConnectHandler | None = None,
        on_disconnect: DisconnectHandler | None = None,
    ) -> None:
        self._port = port
        self._capabilities = capabilities
        self._robot_id = robot_id
        self._max_message_bytes = max_message_bytes
        self._on_register = on_register
        self._on_align_start = on_align_start
        self._on_align_stop = on_align_stop
        self._on_align_commit = on_align_commit
        self._on_align_marker = on_align_marker
        self._on_align_manual_pose = on_align_manual_pose
        self._on_nav_goal = on_nav_goal
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
            self._loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self._loop)
            try:
                self._loop.run_until_complete(self._run_server())
            except BaseException as exc:
                self._startup_error = exc
                self._ready.set()
                raise
            finally:
                self._loop.close()

        self._thread = threading.Thread(target=run_loop, daemon=True, name="ar-ws")
        self._thread.start()

        host = global_config.listen_host
        logger.info("AR WebSocket server starting", host=host, port=self._port)

        if not self._ready.wait(timeout=STARTUP_TIMEOUT_S):
            raise TimeoutError(
                f"AR WebSocket server did not start within {STARTUP_TIMEOUT_S}s",
            )
        if self._startup_error is not None:
            raise RuntimeError("AR WebSocket server failed to start") from self._startup_error

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
                logger.info("AR WebSocket server listening", host=host, port=self._port)
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
        try:
            await websocket.send(
                encode_hello(self._capabilities, robot_id=self._robot_id),
            )
            if self._on_status_connect is not None:
                self._on_status_connect(websocket)
            async for message in websocket:
                try:
                    if not isinstance(message, str):
                        raise ValueError("Only JSON text frames are supported")
                    inbound = decode_inbound(message, expected_robot_id=self._robot_id)
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
            self._connections.discard(websocket)
            if self._on_disconnect is not None:
                self._on_disconnect(websocket)

    def _dispatch_inbound(self, inbound: InboundMessage, websocket: ServerConnection) -> None:
        if isinstance(inbound, RegisterMessage):
            self._on_register(inbound, websocket)
        elif isinstance(inbound, AlignStartMessage):
            if self._on_align_start is not None:
                self._on_align_start(inbound, websocket)
        elif isinstance(inbound, AlignStopMessage):
            if self._on_align_stop is not None:
                self._on_align_stop(inbound, websocket)
        elif isinstance(inbound, AlignCommitMessage):
            if self._on_align_commit is not None:
                self._on_align_commit(inbound, websocket)
        elif isinstance(inbound, AlignMarkerMessage):
            if self._on_align_marker is not None:
                self._on_align_marker(inbound, websocket)
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
        asyncio.run_coroutine_threadsafe(self._send_all(text), self._loop)

    def schedule_send_to(self, websocket: ServerConnection, text: str) -> None:
        if self._loop is None or self._loop.is_closed():
            return
        asyncio.run_coroutine_threadsafe(self._send_one(websocket, text), self._loop)

    async def _send_all(self, text: str) -> None:
        if not self._connections:
            return
        await asyncio.gather(
            *[self._send_one(ws, text) for ws in list(self._connections)],
            return_exceptions=True,
        )

    async def _send_one(self, websocket: ServerConnection, text: str) -> None:
        try:
            await websocket.send(text)
        except websockets.ConnectionClosed:
            self._connections.discard(websocket)

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
        self._ready.clear()
        logger.info("AR WebSocket server stopped")
