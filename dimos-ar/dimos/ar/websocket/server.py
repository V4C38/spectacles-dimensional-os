"""WebSocket server — runs on ARModule's asyncio loop."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from concurrent.futures import Future
import logging
import secrets
import struct
import time

import websockets
import websockets.asyncio.server as ws_server

from dimos.ar.manipulation.protocol import ManipulationRequest
from dimos.ar.navigation.types import NavGoalRequest, NavJoystickRequest
from dimos.ar.websocket.ip_relay import IpRelayPublisher, lan_ip
from dimos.ar.websocket.protocol import (
    LOCALIZATION_OBSERVATIONS_FOURCC,
    ClientPose,
    EstopRequest,
    Hello,
    HelloBody,
    Inbound,
    LidarSettingsRequest,
    LocalizationObservation,
    LocalizationStartRequest,
    StateRequest,
    TimeSync,
    UserMessageRequest,
    decode_hello_request,
    decode_inbound,
    decode_localization_observations,
    encode_hello,
)
from dimos.ar.websocket.send_queue import ClientSendQueue
from dimos.core.global_config import global_config
from dimos.utils.logging_config import setup_logger

logger = setup_logger()

HelloSupplier = Callable[[str], HelloBody]
ConnectHandler = Callable[[ws_server.ServerConnection, str], None]
NavGoalRequestHandler = Callable[[NavGoalRequest, ws_server.ServerConnection, str], None]
NavJoystickRequestHandler = Callable[[NavJoystickRequest, ws_server.ServerConnection, str], None]
EstopRequestHandler = Callable[[EstopRequest, ws_server.ServerConnection], None]
LidarSettingsRequestHandler = Callable[[LidarSettingsRequest, ws_server.ServerConnection], None]
StateRequestHandler = Callable[[StateRequest, ws_server.ServerConnection], None]
LocalizationStartRequestHandler = Callable[[LocalizationStartRequest, str], None]
LocalizationObservationsHandler = Callable[
    [tuple[LocalizationObservation, ...], str, TimeSync],
    Awaitable[None] | None,
]
UserMessageRequestHandler = Callable[[UserMessageRequest, ws_server.ServerConnection, str], None]
ClientPoseHandler = Callable[[ClientPose, ws_server.ServerConnection, str], None]
DisconnectHandler = Callable[[ws_server.ServerConnection, str], None]

PING_INTERVAL_S = 30.0
PING_TIMEOUT_S = 30.0
HELLO_TIMEOUT_S = 5.0
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
        relay_url: str | None = None,
        on_connect: ConnectHandler | None = None,
        on_nav_goal_request: NavGoalRequestHandler | None = None,
        on_estop_request: EstopRequestHandler | None = None,
        on_lidar_settings_request: LidarSettingsRequestHandler | None = None,
        on_state_request: StateRequestHandler | None = None,
        on_localization_start_request: LocalizationStartRequestHandler | None = None,
        on_localization_observations: LocalizationObservationsHandler | None = None,
        on_user_message_request: UserMessageRequestHandler | None = None,
        on_client_pose: ClientPoseHandler | None = None,
        on_nav_joystick_request: NavJoystickRequestHandler | None = None,
        on_disconnect: DisconnectHandler | None = None,
        on_manipulation_request: Callable[[ManipulationRequest, str, float], None] | None = None,
    ) -> None:
        self._relay_url = relay_url
        self._port = port
        self._loop = loop
        self._hello_supplier = hello_supplier
        self._max_frame_bytes = max_frame_bytes
        self._on_connect = on_connect
        self._on_nav_goal_request = on_nav_goal_request
        self._on_estop_request = on_estop_request
        self._on_lidar_settings_request = on_lidar_settings_request
        self._on_state_request = on_state_request
        self._on_localization_start_request = on_localization_start_request
        self._on_localization_observations = on_localization_observations
        self._on_user_message_request = on_user_message_request
        self._on_client_pose = on_client_pose
        self._on_nav_joystick_request = on_nav_joystick_request
        self._on_disconnect = on_disconnect
        self._on_manipulation_request = on_manipulation_request

        self._stop_event: asyncio.Event | None = None
        self._connections: dict[str, ws_server.ServerConnection] = {}
        self._client_ids: dict[ws_server.ServerConnection, str] = {}
        self._outbound: dict[ws_server.ServerConnection, ClientSendQueue] = {}
        self._time_sync: dict[ws_server.ServerConnection, TimeSync] = {}
        self._serve_future: Future[None] | None = None
        self._ip_relay: IpRelayPublisher | None = None

    @property
    def port(self) -> int:
        return self._port

    @property
    def connection_count(self) -> int:
        return len(self._connections)

    def start(self) -> None:
        if self._serve_future is not None:
            raise RuntimeError("WebSocket server is already started")
        ready: Future[None] = Future()
        self._serve_future = asyncio.run_coroutine_threadsafe(self._serve(ready), self._loop)
        try:
            ready.result(timeout=5.0)
        except BaseException:
            ready.cancel()
            self._serve_future.cancel()
            self._serve_future = None
            raise
        if self._relay_url is None:
            return
        ip = lan_ip()
        if ip is None:
            logger.warning("PIN unavailable, enter IP")
            return
        self._ip_relay = IpRelayPublisher(self._relay_url, ip, self._port)
        self._ip_relay.start()

    def stop(self) -> None:
        self._stop_ip_relay()
        if self._serve_future is None:
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
        self._serve_future = None

    def _stop_ip_relay(self) -> None:
        publisher = self._ip_relay
        self._ip_relay = None
        if publisher is not None:
            publisher.stop()

    async def _serve(self, ready: Future[None]) -> None:
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
                if not ready.done():
                    ready.set_result(None)
                await self._stop_event.wait()
        except BaseException as exc:
            if not ready.done():
                ready.set_exception(exc)
            raise
        finally:
            ws_logger.removeFilter(_handshake_noise_filter)

    async def _handler(self, websocket: ws_server.ServerConnection) -> None:
        req = getattr(websocket, "request", None)
        if req is not None and req.path not in ("/", "/ws"):
            await websocket.close(1008, "Not Found")
            return

        remote = getattr(websocket, "remote_address", None)
        client_id = _new_client_id()
        registered = False
        try:
            async with asyncio.timeout(HELLO_TIMEOUT_S):
                await self._complete_handshake(websocket, client_id)
            self._connections[client_id] = websocket
            self._client_ids[websocket] = client_id
            outbound = ClientSendQueue(websocket)
            self._outbound[websocket] = outbound
            outbound.start()
            registered = True
            logger.info("AR client connected", remote=str(remote), client_id=client_id)
            if self._on_connect is not None:
                self._on_connect(websocket, client_id)
            async for message in websocket:
                try:
                    if isinstance(message, bytes):
                        await self._handle_binary(message, websocket, client_id)
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
        except (TypeError, ValueError) as exc:
            logger.warning("Invalid WebSocket handshake", error=str(exc))
            await websocket.close(1008, "Invalid hello_request")
        except TimeoutError:
            logger.warning("WebSocket hello handshake timed out", client_id=client_id)
            await websocket.close(1008, "hello_request timeout")
        finally:
            if self._connections.get(client_id) is websocket:
                self._connections.pop(client_id, None)
            self._client_ids.pop(websocket, None)
            self._time_sync.pop(websocket, None)
            try:
                queued = self._outbound.pop(websocket)
            except KeyError:
                pass
            else:
                await queued.stop()
            if registered and self._on_disconnect is not None:
                self._on_disconnect(websocket, client_id)

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
            capabilities=body.capabilities,
            navigation_inputs=body.navigation_inputs,
            nav_goal_preview=body.nav_goal_preview,
            server_info=body.server_info,
            odom_reference_id=body.odom_reference_id,
        )
        await websocket.send(encode_hello(hello))

    async def _handle_binary(
        self,
        message: bytes,
        websocket: ws_server.ServerConnection,
        client_id: str,
    ) -> None:
        if len(message) < 4:
            raise ValueError("binary frame too short")
        (fourcc,) = struct.unpack_from("<I", message, 0)
        if fourcc != LOCALIZATION_OBSERVATIONS_FOURCC:
            raise ValueError(f"unsupported binary fourcc: {fourcc:#010x}")
        if self._on_localization_observations is None:
            logger.warning("localization_observations received but no handler is configured")
            return
        time_sync = self._time_sync.get(websocket)
        if time_sync is None:
            raise RuntimeError("localization_observations before hello handshake completed")
        observations = decode_localization_observations(message)
        result = self._on_localization_observations(observations, client_id, time_sync)
        if asyncio.iscoroutine(result):
            await result

    async def _dispatch_inbound(
        self,
        inbound: Inbound,
        websocket: ws_server.ServerConnection,
        client_id: str,
    ) -> None:
        if isinstance(inbound, ManipulationRequest):
            if self._on_manipulation_request is not None:
                sync = self._time_sync[websocket]
                self._on_manipulation_request(inbound, client_id, sync.ts_server - sync.ts_client)
            return
        if isinstance(inbound, NavGoalRequest):
            if self._on_nav_goal_request is not None:
                self._on_nav_goal_request(inbound, websocket, client_id)
            return
        if isinstance(inbound, EstopRequest):
            if self._on_estop_request is not None:
                self._on_estop_request(inbound, websocket)
            return
        if isinstance(inbound, LidarSettingsRequest):
            if self._on_lidar_settings_request is not None:
                self._on_lidar_settings_request(inbound, websocket)
            return
        if isinstance(inbound, StateRequest):
            if self._on_state_request is not None:
                self._on_state_request(inbound, websocket)
            return
        if isinstance(inbound, LocalizationStartRequest):
            if self._on_localization_start_request is not None:
                self._on_localization_start_request(inbound, client_id)
            return
        if isinstance(inbound, UserMessageRequest):
            if self._on_user_message_request is not None:
                self._on_user_message_request(inbound, websocket, client_id)
            return
        if isinstance(inbound, ClientPose):
            if self._on_client_pose is not None:
                self._on_client_pose(inbound, websocket, client_id)
            return
        if isinstance(inbound, NavJoystickRequest):
            if self._on_nav_joystick_request is not None:
                self._on_nav_joystick_request(inbound, websocket, client_id)
            return

    def schedule_broadcast_text(self, text: str) -> None:
        asyncio.run_coroutine_threadsafe(self._enqueue_all_text(text), self._loop)

    def schedule_disconnect_all(self, reason: str) -> None:
        async def close_connections() -> None:
            await asyncio.gather(
                *(
                    connection.close(1012, reason)
                    for connection in tuple(self._connections.values())
                ),
                return_exceptions=True,
            )

        asyncio.run_coroutine_threadsafe(close_connections(), self._loop)

    def schedule_broadcast_binary(self, data: bytes) -> None:
        asyncio.run_coroutine_threadsafe(self._enqueue_all_binary(data), self._loop)

    def schedule_send_to(self, websocket: ws_server.ServerConnection, text: str) -> None:
        asyncio.run_coroutine_threadsafe(self._enqueue_one_text(websocket, text), self._loop)

    def schedule_send_to_client(self, client_id: str, text: str) -> None:
        websocket = self._connections.get(client_id)
        if websocket is None:
            return
        self.schedule_send_to(websocket, text)

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
