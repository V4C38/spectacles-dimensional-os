"""WebSocket server — runs on ARModule's asyncio loop."""

from __future__ import annotations

import asyncio
from collections import OrderedDict, deque
from collections.abc import Awaitable, Callable
from concurrent.futures import Future
from dataclasses import dataclass, field as dataclass_field
import json
import logging
import secrets
import struct
import threading
import time
from typing import Any

import websockets
import websockets.asyncio.server as ws_server

from dimos.ar.async_execution import BoundedWorker
from dimos.ar.manipulation.protocol import ManipulationRequest
from dimos.ar.navigation.types import NavGoalRequest, NavJoystickRequest
from dimos.ar.replication.interaction import InteractionRequest
from dimos.ar.replication.presence import ClientPresence, PresenceRelay
from dimos.ar.robot.capabilities import CapabilityName
from dimos.ar.timing_diagnostics import LatencyHistogram, TimingSummary
from dimos.ar.websocket.bulk import (
    BULK_BYTES_PER_SECOND,
    MAX_BULK_RECORD_BYTES,
    BulkAssetStore,
    BulkPeer,
    BulkUpload,
    TokenBucket,
)
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
    ResumeOperationRequest,
    StateRequest,
    TimeSync,
    UserMessageRequest,
    decode_hello_request,
    decode_inbound,
    decode_localization_observations,
    encode_hello,
    encode_text,
)
from dimos.ar.websocket.send_queue import ClientSendQueue, peek_frame_type
from dimos.ar.websocket.server_discovery import IpRelayPublisher, lan_ip
from dimos.ar.websocket.speech import LocalSpeechTranscriber, validate_recording
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
SESSION_RECOVERY_S = 2.0
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


@dataclass
class ControlConnection:
    """Resources belonging to one socket, never to a resumed successor."""

    websocket: ws_server.ServerConnection
    client_id: str
    time_sync: TimeSync
    bulk_token: str
    sender: ClientSendQueue | None = None
    ingress: TokenBucket = dataclass_field(default_factory=lambda: TokenBucket(100, 200))
    ingress_timing: TimingSummary = dataclass_field(init=False)
    bulk_peer: BulkPeer | None = None
    capture_id: str | None = None
    presence: bool = False
    presence_budget: TokenBucket = dataclass_field(default_factory=lambda: TokenBucket(16_384, 16_384))
    retired: bool = False

    def __post_init__(self) -> None:
        self.ingress_timing = TimingSummary("control ingress timing", client_id=self.client_id)

    def issue_capture(self, payload: dict[str, Any]) -> str:
        self.capture_id = secrets.token_hex(16)
        payload["capture_id"] = self.capture_id
        return encode_text(payload)


@dataclass
class LogicalSession:
    client_id: str
    resume_token: str
    connection: ControlConnection | None = None
    disconnect_handle: asyncio.TimerHandle | None = None
    claimed: bool = False


