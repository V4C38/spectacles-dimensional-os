"""WebSocket server — runs on ARModule's asyncio loop."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
import logging
import secrets
import struct
import threading
import time
from typing import TYPE_CHECKING

import websockets
import websockets.asyncio.server as ws_server

from dimos.ar.websocket.protocol import (
    LOCALIZATION_REQUEST_FOURCC,
    EstopRequest,
    Hello,
    HelloBody,
    Inbound,
    LidarSettings,
    LocalizeObservation,
    NavGoalRequest,
    StateRequest,
    TimeSync,
    decode_hello_request,
    decode_inbound,
    decode_localization_request,
    encode_hello,
)
from dimos.ar.websocket.send_queue import ClientSendQueue
from dimos.core.global_config import global_config
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from concurrent.futures import Future

logger = setup_logger()

HelloSupplier = Callable[[str], HelloBody]
ConnectHandler = Callable[[ws_server.ServerConnection, str], None]
NavGoalRequestHandler = Callable[[NavGoalRequest, ws_server.ServerConnection, str], None]
EstopRequestHandler = Callable[[EstopRequest, ws_server.ServerConnection], None]
LidarSettingsRequestHandler = Callable[[LidarSettings, ws_server.ServerConnection], None]
StateRequestHandler = Callable[[StateRequest, ws_server.ServerConnection], None]
LocalizationRequestHandler = Callable[
    [tuple[LocalizeObservation, ...], ws_server.ServerConnection, TimeSync],
    Awaitable[None] | None,
]
DisconnectHandler = Callable[[ws_server.ServerConnection], None]

PING_INTERVAL_S = 30.0
PING_TIMEOUT_S = 30.0
DEFAULT_MAX_FRAME_BYTES = 4_194_304


def _handshake_noise_filter(record: logging.LogRecord) -> bool:
    msg = record.getMessage()
    return not ("opening handshake failed" in msg or "did not receive a valid HTTP request" in msg)


def split_inbound_text_lines(message: str) -> list[str]:
    return [line for line in message.split("\n") if line.strip()]


def _new_client_id() -> str:
    return secrets.token_hex(3)


class WebSocketServer:
    """Accepts AR client connections and dispatches inbound protocol frames."""

    def __init__(
        self,
        *,
        port: int,
        loop: asyncio.AbstractEventLoop,
        hello_supplier: HelloSupplier,
        max_frame_bytes: int = DEFAULT_MAX_FRAME_BYTES,
        on_connect: ConnectHandler | None = None,
        on_nav_goal_request: NavGoalRequestHandler | None = None,
        on_estop_request: EstopRequestHandler | None = None,
        on_lidar_settings_request: LidarSettingsRequestHandler | None = None,
        on_state_request: StateRequestHandler | None = None,
        on_localization_request: LocalizationRequestHandler | None = None,
        on_disconnect: DisconnectHandler | None = None,
    ) -> None:
        self._port = port
        self._loop = loop
        self._hello_supplier = hello_supplier
        self._max_frame_bytes = max_frame_bytes
        self._on_connect = on_connect
        self._on_nav_goal_request = on_nav_goal_request
        self._on_estop_request = on_estop_request
        self._on_lidar_settings_request = on_lidar_settings_request
        self._on_state_request = on_state_request
        self._on_localization_request = on_localization_request
        self._on_disconnect = on_disconnect

        self._stop_event: asyncio.Event | None = None
        self._server_ready = threading.Event()
        self._connections: set[ws_server.ServerConnection] = set()
        self._outbound: dict[ws_server.ServerConnection, ClientSendQueue] = {}
        self._time_sync: dict[ws_server.ServerConnection, TimeSync] = {}
        self._serve_future: Future[None] | None = None

    @property
    def port(self) -> int:
        return self._port

    @property
    def connection_count(self) -> int:
        return len(self._connections)

    def start(self) -> None:
        self._serve_future = asyncio.run_coroutine_threadsafe(self._serve(), self._loop)
        if not self._server_ready.wait(timeout=5.0):
            raise TimeoutError("WebSocket server did not become ready")

    def stop(self) -> None:
        if not self._server_ready.is_set():
            return
        if self._stop_event is not None:
            self._loop.call_soon_threadsafe(self._stop_event.set)
        future = self._serve_future
        if future is not None:
            try:
                future.result(timeout=2.0)
            except TimeoutError:
                logger.warning("WebSocket server stop timed out")
            except Exception:
                logger.exception("WebSocket server stop did not finish cleanly")
        self._server_ready.clear()
        self._serve_future = None

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
                max_size=self._max_frame_bytes,
                logger=ws_logger,
            ):
                logger.info("WebSocket server listening", host=host, port=self._port)
                self._server_ready.set()
                await self._stop_event.wait()
        except Exception:
            logger.exception("WebSocket server crashed")
            if not self._server_ready.is_set():
                self._server_ready.set()
            raise

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
        client_id = _new_client_id()
        self._connections.add(websocket)
        outbound = ClientSendQueue(websocket)
        self._outbound[websocket] = outbound
        outbound.start()
        logger.info("AR client connected", remote=str(remote), client_id=client_id)
        try:
            await self._complete_handshake(websocket, client_id)
            if self._on_connect is not None:
                await asyncio.to_thread(self._on_connect, websocket, client_id)
            async for message in websocket:
                try:
                    if isinstance(message, bytes):
                        await self._handle_binary(message, websocket)
                        continue
                    if not isinstance(message, str):
                        raise TypeError("Unsupported WebSocket frame type")
                    for line in split_inbound_text_lines(message):
                        inbound = decode_inbound(line)
                        await self._dispatch_inbound(inbound, websocket, client_id)
                except (TypeError, ValueError) as exc:
                    logger.warning("Invalid inbound WebSocket frame", error=str(exc))
                except Exception:
                    logger.exception("Unhandled inbound WebSocket handler error")
        except websockets.ConnectionClosed as exc:
            logger.info(
                "AR client disconnected",
                remote=str(remote),
                client_id=client_id,
                code=exc.rcvd.code if exc.rcvd is not None else None,
            )
        finally:
            self._connections.discard(websocket)
            self._time_sync.pop(websocket, None)
            try:
                queued = self._outbound.pop(websocket)
            except KeyError:
                pass
            else:
                await queued.stop()
            if self._on_disconnect is not None:
                self._on_disconnect(websocket)

    async def _complete_handshake(
        self,
        websocket: ws_server.ServerConnection,
        client_id: str,
    ) -> None:
        message = await websocket.recv()
        if not isinstance(message, str):
            raise TypeError("hello_request must be a text frame")
        lines = split_inbound_text_lines(message)
        if len(lines) != 1:
            raise ValueError("hello_request must be the only JSON object in the first text frame")
        hello_request = decode_hello_request(lines[0])
        ts_server = time.time()
        time_sync = TimeSync(ts_client=hello_request.ts_client, ts_server=ts_server)
        self._time_sync[websocket] = time_sync
        body = await asyncio.to_thread(self._hello_supplier, client_id)
        hello = Hello(
            client_id=client_id,
            time_sync=time_sync,
            robot=body.robot,
            requires_robot_in_view=body.requires_robot_in_view,
            capabilities=body.capabilities,
        )
        await websocket.send(encode_hello(hello))

    async def _handle_binary(
        self,
        message: bytes,
        websocket: ws_server.ServerConnection,
    ) -> None:
        if len(message) < 4:
            raise ValueError("binary frame too short")
        (fourcc,) = struct.unpack_from("<I", message, 0)
        if fourcc != LOCALIZATION_REQUEST_FOURCC:
            raise ValueError(f"unsupported binary fourcc: {fourcc:#010x}")
        if self._on_localization_request is None:
            logger.warning("localization_request received but no handler is configured")
            return
        time_sync = self._time_sync.get(websocket)
        if time_sync is None:
            raise RuntimeError("localization_request before hello handshake completed")
        observations = decode_localization_request(message)
        result = self._on_localization_request(observations, websocket, time_sync)
        if asyncio.iscoroutine(result):
            await result

    async def _dispatch_inbound(
        self,
        inbound: Inbound,
        websocket: ws_server.ServerConnection,
        client_id: str,
    ) -> None:
        if isinstance(inbound, NavGoalRequest):
            if self._on_nav_goal_request is not None:
                self._on_nav_goal_request(inbound, websocket, client_id)
            return
        if isinstance(inbound, EstopRequest):
            if self._on_estop_request is not None:
                self._on_estop_request(inbound, websocket)
            return
        if isinstance(inbound, LidarSettings):
            if self._on_lidar_settings_request is not None:
                self._on_lidar_settings_request(inbound, websocket)
            return
        if isinstance(inbound, StateRequest):
            if self._on_state_request is not None:
                self._on_state_request(inbound, websocket)
            return

    def schedule_broadcast_text(self, text: str) -> None:
        asyncio.run_coroutine_threadsafe(self._enqueue_all_text(text), self._loop)

    def schedule_broadcast_binary(self, data: bytes) -> None:
        asyncio.run_coroutine_threadsafe(self._enqueue_all_binary(data), self._loop)

    def schedule_send_to(self, websocket: ws_server.ServerConnection, text: str) -> None:
        asyncio.run_coroutine_threadsafe(self._enqueue_one_text(websocket, text), self._loop)

    async def _enqueue_all_text(self, text: str) -> None:
        for outbound in list(self._outbound.values()):
            outbound.enqueue(text)

    async def _enqueue_all_binary(self, data: bytes) -> None:
        for outbound in list(self._outbound.values()):
            outbound.enqueue_binary(data)

    async def _enqueue_one_text(self, websocket: ws_server.ServerConnection, text: str) -> None:
        outbound = self._outbound.get(websocket)
        if outbound is not None:
            outbound.enqueue(text)
