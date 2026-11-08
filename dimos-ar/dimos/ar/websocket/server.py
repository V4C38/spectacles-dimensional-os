"""WebSocket server — runs on ARModule's asyncio loop."""

from __future__ import annotations

import asyncio
from collections import OrderedDict, deque
from collections.abc import Awaitable, Callable
from concurrent.futures import Future, ThreadPoolExecutor
import json
import logging
import secrets
import struct
import threading
import time
from typing import Any

import websockets
import websockets.asyncio.server as ws_server

from dimos.ar.manipulation.protocol import ManipulationRequest
from dimos.ar.navigation.types import NavGoalRequest, NavJoystickRequest
from dimos.ar.replication.interaction import InteractionRequest
from dimos.ar.timing_diagnostics import TimingSummary
from dimos.ar.websocket.bulk import (
    BULK_BYTES_PER_SECOND,
    CHUNK_BYTES,
    BulkAssetStore,
    BulkPeer,
    BulkUpload,
    TokenBucket,
)
from dimos.ar.websocket.ip_relay import IpRelayPublisher, lan_ip
from dimos.ar.websocket.performance import LatencyHistogram
from dimos.ar.websocket.protocol import (
    LOCALIZATION_OBSERVATIONS_FOURCC,
    ClientError,
    ClientPose,
    EstopRequest,
    Hello,
    HelloBody,
    Inbound,
    LidarSettingsRequest,
    LocalizationCaptureProgress,
    LocalizationObservation,
    LocalizationStartRequest,
    LocalizationTracking,
    StateRequest,
    TimeSync,
    UserMessageRequest,
    decode_hello_request,
    decode_inbound,
    decode_localization_observations,
    encode_hello,
)
from dimos.ar.websocket.send_queue import ClientSendQueue, peek_frame_type
from dimos.core.global_config import global_config
from dimos.utils.logging_config import setup_logger

logger = setup_logger()

HelloSupplier = Callable[[str], HelloBody]
ConnectHandler = Callable[[ws_server.ServerConnection, str], None]
NavGoalRequestHandler = Callable[[NavGoalRequest, ws_server.ServerConnection, str], None]
NavJoystickRequestHandler = Callable[[NavJoystickRequest, ws_server.ServerConnection, str], None]
EstopRequestHandler = Callable[[EstopRequest, ws_server.ServerConnection], None]
LidarSettingsRequestHandler = Callable[
    [LidarSettingsRequest, ws_server.ServerConnection, str], None
]
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
CONTROL_BATCH_MAX_BYTES = 65_536
CONTROL_RECORD_MAX_BYTES = 16_384
CONTROL_BATCH_MAX_RECORDS = 32
MAX_CONTROL_CLIENTS = 16


class ControlBudgetError(ValueError):
    pass


def _handshake_noise_filter(record: logging.LogRecord) -> bool:
    msg = record.getMessage()
    return not ("opening handshake failed" in msg or "did not receive a valid HTTP request" in msg)


def split_inbound_text_lines(message: str) -> list[str]:
    return [line for line in message.split("\n") if line.strip()]


