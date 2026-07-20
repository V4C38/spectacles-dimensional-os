"""AR WebSocket server — mirrors RerunWebSocketServer lifecycle."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from concurrent.futures import Future
import logging
import os
import threading
import time
from typing import Any, cast

import websockets
import websockets.asyncio.server as ws_server

from dimos.ar.network.inbound_dispatch import InboundDispatcher
from dimos.ar.network.protocol import (
    ArSkillResultMessage,
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
    UserCommandMessage,
    decode_inbound,
    encode_hello,
    encode_pong,
)
from dimos.ar.network.ws_send_queue import ClientSendQueue, peek_message_type
from dimos.ar.tag_tracking.solve import parse_camera_frame
from dimos.ar.utils.console import console_divider
from dimos.core.global_config import global_config
from dimos.utils.logging_config import setup_logger

logger = setup_logger()

RegistrationCommandHandler = Callable[
    [RegistrationCommandMessage, "ws_server.ServerConnection"], None
]
CameraInfoHandler = Callable[[CameraInfoMessage, "ws_server.ServerConnection"], None]
CameraFrameHandler = Callable[
    [dict[str, Any], bytes, "ws_server.ServerConnection"], Awaitable[None]
]
RegistrationPoseHandler = Callable[[RegistrationPoseMessage, "ws_server.ServerConnection"], None]
NavGoalHandler = Callable[[NavGoalMessage], None]
CancelNavGoalHandler = Callable[[CancelNavGoalMessage], None]
EmergencyStopHandler = Callable[[EmergencyStopMessage], None]
JoystickCommandHandler = Callable[[JoystickCommandMessage], None]
GetStatusHandler = Callable[[GetStatusMessage, "ws_server.ServerConnection"], None]
SetLidarModeHandler = Callable[[SetLidarModeMessage, "ws_server.ServerConnection"], None]
UserCommandHandler = Callable[[UserCommandMessage], None]
ArSkillResultHandler = Callable[[ArSkillResultMessage], None]
UnsupportedHandler = Callable[[InboundMessage], None]
StatusOnConnectHandler = Callable[["ws_server.ServerConnection"], None]
DisconnectHandler = Callable[["ws_server.ServerConnection"], None]
HelloSupplier = Callable[[], Any]

InboundHandler = Callable[[InboundMessage, "ws_server.ServerConnection"], None]

INBOUND_TEXT_LOG_INTERVAL_S = 1.0
CAMERA_FRAME_LOG_INTERVAL_S = 2.0
_THROTTLED_INBOUND_TYPES = frozenset({"registration_pose", "nav_goal"})
PING_INTERVAL_S = 30
PING_TIMEOUT_S = 30

_TRACE = os.getenv("DIMOS_AR_TRACE", "") not in ("", "0", "false")
_TRACE_ONLY_INBOUND_TYPES = frozenset({"get_status", "ping"})


def _handshake_noise_filter(record: logging.LogRecord) -> bool:
    """Drop noisy handshake-failed records from port scanners and non-WS clients."""
    msg = record.getMessage()
    return not ("opening handshake failed" in msg or "did not receive a valid HTTP request" in msg)


def split_inbound_text_lines(message: str) -> list[str]:
    """Split a WebSocket text frame into non-empty JSON lines."""
    return [line for line in message.split("\n") if line.strip()]


class ARWebSocketServer:
    """WebSocket server running on the Module's asyncio loop."""

    def __init__(
        self,
        *,
        port: int,
        hello_supplier: HelloSupplier,
        max_message_bytes: int,
        loop: asyncio.AbstractEventLoop,
        on_registration_command: RegistrationCommandHandler | None = None,
        on_camera_info: CameraInfoHandler | None = None,
        on_camera_frame: CameraFrameHandler | None = None,
        on_registration_pose: RegistrationPoseHandler | None = None,
        on_nav_goal: NavGoalHandler | None = None,
        on_cancel_nav_goal: CancelNavGoalHandler | None = None,
        on_joystick_command: JoystickCommandHandler | None = None,
        on_emergency_stop: EmergencyStopHandler | None = None,
        on_get_status: GetStatusHandler | None = None,
        on_set_lidar_mode: SetLidarModeHandler | None = None,
        on_user_command: UserCommandHandler | None = None,
        on_ar_skill_result: ArSkillResultHandler | None = None,
        on_unsupported: UnsupportedHandler | None = None,
        on_status_connect: StatusOnConnectHandler | None = None,
        on_disconnect: DisconnectHandler | None = None,
    ) -> None:
        self._port = port
        self._hello_supplier = hello_supplier
        self._max_message_bytes = max_message_bytes
        self._loop = loop
        self._on_camera_frame = on_camera_frame
        self._on_unsupported = on_unsupported
        self._on_status_connect = on_status_connect
        self._on_disconnect = on_disconnect
        self._inbound_handlers = self._build_inbound_handlers(
            on_registration_command=on_registration_command,
            on_camera_info=on_camera_info,
            on_registration_pose=on_registration_pose,
            on_nav_goal=on_nav_goal,
            on_cancel_nav_goal=on_cancel_nav_goal,
            on_joystick_command=on_joystick_command,
            on_emergency_stop=on_emergency_stop,
            on_get_status=on_get_status,
            on_set_lidar_mode=on_set_lidar_mode,
            on_user_command=on_user_command,
            on_ar_skill_result=on_ar_skill_result,
            on_unsupported=on_unsupported,
        )

        self._stop_event: asyncio.Event | None = None
        self._server_ready = threading.Event()
        self.client_connected = threading.Event()
        self._connections: set[ws_server.ServerConnection] = set()
        self._outbound: dict[ws_server.ServerConnection, ClientSendQueue] = {}
        self._inbound_dispatcher = InboundDispatcher(loop=loop)
        self._serve_future: Future[None] | None = None

    def _build_inbound_handlers(
        self,
        *,
        on_registration_command: RegistrationCommandHandler | None,
        on_camera_info: CameraInfoHandler | None,
        on_registration_pose: RegistrationPoseHandler | None,
        on_nav_goal: NavGoalHandler | None,
        on_cancel_nav_goal: CancelNavGoalHandler | None,
        on_joystick_command: JoystickCommandHandler | None,
        on_emergency_stop: EmergencyStopHandler | None,
        on_get_status: GetStatusHandler | None,
        on_set_lidar_mode: SetLidarModeHandler | None,
        on_user_command: UserCommandHandler | None,
        on_ar_skill_result: ArSkillResultHandler | None,
        on_unsupported: UnsupportedHandler | None,
    ) -> dict[type[InboundMessage], InboundHandler]:
        handlers: dict[type[InboundMessage], InboundHandler] = {}

        if on_registration_command is not None:
            handlers[RegistrationCommandMessage] = cast(
                "InboundHandler", on_registration_command
            )
        if on_camera_info is not None:
            handlers[CameraInfoMessage] = cast("InboundHandler", on_camera_info)
        if on_registration_pose is not None:
            handlers[RegistrationPoseMessage] = cast("InboundHandler", on_registration_pose)
        if on_get_status is not None:
            handlers[GetStatusMessage] = cast("InboundHandler", on_get_status)
        if on_set_lidar_mode is not None:
            handlers[SetLidarModeMessage] = cast("InboundHandler", on_set_lidar_mode)

        def _simple_handler(
            handler: Callable[[Any], None] | None,
            label: str,
        ) -> InboundHandler:
            if handler is not None:
                return lambda inbound, _ws: handler(inbound)
            if on_unsupported is not None:
                return lambda inbound, _ws: on_unsupported(inbound)
            return lambda _inbound, _ws: logger.warning(
                f"{label} received but not supported in this blueprint"
            )

        handlers[NavGoalMessage] = _simple_handler(on_nav_goal, "nav_goal")
        handlers[CancelNavGoalMessage] = _simple_handler(on_cancel_nav_goal, "cancel_nav_goal")
        handlers[JoystickCommandMessage] = _simple_handler(on_joystick_command, "joystick_command")
        handlers[EmergencyStopMessage] = _simple_handler(on_emergency_stop, "emergency_stop")
        handlers[UserCommandMessage] = _simple_handler(on_user_command, "user_command")
        handlers[ArSkillResultMessage] = _simple_handler(on_ar_skill_result, "ar_skill_result")

        return handlers

    @property
    def port(self) -> int:
        return self._port

    def start(self) -> None:
        self._serve_future = asyncio.run_coroutine_threadsafe(self._serve(), self._loop)
        self._server_ready.wait()

    def stop(self) -> None:
        if not self._server_ready.is_set():
            return
        if self._stop_event is not None:
            self._loop.call_soon_threadsafe(self._stop_event.set)
        if not self._is_on_loop():
            future = self._serve_future
            if future is not None:
                try:
                    future.result(timeout=2.0)
                except Exception as exc:
                    logger.warning("AR WebSocket server stop did not finish cleanly", error=str(exc))
        self._server_ready.clear()
        self.client_connected.clear()
        self._serve_future = None

    def _is_on_loop(self) -> bool:
        try:
            return asyncio.get_running_loop() is self._loop
        except RuntimeError:
            return False

    async def _serve(self) -> None:
        self._stop_event = asyncio.Event()

        ws_logger = logging.getLogger("websockets.server")
        ws_logger.addFilter(_handshake_noise_filter)

        host = global_config.listen_host
        self._inbound_dispatcher.start()
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
                logger.info("AR WebSocket server listening", host=host, port=self._port)
                if host in ("127.0.0.1", "localhost"):
                    logger.warning(
                        "WebSocket is localhost-only; Spectacles cannot connect. "
                        "Restart without --local (default binds 0.0.0.0).",
                    )
                self._server_ready.set()
                await self._stop_event.wait()
        except Exception as exc:
            logger.exception("AR WebSocket server crashed", error=str(exc))
            if not self._server_ready.is_set():
                self._server_ready.set()
            raise
        finally:
            await self._inbound_dispatcher.stop()

    async def _handler(self, websocket: ws_server.ServerConnection) -> None:
        req = getattr(websocket, "request", None)
        if req is not None and req.path not in ("/", "/ws"):
            await websocket.close(1008, "Not Found")
            return
        remote = getattr(websocket, "remote_address", None)
        remote_ip = remote[0] if remote else None
        if remote_ip is not None:
            for existing in list(self._connections):
                existing_remote = getattr(existing, "remote_address", None)
                if existing_remote and existing_remote[0] == remote_ip:
                    logger.info(
                        "AR client reconnect from same remote; closing prior connection",
                        remote=str(remote),
                    )
                    await existing.close(1000, "superseded by new connection")
        self._connections.add(websocket)
        outbound = ClientSendQueue(websocket)
        self._outbound[websocket] = outbound
        outbound.start()
        logger.info("AR client connected", remote=str(remote))
        console_divider(f"AR client connected remote={remote}")
        try:
            hello = await asyncio.to_thread(self._hello_supplier)
            await websocket.send(encode_hello(hello) + "\n")
            if self._on_status_connect is not None:
                await asyncio.to_thread(self._on_status_connect, websocket)
            self.client_connected.set()
            _last_inbound_text_log: dict[str, float] = {}
            _last_camera_frame_log = 0.0
            async for message in websocket:
                try:
                    if isinstance(message, bytes):
                        if _TRACE:
                            logger.debug(
                                "AR inbound binary frame",
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
                        now_mono = time.monotonic()
                        if now_mono - _last_camera_frame_log >= CAMERA_FRAME_LOG_INTERVAL_S:
                            _last_camera_frame_log = now_mono
                            logger.info(
                                "AR camera frame received",
                                seq=int(header.get("seq", -1)),
                                jpeg_bytes=len(jpeg),
                            )
                        try:
                            await self._on_camera_frame(header, jpeg, websocket)
                        except Exception as exc:
                            logger.exception(
                                "AR camera frame handler error",
                                seq=int(header.get("seq", -1)),
                                error=str(exc),
                            )
                        continue
                    if not isinstance(message, str):
                        raise ValueError("Unsupported WebSocket frame type")
                    for line in split_inbound_text_lines(message):
                        msg_type = peek_message_type(line)
                        now_mono = time.monotonic()
                        _should_log = (
                            msg_type not in _THROTTLED_INBOUND_TYPES
                            and msg_type not in _TRACE_ONLY_INBOUND_TYPES
                        ) or (
                            msg_type in _THROTTLED_INBOUND_TYPES
                            and now_mono - _last_inbound_text_log.get(msg_type, 0.0)
                            >= INBOUND_TEXT_LOG_INTERVAL_S
                        ) or (msg_type in _TRACE_ONLY_INBOUND_TYPES and _TRACE)
                        if _should_log:
                            if msg_type is not None:
                                _last_inbound_text_log[msg_type] = now_mono
                            logger.info("AR inbound text message", type=msg_type)
                        inbound = decode_inbound(line, expected_robot_id=hello.robot_id)
                        await self._dispatch_inbound(inbound, websocket)
                except ValueError as exc:
                    logger.warning(
                        "Invalid inbound WebSocket message",
                        error=str(exc),
                        type=peek_message_type(message) if isinstance(message, str) else None,
                    )
                except Exception as exc:
                    logger.exception(
                        "Unhandled inbound WebSocket handler error",
                        error=str(exc),
                    )
        except websockets.ConnectionClosed as exc:
            logger.info(
                "AR client disconnected",
                remote=str(remote),
                code=exc.rcvd.code if exc.rcvd is not None else None,
                reason=exc.rcvd.reason if exc.rcvd is not None else None,
            )
            code = exc.rcvd.code if exc.rcvd is not None else None
            console_divider(f"AR client disconnected remote={remote} code={code}")
        finally:
            await outbound.stop()
            self._outbound.pop(websocket, None)
            self._connections.discard(websocket)
            if self._on_disconnect is not None:
                self._on_disconnect(websocket)

    async def _dispatch_inbound(
        self, inbound: InboundMessage, websocket: ws_server.ServerConnection
    ) -> None:
        if isinstance(inbound, PingMessage):
            self._inbound_dispatcher.submit(inbound, websocket, self._send_pong)
            return
        handler = self._inbound_handlers.get(type(inbound))
        self._inbound_dispatcher.submit(inbound, websocket, handler)

    async def _send_pong(
        self, inbound: InboundMessage, websocket: ws_server.ServerConnection
    ) -> None:
        if not isinstance(inbound, PingMessage):
            return
        await websocket.send(
            encode_pong(
                robot_id=inbound.robot_id,
                client_ts=inbound.client_ts,
                bridge_ts=time.time(),
            )
            + "\n"
        )

    def schedule_send(self, text: str) -> None:
        asyncio.run_coroutine_threadsafe(self._enqueue_all(text), self._loop)

    def schedule_send_binary(self, data: bytes) -> None:
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

    @property
    def connection_count(self) -> int:
        return len(self._connections)