@dataclass
class HandshakeAdmission:
    session: LogicalSession
    connection: ControlConnection
    resume_handle: asyncio.TimerHandle | None
    completed: bool = False


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
        presence_context: Callable[[], dict[str, str] | None] = lambda: None,
        on_connect: ConnectHandler | None = None,
        on_nav_goal_request: NavGoalRequestHandler | None = None,
        on_estop_request: EstopRequestHandler | None = None,
        on_resume_operation_request: Callable[[ResumeOperationRequest, str], None] | None = None,
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
        self._presence = PresenceRelay(presence_context)
        self._sessions: dict[str, LogicalSession] = {}
        self._sockets: dict[ws_server.ServerConnection, ControlConnection] = {}
        self._admissions: dict[ws_server.ServerConnection, HandshakeAdmission] = {}
        self._on_suspend = on_suspend
        self._relay_url = relay_url
        self._port = port
        self._loop = loop
        self._hello_supplier = hello_supplier
        self._max_frame_bytes = max_frame_bytes
        self._on_connect = on_connect
        self._on_nav_goal_request = on_nav_goal_request
        self._on_estop_request = on_estop_request
        self._on_resume_operation_request = on_resume_operation_request
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
        self._closing_tasks: set[asyncio.Task[None]] = set()

        self._stop_event: asyncio.Event | None = None
        self._serve_future: Future[None] | None = None
        self._ip_relay: IpRelayPublisher | None = None
        self.bulk = BulkAssetStore()
        self._bulk_budget = TokenBucket(BULK_BYTES_PER_SECOND, MAX_BULK_RECORD_BYTES)
        self._encoder = BoundedWorker("ar-bulk-encode")
        self._hello_worker = BoundedWorker("ar-hello", parallelism=2)
        self._speech = LocalSpeechTranscriber()
        self._speech_tasks: dict[str, tuple[str, asyncio.Task[None], ControlConnection]] = {}
        self._pending_handshakes = 0
        self._bridge_lock = threading.Lock()
        self._bridge_fifo: deque[tuple[ws_server.ServerConnection | None, str]] = deque()
        self._bridge_fifo_bytes = 0
        self._bridge_fifo_counts: dict[ws_server.ServerConnection | None, int] = {}
        self._bridge_latest: OrderedDict[tuple[ws_server.ServerConnection | None, str], str] = (
            OrderedDict()
        )
        self._bridge_scheduled = False
        self._bridge_task: asyncio.Task[None] | None = None
        self._bridge_binary: dict[str | None, bytes] = {}
        self._bulk_preparations: set[asyncio.Task[None]] = set()
        self._closed = False

    @property
    def port(self) -> int:
        return self._port

    @property
    def connection_count(self) -> int:
        return len(self._active_connections())

    @property
    def logical_session_count(self) -> int:
        return sum(
            session.connection is not None or session.disconnect_handle is not None
            for session in self._sessions.values()
        )

    def _connection(self, client_id: str) -> ControlConnection | None:
        session = self._sessions.get(client_id)
        return session.connection if session is not None else None

    def _active_connections(self) -> tuple[ControlConnection, ...]:
        return tuple(
            session.connection
            for session in self._sessions.values()
            if session.connection is not None
        )

    def _peers(self) -> tuple[BulkPeer, ...]:
        return tuple(
            connection.bulk_peer
            for connection in self._active_connections()
            if connection.bulk_peer is not None
        )

    def _bulk_connection(self, client_id: str) -> ControlConnection | None:
        connection = self._connection(client_id)
        if connection is not None:
            return connection
        # A paired bulk hello can race the control hello's final send.
        return next(
            (
                admission.connection
                for admission in self._admissions.values()
                if admission.connection.client_id == client_id
            ),
            None,
        )

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
            for session in self._sessions.values():
                if session.disconnect_handle is not None:
                    session.disconnect_handle.cancel()
            self._sessions.clear()
            ws_logger.removeFilter(_handshake_noise_filter)
            monitor.cancel()
            tasks = tuple(self._bulk_preparations)
            tasks += tuple(task for _, task, _ in self._speech_tasks.values())
            if self._bridge_task is not None:
                tasks += (self._bridge_task,)
            for task in tasks:
                task.cancel()
            await asyncio.gather(monitor, *tasks, return_exceptions=True)
            self._encoder.close()
            self._hello_worker.close()
            self._speech.close()

    async def _monitor_loop(self) -> None:
        histogram = LatencyHistogram()
        next_report = time.monotonic() + 30
        while True:
            expected = time.monotonic() + 0.05
            await asyncio.sleep(0.05)
            now = time.monotonic()
            snapshot = self._presence.snapshot(now)
            if snapshot is not None:
                for connection in self._active_connections():
                    if connection.presence and connection.sender is not None:
                        text = self._presence.encode(snapshot, connection.client_id, connection.presence_budget)
                        if text is not None:
                            connection.sender.enqueue(text)
            histogram.add(max(0, now - expected) * 1000)
            if now >= next_report:
                logger.info(
                    "AR control event loop timing",
                    p95_ms=histogram.percentile(0.95),
                    p99_ms=histogram.percentile(0.99),
                    maximum_ms=histogram.maximum,
                    clients=self.connection_count,
                    bulk_clients=len(self._peers()),
                )
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

        if self._pending_handshakes >= MAX_CONTROL_CLIENTS:
            await websocket.close(1013, "client capacity reached")
            return
        self._pending_handshakes += 1

        remote = getattr(websocket, "remote_address", None)
        client_id = _new_client_id()
        connection: ControlConnection | None = None
        registered = False
        handshake_pending = True
        try:
            async with asyncio.timeout(HELLO_TIMEOUT_S):
                admission = await self._complete_handshake(websocket, client_id)
            connection = admission.connection
            client_id = connection.client_id
            self._pending_handshakes -= 1
            handshake_pending = False
            admission.session.connection = connection
            self._sessions[client_id] = admission.session
            self._sockets[websocket] = connection
            self._admissions.pop(websocket, None)
            outbound = ClientSendQueue(
                websocket,
                on_failure=lambda reason: self._retire_connection(websocket, client_id, reason),
                on_transport_failure=lambda reason: self._retire_connection(
                    websocket, client_id, reason, resumable=True
                ),
                client_id=client_id,
            )
            connection.sender = outbound
            outbound.start()
            registered = True
            logger.info("AR client connected", remote=str(remote), client_id=client_id)
            if self._on_connect is not None:
                self._on_connect(websocket, client_id)
            async for message in websocket:
                if connection.retired:
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
                        if connection.retired:
                            break
                        if len(line.encode()) > CONTROL_RECORD_MAX_BYTES:
                            raise ControlBudgetError("control record exceeds byte budget")
                        inbound = decode_inbound(line)
                        within_budget = connection.ingress.take()
                        if not within_budget and not isinstance(inbound, EstopRequest):
                            self._retire_connection(websocket, client_id, "control rate exceeded")
                            break
                        connection.ingress_timing.record(
                            counts={"records": 1, "bytes": len(line.encode())}, maxima={}
                        )
                        await self._dispatch_inbound(inbound, websocket, client_id)
                        if not within_budget:
                            # Always honor Stop, including the request that exhausts
                            # ingress. Then retire the flooding peer before more work.
                            self._retire_connection(websocket, client_id, "control rate exceeded")
                            break
                except (TypeError, ValueError, OverflowError, RecursionError) as exc:
                    logger.warning("Invalid inbound WebSocket frame", error=str(exc))
                    if isinstance(exc, ControlBudgetError) or not connection.ingress.take():
                        self._retire_connection(
                            websocket, client_id, "invalid control frame budget"
                        )
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
        except (TypeError, ValueError, OverflowError, RecursionError) as exc:
            logger.warning("Invalid WebSocket handshake", error=str(exc))
            await websocket.close(1008, "Invalid hello_request")
        except TimeoutError:
            logger.warning("WebSocket hello handshake timed out", client_id=client_id)
            await websocket.close(1008, "hello_request timeout")
        finally:
            if handshake_pending:
                self._pending_handshakes -= 1
            owns_session = connection is not None and self._connection(client_id) is connection
            peer = self._detach_session(websocket, client_id)
            queued = connection.sender if connection is not None else None
            self._sockets.pop(websocket, None)
            self._admissions.pop(websocket, None)
            # Retire authority before awaiting either transport. A closed control
            # session must stop being a client even if bulk close or a writer hangs.
            if registered and owns_session and connection is not None and not connection.retired:
                connection.retired = True
                session = self._sessions.get(client_id)
                try:
                    self._end_session(websocket, client_id, session, resumable=True)
                except Exception:
                    self._sessions.pop(client_id, None)
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
                if queued is not None:
                    try:
                        await queued.stop()
                    except Exception:
                        logger.exception("Failed to stop client sender", client_id=client_id)

    def _detach_session(
        self, websocket: ws_server.ServerConnection, client_id: str
    ) -> BulkPeer | None:
        # An old socket must never detach a resumed identity's resources.
        session = self._sessions.get(client_id)
        connection = session.connection if session is not None else None
        if connection is None or connection.websocket is not websocket:
            return None
        assert session is not None
        self._presence.remove(client_id)
        session.connection = None
        connection.bulk_token = ""
        connection.capture_id = None
        peer, connection.bulk_peer = connection.bulk_peer, None
        if peer is not None and peer.task is not None:
            peer.task.cancel()
        return peer

    def _end_session(
        self,
        websocket: ws_server.ServerConnection,
        client_id: str,
        session: LogicalSession | None,
        *,
        resumable: bool,
    ) -> None:
        if session is None or self._sessions.get(client_id) is not session:
            return
        if session.disconnect_handle is not None:
            return
        if resumable and self._stop_event is not None and not self._stop_event.is_set():
            deadline = time.monotonic() + SESSION_RECOVERY_S
            try:
                if self._on_suspend is not None:
                    self._on_suspend(client_id, deadline)
            except Exception:
                # A failed suspend cannot leave an admitted identity alive
                # without the authority owner's bounded recovery fence.
                logger.exception("AR client suspend callback failed", client_id=client_id)
                self._sessions.pop(client_id, None)
                if self._on_disconnect is not None:
                    self._on_disconnect(websocket, client_id)
                return

            def expire() -> None:
                if self._sessions.get(client_id) is not session:
                    return
                self._sessions.pop(client_id)
                session.disconnect_handle = None
                if self._on_disconnect is not None:
                    try:
                        self._on_disconnect(websocket, client_id)
                    except Exception:
                        logger.exception("AR client disconnect callback failed", client_id=client_id)

            session.disconnect_handle = self._loop.call_later(SESSION_RECOVERY_S, expire)
            return
        self._sessions.pop(client_id, None)
        if self._on_disconnect is not None:
            self._on_disconnect(websocket, client_id)

    def _retire_connection(
        self,
        websocket: ws_server.ServerConnection,
        client_id: str,
        reason: str,
        *,
        resumable: bool = False,
    ) -> None:
        connection = self._sockets.get(websocket)
        if connection is None or connection.retired:
            return
        owns_session = self._connection(client_id) is connection
        connection.retired = True
        peer = self._detach_session(websocket, client_id)
        if owns_session:
            try:
                self._end_session(
                    websocket, client_id, self._sessions.get(client_id), resumable=resumable
                )
            except Exception:
                self._sessions.pop(client_id, None)
                logger.exception("AR client disconnect callback failed", client_id=client_id)

        async def close() -> None:
            try:
                async with asyncio.timeout(2.0):
                    await asyncio.gather(
                        websocket.close(1011, reason[:120]),
                        *(
                            [peer.websocket.close(1001, "control session retired")]
                            if peer is not None
                            else []
                        ),
                        return_exceptions=True,
                    )
            except TimeoutError:
                logger.warning("Retired transport close timed out", client_id=client_id)

        task = asyncio.create_task(close())
        self._closing_tasks.add(task)
        task.add_done_callback(self._closing_tasks.discard)

    async def _complete_handshake(
        self,
        websocket: ws_server.ServerConnection,
        client_id: str,
    ) -> HandshakeAdmission:
        message = await websocket.recv()
        if not isinstance(message, str):
            raise TypeError("hello_request must be a text frame")
        lines = split_inbound_text_lines(message)
        if len(lines) != 1:
            raise ValueError("hello_request must be the only JSON object in the first text frame")
        hello_request = decode_hello_request(lines[0])
        if (
            hello_request.resume_token is None
            and self.logical_session_count + self._pending_handshakes - 1 >= MAX_CONTROL_CLIENTS
        ):
            await websocket.close(1013, "client capacity reached")
            raise ValueError("client capacity reached")
        resume_handle = None
        session = None
        if hello_request.resume_token is not None:
            session = next(
                (
                    item
                    for item in self._sessions.values()
                    if secrets.compare_digest(item.resume_token, hello_request.resume_token)
                ),
                None,
            )
            if session is None or session.claimed:
                raise ValueError("resume session expired or still connected")
            if session.connection is not None:
                # Possession of the logical resume token authorizes replacing
                # its old transport, including before close detection catches up.
                self._retire_connection(
                    session.connection.websocket,
                    session.client_id,
                    "resumed by successor transport",
                    resumable=True,
                )
            if session.disconnect_handle is None:
                raise ValueError("resume session expired")
            client_id = session.client_id
            resume_handle = session.disconnect_handle
            session.claimed = True
        else:
            session = LogicalSession(client_id, secrets.token_hex(32))
        admission: HandshakeAdmission | None = None
        try:
            ts_server = time.time()
            time_sync = TimeSync(ts_client=hello_request.ts_client, ts_server=ts_server)
            body = await self._hello_worker.run(lambda: self._hello_supplier(client_id))
            token = secrets.token_hex(32)
            next_resume_token = secrets.token_hex(32) if resume_handle is not None else session.resume_token
            connection = ControlConnection(websocket, client_id, time_sync, token, presence=hello_request.presence)
            admission = HandshakeAdmission(session, connection, resume_handle)
            self._admissions[websocket] = admission
            req = getattr(websocket, "request", None)
            speech_error = (self._speech.availability_error()
                            if body.capabilities[CapabilityName.AGENT].available else None)
            hello = Hello(
                client_id=client_id,
                time_sync=time_sync,
                robot=body.robot,
                capabilities=body.capabilities,
                navigation_inputs=body.navigation_inputs,
                nav_goal_preview=body.nav_goal_preview,
                server_info=body.server_info,
                source=body.source,
                localization=body.localization,
                odom_reference_id=body.odom_reference_id,
                bulk_url="/ws/bulk" if req is not None and req.path == "/ws" else "/bulk",
                bulk_token=token,
                bulk_epoch=self.bulk.epoch,
                resume_token=next_resume_token,
                presence=hello_request.presence,
                speech_transcription=(body.capabilities[CapabilityName.AGENT].available
                                      and speech_error is None),
                speech_transcription_reason=speech_error,
            )

            def resume_current() -> bool:
                return resume_handle is None or (
                    self._sessions.get(client_id) is session
                    and session.disconnect_handle is resume_handle
                )

            if not resume_current():
                raise ValueError("resume deadline expired during handshake")
            await websocket.send(encode_hello(hello))
            if not resume_current():
                raise ValueError("resume deadline expired during handshake")
            if resume_handle is not None:
                resume_handle.cancel()
                session.disconnect_handle = None
                session.resume_token = next_resume_token
            admission.completed = True
            return admission
        finally:
            session.claimed = False
            if admission is None or not admission.completed:
                self._admissions.pop(websocket, None)

    def _start_transcription(
        self, client_id: str, connection: ControlConnection, request_id: str, recording: bytes
    ) -> None:
        async def transcribe() -> None:
            payload: dict[str, Any] = {
                "type": "speech_transcription_result", "request_id": request_id,
            }

            def progress(status: str) -> None:
                current = self._speech_tasks.get(client_id)
                if (current is not None and current[1] is task
                        and self._connection(client_id) is connection):
                    self.schedule_send_to(connection.websocket, encode_text({
                        **payload, "status": status,
                    }))

            try:
                payload.update(
                    status="completed", text=await self._speech.transcribe(recording, progress)
                )
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - optional STT failures return a bounded rejection
                logger.warning("AR dictation failed", error=type(exc).__name__)
                payload.update(status="rejected", message=str(exc)[:512] or "Try recording again.")
            finally:
                current = self._speech_tasks.get(client_id)
                if current is not None and current[1] is asyncio.current_task():
                    del self._speech_tasks[client_id]
            if self._connection(client_id) is connection:
                self.schedule_send_to(connection.websocket, encode_text(payload))

        task = asyncio.create_task(transcribe())
        self._speech_tasks[client_id] = (request_id, task, connection)

    async def _handle_bulk(self, websocket: ws_server.ServerConnection) -> None:
        client_id: str | None = None
        peer: BulkPeer | None = None
        connection: ControlConnection | None = None
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
                    candidate = self._bulk_connection(client_id)
                    while (
                        self._connection(client_id) is None
                        and candidate is not None
                        and secrets.compare_digest(candidate.bulk_token, token)
                    ):
                        await asyncio.sleep(0.005)
                        candidate = self._bulk_connection(client_id)
                connection = self._connection(client_id) if isinstance(client_id, str) else None
                if (
                    hello.get("type") != "bulk_hello_request"
                    or hello.get("protocol_version") != 2
                    or not isinstance(client_id, str)
                    or not isinstance(token, str)
                    or connection is None
                    or not secrets.compare_digest(connection.bulk_token, token)
                    or connection.bulk_peer is not None
                ):
                    raise ValueError("bulk session is not attached to a live control session")
                identity = client_id
                peer = BulkPeer(
                    websocket,
                    self.bulk.epoch,
                    self._bulk_budget,
                    lambda: sum(int(item.busy) for item in self._peers()),
                    lambda: any(
                        item.sender is not None and item.sender.pending
                        for item in self._active_connections()
                    ),
                )
                connection.bulk_peer = peer
                await websocket.send(
                    json.dumps(
                        {"type": "bulk_hello", "protocol_version": 2, "epoch": self.bulk.epoch}
                    )
                    + "\n"
                )
                peer.task = asyncio.create_task(peer.run())

                def sender_done(task: asyncio.Task[None]) -> None:
                    if not task.cancelled() and task.exception() is not None:
                        close = asyncio.create_task(websocket.close(1011, "bulk sender failed"))
                        self._closing_tasks.add(close)
                        close.add_done_callback(self._closing_tasks.discard)

                peer.task.add_done_callback(sender_done)
            upload: BulkUpload | None = None
            speech_upload: tuple[str, str] | None = None
            requests = TokenBucket(20, 40)
            while True:
                async with asyncio.timeout(5 if upload is not None else None):
                    raw = await websocket.recv()
                if self._connection(identity) is not connection or connection.bulk_peer is not peer:
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
                        capture_current = speech_upload is not None or upload.capture_id == connection.capture_id
                        if speech_upload is not None:
                            self._start_transcription(identity, connection, speech_upload[0], completed)
                        elif capture_current:
                            await self._handle_binary(completed, connection.websocket, identity)
                        await websocket.send(
                            json.dumps(
                                {
                                    "type": "bulk_upload_result",
                                    "upload_id": upload.identity,
                                    "status": "accepted" if capture_current else "rejected",
                                    **({} if capture_current else {"code": "capture_retired"}),
                                }
                            )
                            + "\n"
                        )
                        upload = None
                        speech_upload = None
                        peer.uploading = False
                    continue
                if (
                    not isinstance(raw, str)
                    or len(raw.encode()) > CONTROL_RECORD_MAX_BYTES
                    or not requests.take()
                ):
                    raise ValueError("bulk metadata exceeds budget")
                request = json.loads(raw)
                if not isinstance(request, dict):
                    raise TypeError("bulk metadata must be an object")
                if request.get("type") == "bulk_get":
                    if request.get("kind") not in {"model", "trajectory", "route"} or any(
                        not isinstance(request.get(field), str)
                        or not 1 <= len(request[field]) <= 256
                        for field in ("epoch", "id", "revision")
                    ):
                        raise ValueError("invalid bulk asset reference")
                    asset = self.bulk.get(str(request.get("kind")), request)
                    if asset is None:
                        await websocket.send(
                            json.dumps(
                                {
                                    "type": "bulk_error",
                                    "code": "asset_unavailable",
                                    **{
                                        field: request[field]
                                        for field in ("kind", "epoch", "id", "revision")
                                    },
                                }
                            )
                            + "\n"
                        )
                    else:
                        peer.enqueue(asset)
                elif request.get("type") == "bulk_upload_begin":
                    if upload is not None or request.get("kind") not in {"localization", "speech"}:
                        raise ValueError("only one upload may be active")
                    upload_id, total_bytes = request.get("upload_id"), request.get("total_bytes")
                    if type(upload_id) is not int or type(total_bytes) is not int:
                        raise ValueError("bulk upload requires integer bounds")
                    capture_id = request.get("capture_id")
                    if request.get("kind") == "speech":
                        speech_upload = validate_recording(request.get("request_id"), request.get("mime_type"), total_bytes)
                        unavailable = self._speech.availability_error()
                        if unavailable is not None:
                            speech_upload = None
                            await websocket.send(json.dumps({
                                "type": "bulk_upload_result", "upload_id": upload_id,
                                "status": "rejected", "code": "speech_unavailable",
                            }) + "\n")
                            continue
                        if identity in self._speech_tasks or len(self._speech_tasks) >= 4:
                            speech_upload = None
                            await websocket.send(json.dumps({
                                "type": "bulk_upload_result", "upload_id": upload_id,
                                "status": "rejected", "code": "speech_busy",
                            }) + "\n")
                            continue
                        # The authenticated hello inventory owns admission; a
                        # clip cannot grant an unavailable agent capability.
                        body = await self._hello_worker.run(lambda: self._hello_supplier(identity))
                        if not body.capabilities[CapabilityName.AGENT].available:
                            raise ValueError("agent dictation is unavailable")
                        capture_id = None
                    elif not isinstance(capture_id, str) or capture_id != connection.capture_id:
                        await websocket.send(
                            json.dumps(
                                {
                                    "type": "bulk_upload_result",
                                    "upload_id": upload_id,
                                    "status": "rejected",
                                    "code": "capture_retired",
                                }
                            )
                            + "\n"
                        )
                        continue
                    upload = BulkUpload(upload_id, total_bytes, capture_id)
                    peer.uploading = True
                    await websocket.send(
                        json.dumps({"type": "bulk_upload_ready", "upload_id": upload.identity})
                        + "\n"
                    )
                elif request.get("type") == "bulk_upload_cancel":
                    upload_id = request.get("upload_id")
                    if type(upload_id) is not int or not 0 <= upload_id < 2**32:
                        raise ValueError("invalid bulk cancellation id")
                    if upload is not None and upload.identity == upload_id:
                        upload = None
                        speech_upload = None
                        peer.uploading = False
                    await websocket.send(
                        json.dumps(
                            {
                                "type": "bulk_upload_result",
                                "upload_id": upload_id,
                                "status": "cancelled",
                            }
                        )
                        + "\n"
                    )
                elif request.get("type") == "speech_transcription_cancel":
                    request_id = request.get("request_id")
                    pending = self._speech_tasks.get(identity)
                    if pending is not None and pending[0] == request_id:
                        del self._speech_tasks[identity]
                        pending[1].cancel()
                else:
                    raise ValueError("unsupported bulk record")
        except asyncio.CancelledError:
            raise
        except (ValueError, TypeError, KeyError, TimeoutError, websockets.WebSocketException):
            await websocket.close(1008, "invalid or expired bulk transfer")
        finally:
            if client_id is not None:
                current_connection = self._connection(client_id)
                if current_connection is not None and current_connection.bulk_peer is peer:
                    current_connection.bulk_peer = None
                pending = self._speech_tasks.get(client_id)
                if peer is not None and pending is not None and pending[2] is connection:
                    del self._speech_tasks[client_id]
                    pending[1].cancel()
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
        connection = self._sockets.get(websocket)
        if connection is None:
            raise RuntimeError("localization_observations before hello handshake completed")
        observations = decode_localization_observations(message)
        if len(observations) > 3:
            raise ValueError("localization observation count exceeds requested budget")
        result = self._on_localization_observations(observations, client_id, connection.time_sync)
        if asyncio.iscoroutine(result):
            await result

    async def _dispatch_inbound(
        self,
        inbound: Inbound,
        websocket: ws_server.ServerConnection,
        client_id: str,
    ) -> None:
        if isinstance(inbound, ClientPresence):
            connection = self._connection(client_id)
            if connection is not None and connection.presence and connection.websocket is websocket:
                self._presence.receive(client_id, inbound, time.monotonic())
            return
        if isinstance(inbound, ClientError):
            logger.error(
                "Client reported decode error",
                client_id=client_id,
                message_type=inbound.message_type,
                detail=inbound.detail,
                excerpt=inbound.excerpt,
                client_ts=inbound.ts,
                message_ts=inbound.message_ts,
                request_id=inbound.request_id,
                suppressed_count=inbound.suppressed_count,
            )
            return
        if isinstance(inbound, ManipulationRequest):
            if self._on_manipulation_request is not None:
                sync = self._sockets[websocket].time_sync
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
        if isinstance(inbound, ResumeOperationRequest):
            if self._on_resume_operation_request is not None:
                self._on_resume_operation_request(inbound, client_id)
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
            connection = self._connection(client_id)
            if connection is not None:
                connection.capture_id = None
            if self._on_localization_start_request is not None:
                self._on_localization_start_request(inbound, client_id)
            return
        if isinstance(inbound, (LocalizationTracking, LocalizationCaptureProgress)):
            if self._on_localization_progress is not None:
                self._on_localization_progress(
                    inbound, client_id, self._sockets[websocket].time_sync
                )
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

    async def _encode_bulk(
        self, operation: Callable[..., dict[str, Any]], value: Any
    ) -> dict[str, Any]:
        result = await self._encoder.run(lambda: operation(value))
        self._publish_refs(result)
        return result

    async def prepare_outbound_async(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._encode_bulk(self.prepare_outbound, payload)

    def _publish_refs(self, payload: dict[str, Any]) -> None:
        for field, kind in (
            ("model_ref", "model"),
            ("plan_ref", "trajectory"),
            ("route_ref", "route"),
        ):
            ref = payload.get(field)
            if isinstance(ref, dict):
                asset = self.bulk.get(kind, ref)
                if asset is not None:
                    for peer in self._peers():
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
            # Capture identity belongs to the event-loop connection owner. Native
            # producers may enqueue ordinary bridge frames from worker threads.
            try:
                current_loop = asyncio.get_running_loop()
            except RuntimeError:
                current_loop = None
            if current_loop is not self._loop:
                self._loop.call_soon_threadsafe(self._post_text, websocket, text)
                return
            if websocket is None:
                for target in self._active_connections():
                    self._post_text(target.websocket, text)
                return
            connection = self._sockets.get(websocket)
            if (
                connection is None
                or connection.retired
                or self._connection(connection.client_id) is not connection
            ):
                return
            text = connection.issue_capture(json.loads(text))
        coalesced = frame_type in COALESCE_FRAME_TYPES
        with self._bridge_lock:
            if coalesced:
                self._bridge_latest[(websocket, frame_type)] = text
            elif (
                self._bridge_fifo_counts.get(websocket, 0) < 64
                and self._bridge_fifo_bytes + len(text.encode()) <= 33_554_432
            ):
                self._bridge_fifo.append((websocket, text))
                self._bridge_fifo_bytes += len(text.encode())
                self._bridge_fifo_counts[websocket] = self._bridge_fifo_counts.get(websocket, 0) + 1
            else:
                # The source's control connection is retired instead of losing
                # a decision. Native broadcasts cannot silently overrun memory.
                for target in self._active_connections():
                    if websocket is None or target.websocket is websocket:
                        self._loop.call_soon_threadsafe(
                            self._retire_connection,
                            target.websocket,
                            target.client_id,
                            "control bridge overflow",
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
                for target in self._active_connections():
                    if websocket is None or target.websocket is websocket:
                        self._retire_connection(
                            target.websocket, target.client_id, "invalid native control state"
                        )

    async def _prepare_bulk_text(
        self, websocket: ws_server.ServerConnection | None, text: str
    ) -> None:
        try:
            payload = await self._encode_bulk(self._prepare_text, text)
            prepared = encode_text(payload)
            if websocket is None:
                await self._enqueue_all_text(prepared)
            else:
                await self._enqueue_one_text(websocket, prepared)
        except Exception:
            logger.exception("Unable to prepare native bulk state")
            for target in self._active_connections():
                if websocket is None or target.websocket is websocket:
                    self._retire_connection(
                        target.websocket, target.client_id, "invalid native bulk state"
                    )

    def schedule_disconnect_all(self, reason: str) -> None:
        async def close_connections() -> None:
            await asyncio.gather(
                *(
                    connection.websocket.close(1012, reason)
                    for connection in self._active_connections()
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
            for peer in self._peers():
                peer.lidar(data)
        else:
            connection = self._connection(client_id)
            if connection is not None and connection.bulk_peer is not None:
                connection.bulk_peer.lidar(data)

    def schedule_send_to(self, websocket: ws_server.ServerConnection, text: str) -> None:
        self._post_text(websocket, text)

    def schedule_send_to_client(self, client_id: str, text: str) -> None:
        connection = self._connection(client_id)
        if connection is not None:
            self.schedule_send_to(connection.websocket, text)

    async def _enqueue_all_text(self, text: str) -> None:
        for connection in tuple(self._sockets.values()):
            await self._enqueue_one_text(connection.websocket, text)

    async def _enqueue_one_text(self, websocket: ws_server.ServerConnection, text: str) -> None:
        connection = self._sockets.get(websocket)
        if connection is None or connection.sender is None:
            return
        if peek_frame_type(text) == "localization_observations_request":
            if connection.retired or self._connection(connection.client_id) is not connection:
                return
            payload = json.loads(text)
            capture_id = payload.get("capture_id")
            if capture_id is None:
                text = connection.issue_capture(payload)
            elif capture_id != connection.capture_id:
                return  # A newer policy request superseded queued old work.
        connection.sender.enqueue(text)