def _new_client_id() -> str:
    return secrets.token_hex(16)


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
        on_suspend: Callable[[str, float], None] | None = None,
        on_interaction_request: Callable[[InteractionRequest, str], None] | None = None,
        on_manipulation_request: Callable[[ManipulationRequest, str, float], None] | None = None,
        on_localization_progress: Callable[
            [LocalizationTracking | LocalizationCaptureProgress, str, TimeSync], None
        ]
        | None = None,
    ) -> None:
        self._shared_stream_clients: set[str] = set()
        self._resume_tokens: dict[str, str] = {}
        self._disconnect_handles: dict[str, asyncio.TimerHandle] = {}
        self._on_suspend = on_suspend
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
        self._on_localization_progress = on_localization_progress
        self._on_disconnect = on_disconnect
        self._on_interaction_request = on_interaction_request
        self._on_manipulation_request = on_manipulation_request
        self._retired_connections: set[ws_server.ServerConnection] = set()
        self._closing_tasks: set[asyncio.Task[None]] = set()

        self._stop_event: asyncio.Event | None = None
        self._connections: dict[str, ws_server.ServerConnection] = {}
        self._client_ids: dict[ws_server.ServerConnection, str] = {}
        self._outbound: dict[ws_server.ServerConnection, ClientSendQueue] = {}
        self._time_sync: dict[ws_server.ServerConnection, TimeSync] = {}
        self._serve_future: Future[None] | None = None
        self._ip_relay: IpRelayPublisher | None = None
        self.bulk = BulkAssetStore()
        self._bulk_tokens: dict[str, str] = {}
        self._capture_ids: dict[str, str] = {}
        self._bulk_peers: dict[str, BulkPeer] = {}
        self._bulk_budget = TokenBucket(BULK_BYTES_PER_SECOND, CHUNK_BYTES * 2)
        self._ingress: dict[str, TokenBucket] = {}
        self._ingress_timing: dict[str, TimingSummary] = {}
        self._encoder = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ar-bulk-encode")
        self._encoder_permit = asyncio.Semaphore(1)
        self._hello_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ar-hello")
        self._hello_permit = asyncio.Semaphore(2)
        self._pending_handshakes = 0
        self._bridge_lock = threading.Lock()
        self._bridge_fifo: deque[tuple[ws_server.ServerConnection | None, str]] = deque()
        self._bridge_fifo_bytes = 0
        self._bridge_fifo_counts: dict[ws_server.ServerConnection | None, int] = {}
        self._bridge_latest: OrderedDict[tuple[ws_server.ServerConnection | None, str], str] = OrderedDict()
        self._bridge_scheduled = False
        self._bridge_task: asyncio.Task[None] | None = None
        self._bridge_binary: dict[str | None, bytes] = {}
        self._bulk_preparations: set[asyncio.Task[None]] = set()
        self._closed = False

    @property
    def port(self) -> int:
        return self._port

    def streams_following(self, client_id: str) -> bool:
        return client_id in self._shared_stream_clients

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
        self._closed = True
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
        monitor = asyncio.create_task(self._monitor_loop())
        try:
            async with ws_server.serve(
                self._handler,
                host,
                self._port,
                ping_interval=PING_INTERVAL_S,
                ping_timeout=PING_TIMEOUT_S,
                max_size=min(self._max_frame_bytes, CONTROL_BATCH_MAX_BYTES),
                max_queue=8,
                write_limit=32_768,
                compression=None,
                close_timeout=2,
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
            for handle in self._disconnect_handles.values():
                handle.cancel()
            self._disconnect_handles.clear()
            self._resume_tokens.clear()
            self._shared_stream_clients.clear()
            ws_logger.removeFilter(_handshake_noise_filter)
            monitor.cancel()
            tasks = tuple(self._bulk_preparations)
            if self._bridge_task is not None:
                tasks += (self._bridge_task,)
            for task in tasks:
                task.cancel()
            await asyncio.gather(monitor, *tasks, return_exceptions=True)
            self._encoder.shutdown(wait=False, cancel_futures=True)
            self._hello_executor.shutdown(wait=False, cancel_futures=True)

    async def _monitor_loop(self) -> None:
        histogram = LatencyHistogram()
        next_report = time.monotonic() + 30
        while True:
            expected = time.monotonic() + 0.05
            await asyncio.sleep(0.05)
            now = time.monotonic()
            histogram.add(max(0, now - expected) * 1000)
            if now >= next_report:
                logger.info("AR control event loop timing", p95_ms=histogram.percentile(0.95),
                            p99_ms=histogram.percentile(0.99), maximum_ms=histogram.maximum,
                            clients=len(self._connections), bulk_clients=len(self._bulk_peers))
                histogram.clear()
                next_report = now + 30

    async def _handler(self, websocket: ws_server.ServerConnection) -> None:
        req = getattr(websocket, "request", None)
        if req is not None and req.path in ("/bulk", "/ws/bulk"):
            await self._handle_bulk(websocket)
            return
        if req is not None and req.path not in ("/", "/ws"):
            await websocket.close(1008, "Not Found")
            return

        if len(self._connections) + self._pending_handshakes >= MAX_CONTROL_CLIENTS:
            await websocket.close(1013, "client capacity reached")
            return
        self._pending_handshakes += 1

        remote = getattr(websocket, "remote_address", None)
        client_id = _new_client_id()
        registered = False
        handshake_pending = True
        try:
            async with asyncio.timeout(HELLO_TIMEOUT_S):
                client_id = await self._complete_handshake(websocket, client_id)
            self._pending_handshakes -= 1
            handshake_pending = False
            self._connections[client_id] = websocket
            self._client_ids[websocket] = client_id
            self._ingress[client_id] = TokenBucket(100, 200)
            self._ingress_timing[client_id] = TimingSummary("control ingress timing", client_id=client_id)
            outbound = ClientSendQueue(
                websocket,
                on_failure=lambda reason: self._retire_connection(websocket, client_id, reason),
                client_id=client_id,
            )
            self._outbound[websocket] = outbound
            outbound.start()
            registered = True
            logger.info("AR client connected", remote=str(remote), client_id=client_id)
            if self._on_connect is not None:
                self._on_connect(websocket, client_id)
            async for message in websocket:
                if websocket in self._retired_connections:
                    break
                try:
                    if isinstance(message, bytes):
                        raise TypeError("localization pixels require the paired bulk socket")
                    if not isinstance(message, str):
                        raise TypeError("Unsupported WebSocket frame type")
                    if len(message.encode()) > CONTROL_BATCH_MAX_BYTES:
                        raise ControlBudgetError("control batch exceeds byte budget")
                    lines = split_inbound_text_lines(message)
                    if len(lines) > CONTROL_BATCH_MAX_RECORDS:
                        raise ControlBudgetError("control batch exceeds record budget")
                    for line in lines:
                        if websocket in self._retired_connections:
                            break
                        if len(line.encode()) > CONTROL_RECORD_MAX_BYTES:
                            raise ControlBudgetError("control record exceeds byte budget")
                        inbound = decode_inbound(line)
                        within_budget = self._ingress[client_id].take()
                        if not within_budget and not isinstance(inbound, EstopRequest):
                            self._retire_connection(websocket, client_id, "control rate exceeded")
                            break
                        self._ingress_timing[client_id].record(
                            counts={"records": 1, "bytes": len(line.encode())}, maxima={})
                        await self._dispatch_inbound(inbound, websocket, client_id)
                        if not within_budget:
                            # Always honor Stop, including the request that exhausts
                            # ingress. Then retire the flooding peer before more work.
                            self._retire_connection(websocket, client_id, "control rate exceeded")
                            break
                except (TypeError, ValueError) as exc:
                    logger.warning("Invalid inbound WebSocket frame", error=str(exc))
                    if isinstance(exc, ControlBudgetError) or not self._ingress[client_id].take():
                        self._retire_connection(websocket, client_id, "invalid control frame budget")
                        break
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
            if handshake_pending:
                self._pending_handshakes -= 1
            self._bulk_tokens.pop(client_id, None)
            self._capture_ids.pop(client_id, None)
            self._ingress.pop(client_id, None)
            self._ingress_timing.pop(client_id, None)
            peer = self._bulk_peers.pop(client_id, None)
            if self._connections.get(client_id) is websocket:
                self._connections.pop(client_id, None)
            self._client_ids.pop(websocket, None)
            self._time_sync.pop(websocket, None)
            queued = self._outbound.pop(websocket, None)
            # Retire authority before awaiting either transport. A closed control
            # session must stop being a client even if bulk close or a writer hangs.
            if registered and websocket not in self._retired_connections:
                self._retired_connections.add(websocket)
                if self._on_disconnect is not None:
                    try:
                        if client_id in self._resume_tokens and self._stop_event is not None and not self._stop_event.is_set():
                            deadline = time.monotonic() + 1.0
                            if self._on_suspend is not None:
                                self._on_suspend(client_id, deadline)
                            def expire() -> None:
                                self._disconnect_handles.pop(client_id, None)
                                self._resume_tokens.pop(client_id, None)
                                self._shared_stream_clients.discard(client_id)
                                if self._on_disconnect is not None:
                                    self._on_disconnect(websocket, client_id)
                            self._disconnect_handles[client_id] = self._loop.call_later(1.0, expire)
                        else:
                            self._resume_tokens.pop(client_id, None)
                            self._on_disconnect(websocket, client_id)
                    except Exception:
                        logger.exception("AR client disconnect callback failed", client_id=client_id)
            try:
                if peer is not None:
                    if peer.task is not None:
                        peer.task.cancel()
                    try:
                        await peer.websocket.close(1001, "control session closed")
                    except Exception:
                        logger.exception("Failed to close client bulk socket", client_id=client_id)
            finally:
                try:
                    if queued is not None:
                        try:
                            await queued.stop()
                        except Exception:
                            logger.exception("Failed to stop client sender", client_id=client_id)
                finally:
                    self._retired_connections.discard(websocket)

    def _retire_connection(
        self,
        websocket: ws_server.ServerConnection,
        client_id: str,
        reason: str,
    ) -> None:
        if websocket in self._retired_connections:
            return
        self._resume_tokens.pop(client_id, None)
        self._shared_stream_clients.discard(client_id)
        self._retired_connections.add(websocket)
        self._bulk_tokens.pop(client_id, None)
        self._capture_ids.pop(client_id, None)
        if self._connections.get(client_id) is websocket:
            self._connections.pop(client_id, None)
        if self._on_disconnect is not None:
            self._on_disconnect(websocket, client_id)

        async def close() -> None:
            try:
                async with asyncio.timeout(2.0):
                    await websocket.close(1011, reason[:120])
            except Exception:
                logger.exception("Failed to close retired client", client_id=client_id)

        task = asyncio.create_task(close())
        self._closing_tasks.add(task)
        task.add_done_callback(self._closing_tasks.discard)

    async def _complete_handshake(
        self,
        websocket: ws_server.ServerConnection,
        client_id: str,
    ) -> str:
        message = await websocket.recv()
        if not isinstance(message, str):
            raise TypeError("hello_request must be a text frame")
        lines = split_inbound_text_lines(message)
        if len(lines) != 1:
            raise ValueError("hello_request must be the only JSON object in the first text frame")
        hello_request = decode_hello_request(lines[0])
        if (hello_request.resume_token is None
                and len(self._connections) + len(self._disconnect_handles)
                    + self._pending_handshakes - 1 >= MAX_CONTROL_CLIENTS):
            await websocket.close(1013, "client capacity reached")
            raise ValueError("client capacity reached")
        resume_handle = None
        if hello_request.resume_token is not None:
            matched = next((key for key, value in self._resume_tokens.items()
                            if secrets.compare_digest(value, hello_request.resume_token)), None)
            if matched is None or matched not in self._disconnect_handles:
                raise ValueError("resume session expired or still connected")
            client_id = matched
            resume_handle = self._disconnect_handles[client_id]
        ts_server = time.time()
        time_sync = TimeSync(ts_client=hello_request.ts_client, ts_server=ts_server)
        self._time_sync[websocket] = time_sync
        await self._hello_permit.acquire()
        work = self._loop.run_in_executor(self._hello_executor, self._hello_supplier, client_id)
        work.add_done_callback(lambda _work: self._hello_permit.release())
        work.add_done_callback(lambda done: None if done.cancelled() else done.exception())
        body = await asyncio.shield(work)
        token = secrets.token_hex(32)
        self._bulk_tokens[client_id] = token
        req = getattr(websocket, "request", None)
        hello = Hello(
            client_id=client_id,
            time_sync=time_sync,
            robot=body.robot,
            capabilities=body.capabilities,
            navigation_inputs=body.navigation_inputs,
            nav_goal_preview=body.nav_goal_preview,
            server_info=body.server_info,
            source=body.source,
            odom_reference_id=body.odom_reference_id,
            bulk_url="/ws/bulk" if req is not None and req.path == "/ws" else "/bulk",
            bulk_token=token,
            bulk_epoch=self.bulk.epoch,
            server_follow_stream=hello_request.server_follow_stream,
            independent_ik=True,
            resume_token=(hello_request.resume_token or secrets.token_hex(32))
            if hello_request.resumable else None,
        )
        if resume_handle is not None and self._disconnect_handles.get(client_id) is not resume_handle:
            raise ValueError("resume deadline expired during handshake")
        await websocket.send(encode_hello(hello))
        if resume_handle is not None:
            resume_handle.cancel()
            self._disconnect_handles.pop(client_id, None)
        if hello.server_follow_stream:
            self._shared_stream_clients.add(client_id)
        if hello.resume_token is not None:
            self._resume_tokens[client_id] = hello.resume_token
        return client_id

    async def _handle_bulk(self, websocket: ws_server.ServerConnection) -> None:
        client_id: str | None = None
        peer: BulkPeer | None = None
        try:
            async with asyncio.timeout(HELLO_TIMEOUT_S):
                raw = await websocket.recv()
                if not isinstance(raw, str) or len(raw.encode()) > CONTROL_RECORD_MAX_BYTES:
                    raise ValueError("invalid bulk handshake")
                hello = json.loads(raw)
                if not isinstance(hello, dict):
                    raise TypeError("bulk handshake must be an object")
                client_id = hello.get("client_id")
                token = hello.get("token")
                if isinstance(client_id, str) and isinstance(token, str):
                    while (client_id not in self._connections
                           and secrets.compare_digest(self._bulk_tokens.get(client_id, ""), token)):
                        await asyncio.sleep(0.005)
                if (hello.get("type") != "bulk_hello_request" or hello.get("protocol_version") != 3
                        or not isinstance(client_id, str) or not isinstance(token, str)
                        or client_id not in self._connections
                        or not secrets.compare_digest(self._bulk_tokens.get(client_id, ""), token)
                        or client_id in self._bulk_peers):
                    raise ValueError("bulk session is not attached to a live control session")
                identity = client_id
                peer = BulkPeer(
                    websocket, self.bulk.epoch, self._bulk_budget,
                    lambda: sum(int(item.busy) for item in self._bulk_peers.values()),
                    lambda: any(item.pending for item in self._outbound.values()),
                )
                self._bulk_peers[identity] = peer
                await websocket.send(json.dumps({"type": "bulk_hello", "protocol_version": 3,
                                                  "epoch": self.bulk.epoch}) + "\n")
                peer.task = asyncio.create_task(peer.run())
                def sender_done(task: asyncio.Task[None]) -> None:
                    if not task.cancelled() and task.exception() is not None:
                        close = asyncio.create_task(websocket.close(1011, "bulk sender failed"))
                        self._closing_tasks.add(close)
                        close.add_done_callback(self._closing_tasks.discard)
                peer.task.add_done_callback(sender_done)
            upload: BulkUpload | None = None
            requests = TokenBucket(20, 40)
            while True:
                async with asyncio.timeout(5 if upload is not None else None):
                    raw = await websocket.recv()
                if identity not in self._connections or self._bulk_peers.get(identity) is not peer:
                    break
                if peer.task.done():
                    peer.task.result()
                if isinstance(raw, bytes):
                    if upload is None:
                        raise ValueError("bulk chunk without upload admission")
                    completed = upload.append(raw)
                    # Pixels have an existing image-age deadline. Do not put
                    # uploads behind the optional download token bucket; yield
                    # each bounded chunk so control callbacks remain runnable.
                    await asyncio.sleep(0)
                    if completed is not None:
                        current = upload.capture_id == self._capture_ids.get(identity)
                        if current:
                            await self._handle_binary(completed, self._connections[identity], identity)
                        await websocket.send(json.dumps({"type": "bulk_upload_result",
                                                         "upload_id": upload.identity,
                                                         "status": "accepted" if current else "rejected",
                                                         **({} if current else {"code": "capture_retired"})}) + "\n")
                        upload = None
                        peer.uploading = False
                    continue
                if not isinstance(raw, str) or len(raw.encode()) > CONTROL_RECORD_MAX_BYTES or not requests.take():
                    raise ValueError("bulk metadata exceeds budget")
                request = json.loads(raw)
                if not isinstance(request, dict):
                    raise TypeError("bulk metadata must be an object")
                if request.get("type") == "bulk_get":
                    if (request.get("kind") not in {"model", "trajectory", "route"}
                            or any(not isinstance(request.get(field), str)
                                   or not 1 <= len(request[field]) <= 256
                                   for field in ("epoch", "id", "revision"))):
                        raise ValueError("invalid bulk asset reference")
                    asset = self.bulk.get(str(request.get("kind")), request)
                    if asset is None:
                        await websocket.send(json.dumps({"type": "bulk_error", "code": "asset_unavailable",
                                                         **{field: request[field] for field in
                                                            ("kind", "epoch", "id", "revision")}}) + "\n")
                    else:
                        peer.enqueue(asset)
                elif request.get("type") == "bulk_upload_begin":
                    if upload is not None or request.get("kind") != "localization":
                        raise ValueError("only one localization upload may be active")
                    upload_id, total_bytes = request.get("upload_id"), request.get("total_bytes")
                    if type(upload_id) is not int or type(total_bytes) is not int:
                        raise ValueError("bulk upload requires integer bounds")
                    capture_id = request.get("capture_id")
                    if not isinstance(capture_id, str) or capture_id != self._capture_ids.get(identity):
                        await websocket.send(json.dumps({"type": "bulk_upload_result",
                                                         "upload_id": upload_id,
                                                         "status": "rejected",
                                                         "code": "capture_retired"}) + "\n")
                        continue
                    upload = BulkUpload(upload_id, total_bytes, capture_id)
                    peer.uploading = True
                    await websocket.send(json.dumps({"type": "bulk_upload_ready",
                                                     "upload_id": upload.identity}) + "\n")
                elif request.get("type") == "bulk_upload_cancel":
                    upload_id = request.get("upload_id")
                    if type(upload_id) is not int or not 0 <= upload_id < 2**32:
                        raise ValueError("invalid bulk cancellation id")
                    if upload is not None and upload.identity == upload_id:
                        upload = None
                        peer.uploading = False
                    await websocket.send(json.dumps({"type": "bulk_upload_result",
                                                     "upload_id": upload_id,
                                                     "status": "cancelled"}) + "\n")
                else:
                    raise ValueError("unsupported bulk record")
        except asyncio.CancelledError:
            raise
        except (ValueError, TypeError, KeyError, TimeoutError, websockets.WebSocketException):
            await websocket.close(1008, "invalid or expired bulk transfer")
        finally:
            if client_id is not None and self._bulk_peers.get(client_id) is peer:
                self._bulk_peers.pop(client_id, None)
            if peer is not None and peer.task is not None:
                peer.task.cancel()
                await asyncio.gather(peer.task, return_exceptions=True)

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
        if len(observations) > 3:
            raise ValueError("localization observation count exceeds requested budget")
        result = self._on_localization_observations(observations, client_id, time_sync)
        if asyncio.iscoroutine(result):
            await result

    async def _dispatch_inbound(
        self,
        inbound: Inbound,
        websocket: ws_server.ServerConnection,
        client_id: str,
    ) -> None:
        if isinstance(inbound, ClientError):
            logger.error("Client reported decode error", client_id=client_id,
                         message_type=inbound.message_type, detail=inbound.detail,
                         excerpt=inbound.excerpt, client_ts=inbound.ts, message_ts=inbound.message_ts,
                         request_id=inbound.request_id, suppressed_count=inbound.suppressed_count)
            return
        if isinstance(inbound, ManipulationRequest):
            if self._on_manipulation_request is not None:
                sync = self._time_sync[websocket]
                self._on_manipulation_request(inbound, client_id, sync.ts_server - sync.ts_client)
            return
        if isinstance(inbound, InteractionRequest):
            if self._on_interaction_request is not None:
                self._on_interaction_request(inbound, client_id)
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
                self._on_lidar_settings_request(inbound, websocket, client_id)
            return
        if isinstance(inbound, StateRequest):
            if self._on_state_request is not None:
                self._on_state_request(inbound, websocket)
            return
        if isinstance(inbound, LocalizationStartRequest):
            # This is a generation boundary before the policy can admit another
            # episode; cancellation on the other socket may arrive later.
            self._capture_ids.pop(client_id, None)
            if self._on_localization_start_request is not None:
                self._on_localization_start_request(inbound, client_id)
            return
        if isinstance(inbound, (LocalizationTracking, LocalizationCaptureProgress)):
            if self._on_localization_progress is not None:
                self._on_localization_progress(inbound, client_id, self._time_sync[websocket])
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
        self._post_text(None, text)

    def prepare_outbound(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self.bulk.compact(payload)

    def _prepare_text(self, text: str) -> dict[str, Any]:
        payload = json.loads(text)
        if not isinstance(payload, dict):
            raise TypeError("native control payload must be an object")
        return self.prepare_outbound(payload)

    async def prepare_outbound_async(self, payload: dict[str, Any]) -> dict[str, Any]:
        # Immutable assets hit the revision cache; first-time serialization runs
        # on a dedicated bounded worker, never the control event loop.
        await self._encoder_permit.acquire()
        future = self._loop.run_in_executor(self._encoder, self.prepare_outbound, payload)
        future.add_done_callback(lambda _future: self._encoder_permit.release())
        future.add_done_callback(lambda done: None if done.cancelled() else done.exception())
        result: dict[str, Any] = await asyncio.shield(future)
        self._publish_refs(result)
        return result

    def _publish_refs(self, payload: dict[str, Any]) -> None:
        for field, kind in (("model_ref", "model"), ("plan_ref", "trajectory"), ("route_ref", "route")):
            ref = payload.get(field)
            if isinstance(ref, dict):
                asset = self.bulk.get(kind, ref)
                if asset is not None:
                    for peer in tuple(self._bulk_peers.values()):
                        # Cache retrieval, not continuous observation, owns
                        # retransmission. A revision is enqueued once per peer.
                        if peer._latest.get((kind, asset.ref["id"])) != asset.ref["revision"]:
                            peer.enqueue(asset)
        for field in ("preview", "active_goal"):
            if isinstance(payload.get(field), dict):
                self._publish_refs(payload[field])

    def _post_text(self, websocket: ws_server.ServerConnection | None, text: str) -> None:
        from dimos.ar.websocket.send_queue import COALESCE_FRAME_TYPES, peek_frame_type

        if self._closed:
            return
        frame_type = peek_frame_type(text) or "unknown"
        if frame_type == "localization_observations_request":
            if websocket is None:
                for connection in tuple(self._connections.values()):
                    self._post_text(connection, text)
                return
            client_id = self._client_ids.get(websocket)
            if client_id is None:
                return
            payload = json.loads(text)
            capture_id = secrets.token_hex(16)
            payload["capture_id"] = capture_id
            self._capture_ids[client_id] = capture_id
            text = json.dumps(payload, separators=(",", ":")) + "\n"
        # Correlated preview replies and decisions remain reliable FIFO.
        coalesced = frame_type in COALESCE_FRAME_TYPES and not (
            frame_type == "nav_goal" and '"preview":true' in text.replace(" ", "")
        )
        with self._bridge_lock:
            if coalesced:
                self._bridge_latest[(websocket, frame_type)] = text
            elif (self._bridge_fifo_counts.get(websocket, 0) < 64
                  and self._bridge_fifo_bytes + len(text.encode()) <= 33_554_432):
                self._bridge_fifo.append((websocket, text))
                self._bridge_fifo_bytes += len(text.encode())
                self._bridge_fifo_counts[websocket] = self._bridge_fifo_counts.get(websocket, 0) + 1
            else:
                # The source's control connection is retired instead of losing
                # a decision. Native broadcasts cannot silently overrun memory.
                targets = tuple(self._connections.items())
                for client_id, connection in targets:
                    if websocket is None or connection is websocket:
                        self._loop.call_soon_threadsafe(
                            self._retire_connection, connection, client_id, "control bridge overflow"
                        )
                return
            if not self._bridge_scheduled:
                self._bridge_scheduled = True
                self._loop.call_soon_threadsafe(self._start_bridge)

    def _start_bridge(self) -> None:
        if self._bridge_task is None or self._bridge_task.done():
            self._bridge_task = asyncio.create_task(self._drain_bridge())

    async def _drain_bridge(self) -> None:
        while True:
            with self._bridge_lock:
                if self._bridge_fifo:
                    websocket, text = self._bridge_fifo.popleft()
                    self._bridge_fifo_bytes -= len(text.encode())
                    self._bridge_fifo_counts[websocket] -= 1
                    if self._bridge_fifo_counts[websocket] == 0:
                        self._bridge_fifo_counts.pop(websocket)
                elif self._bridge_latest:
                    (websocket, _kind), text = self._bridge_latest.popitem(last=False)
                elif self._bridge_binary:
                    client_id, data = self._bridge_binary.popitem()
                    self._queue_bulk_binary(client_id, data)
                    continue
                else:
                    self._bridge_scheduled = False
                    return
            try:
                if len(text) <= CONTROL_RECORD_MAX_BYTES and not any(
                    field in text for field in ('"path_poses"', '"trajectory"', '"model"')
                ):
                    if websocket is None:
                        await self._enqueue_all_text(text)
                    else:
                        await self._enqueue_one_text(websocket, text)
                    continue
                if len(self._bulk_preparations) >= 16:
                    raise ValueError("bulk preparation capacity reached")
                task = asyncio.create_task(self._prepare_bulk_text(websocket, text))
                self._bulk_preparations.add(task)
                task.add_done_callback(self._bulk_preparations.discard)
            except Exception:
                logger.exception("Unable to prepare outbound control frame")
                for client_id, connection in tuple(self._connections.items()):
                    if websocket is None or connection is websocket:
                        self._retire_connection(connection, client_id, "invalid native control state")

    async def _prepare_bulk_text(self, websocket: ws_server.ServerConnection | None, text: str) -> None:
        try:
                # Decoding also stays off-loop for legacy-shaped native route
                # broadcasts during the migration to compact domain snapshots.
            await self._encoder_permit.acquire()
            future = self._loop.run_in_executor(
                self._encoder, self._prepare_text, text
            )
            future.add_done_callback(lambda _future: self._encoder_permit.release())
            future.add_done_callback(lambda done: None if done.cancelled() else done.exception())
            payload = await asyncio.shield(future)
            self._publish_refs(payload)
            prepared = json.dumps(payload, separators=(",", ":"), allow_nan=False) + "\n"
            if websocket is None:
                await self._enqueue_all_text(prepared)
            else:
                await self._enqueue_one_text(websocket, prepared)
        except Exception:
            logger.exception("Unable to prepare native bulk state")
            for client_id, connection in tuple(self._connections.items()):
                if websocket is None or connection is websocket:
                    self._retire_connection(connection, client_id, "invalid native bulk state")

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
        self._post_binary(None, data)

    def schedule_send_binary_to_client(self, client_id: str, data: bytes) -> None:
        self._post_binary(client_id, data)

    def _post_binary(self, client_id: str | None, data: bytes) -> None:
        if self._closed or len(data) > 65_536:
            return
        with self._bridge_lock:
            self._bridge_binary[client_id] = data
            if not self._bridge_scheduled:
                self._bridge_scheduled = True
                self._loop.call_soon_threadsafe(self._start_bridge)

    def _queue_bulk_binary(self, client_id: str | None, data: bytes) -> None:
        if client_id is None:
            for peer in tuple(self._bulk_peers.values()):
                peer.lidar(data)
        elif client_id in self._bulk_peers:
            self._bulk_peers[client_id].lidar(data)

    async def _enqueue_one_binary(self, websocket: ws_server.ServerConnection, data: bytes) -> None:
        outbound = self._outbound.get(websocket)
        if outbound is not None:
            outbound.enqueue_binary(data)

    def schedule_send_to(self, websocket: ws_server.ServerConnection, text: str) -> None:
        self._post_text(websocket, text)

    def schedule_send_to_client(self, client_id: str, text: str) -> None:
        websocket = self._connections.get(client_id)
        if websocket is None:
            return
        self.schedule_send_to(websocket, text)

    async def _enqueue_all_text(self, text: str) -> None:
        for websocket in tuple(self._outbound):
            await self._enqueue_one_text(websocket, text)

    async def _enqueue_all_binary(self, data: bytes) -> None:
        self._queue_bulk_binary(None, data)

    async def _enqueue_one_text(self, websocket: ws_server.ServerConnection, text: str) -> None:
        outbound = self._outbound.get(websocket)
        if outbound is not None:
            if peek_frame_type(text) == "localization_observations_request":
                payload = json.loads(text)
                client_id = self._client_ids.get(websocket)
                if client_id is None:
                    return
                capture_id = payload.get("capture_id")
                if capture_id is None:
                    capture_id = secrets.token_hex(16)
                    self._capture_ids[client_id] = capture_id
                    payload["capture_id"] = capture_id
                    text = json.dumps(payload, separators=(",", ":")) + "\n"
                elif capture_id != self._capture_ids.get(client_id):
                    return  # A newer policy request superseded queued old work.
            outbound.enqueue(text)
