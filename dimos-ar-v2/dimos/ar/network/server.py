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

from dimos.ar.network.protocol import (
    LOCALIZE_FOURCC,
    EstopMessage,
    GetStateMessage,
    HelloWire,
    InboundMessage,
    LidarData,
    LocalizeObservation,
    NavGoalMessage,
    TimeSyncMessage,
    decode_inbound,
    decode_localize,
    encode_hello,
    encode_time,
)
from dimos.ar.network.send_queue import ClientSendQueue
from dimos.core.global_config import global_config
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from concurrent.futures import Future

logger = setup_logger()

HelloSupplier = Callable[[str], HelloWire]
ConnectHandler = Callable[[ws_server.ServerConnection, str], None]
NavGoalHandler = Callable[[NavGoalMessage, ws_server.ServerConnection], None]
EstopHandler = Callable[[EstopMessage, ws_server.ServerConnection], None]
LidarHandler = Callable[[LidarData, ws_server.ServerConnection], None]
GetStateHandler = Callable[[GetStateMessage, ws_server.ServerConnection], None]
LocalizeHandler = Callable[
    [tuple[LocalizeObservation, ...], ws_server.ServerConnection],
    Awaitable[None] | None,
]
DisconnectHandler = Callable[[ws_server.ServerConnection], None]

PING_INTERVAL_S = 30.0
PING_TIMEOUT_S = 30.0
DEFAULT_MAX_MESSAGE_BYTES = 4_194_304


def _handshake_noise_filter(record: logging.LogRecord) -> bool:
    msg = record.getMessage()
    return not ("opening handshake failed" in msg or "did not receive a valid HTTP request" in msg)


def split_inbound_text_lines(message: str) -> list[str]:
    return [line for line in message.split("\n") if line.strip()]


def _new_client_id() -> str:
    return secrets.token_hex(3)


class WebSocketServer:
    """Accepts AR client connections and dispatches inbound protocol messages."""

    def __init__(
        self,
        *,
        port: int,
        loop: asyncio.AbstractEventLoop,
        hello_supplier: HelloSupplier,
        max_message_bytes: int = DEFAULT_MAX_MESSAGE_BYTES,
        on_connect: ConnectHandler | None = None,
        on_nav_goal: NavGoalHandler | None = None,
        on_estop: EstopHandler | None = None,
        on_set_lidar: LidarHandler | None = None,
        on_get_state: GetStateHandler | None = None,
        on_localize: LocalizeHandler | None = None,
        on_disconnect: DisconnectHandler | None = None,
    ) -> None:
        self._port = port
        self._loop = loop
        self._hello_supplier = hello_supplier
        self._max_message_bytes = max_message_bytes
        self._on_connect = on_connect
        self._on_nav_goal = on_nav_goal
        self._on_estop = on_estop
        self._on_set_lidar = on_set_lidar
        self._on_get_state = on_get_state
        self._on_localize = on_localize
        self._on_disconnect = on_disconnect

        self._stop_event: asyncio.Event | None = None
        self._server_ready = threading.Event()
        self._connections: set[ws_server.ServerConnection] = set()
        self._outbound: dict[ws_server.ServerConnection, ClientSendQueue] = {}
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
                max_size=self._max_message_bytes,
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
            hello = await asyncio.to_thread(self._hello_supplier, client_id)
            await websocket.send(encode_hello(hello))
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
                        await self._dispatch_inbound(inbound, websocket)
                except (TypeError, ValueError) as exc:
                    logger.warning("Invalid inbound WebSocket message", error=str(exc))
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
            outbound = self._outbound.pop(websocket, None)
            if outbound is not None:
                await outbound.stop()
            if self._on_disconnect is not None:
                self._on_disconnect(websocket)

    async def _handle_binary(
        self,
        message: bytes,
        websocket: ws_server.ServerConnection,
    ) -> None:
        if len(message) < 4:
            raise ValueError("binary frame too short")
        (fourcc,) = struct.unpack_from("<I", message, 0)
        if fourcc != LOCALIZE_FOURCC:
            raise ValueError(f"unsupported binary fourcc: {fourcc:#010x}")
        if self._on_localize is None:
            logger.warning("localize received but no handler is configured")
            return
        observations = decode_localize(message)
        result = self._on_localize(observations, websocket)
        if asyncio.iscoroutine(result):
            await result

    async def _dispatch_inbound(
        self,
        inbound: InboundMessage,
        websocket: ws_server.ServerConnection,
    ) -> None:
        if isinstance(inbound, TimeSyncMessage):
            server_recv_ts = time.time()
            await websocket.send(
                encode_time(
                    client_send_ts=inbound.client_send_ts,
                    server_recv_ts=server_recv_ts,
                    server_send_ts=time.time(),
                )
            )
            return
        if isinstance(inbound, NavGoalMessage):
            if self._on_nav_goal is not None:
                self._on_nav_goal(inbound, websocket)
            return
        if isinstance(inbound, EstopMessage):
            if self._on_estop is not None:
                self._on_estop(inbound, websocket)
            return
        if isinstance(inbound, LidarData):
            if self._on_set_lidar is not None:
                self._on_set_lidar(inbound, websocket)
            return
        if isinstance(inbound, GetStateMessage):
            if self._on_get_state is not None:
                self._on_get_state(inbound, websocket)
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
