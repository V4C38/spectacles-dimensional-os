from __future__ import annotations

import asyncio
import base64
from concurrent.futures import Future
from contextlib import asynccontextmanager
import inspect
import json
import os
import socket
import threading

import pytest
import websockets

from dimos.ar.navigation.types import NavGoalRequest
from dimos.ar.robot.capabilities import NAV_GOAL, NAV_JOYSTICK, Capability, CapabilityName
from dimos.ar.robot.profiles.profile import RobotDescription
from dimos.ar.robot.profiles.unitree_go2 import UNITREE_GO2_PROFILE
from dimos.ar.websocket.protocol import HelloBody, LocalizationStartRequest
from dimos.ar.websocket.server import WebSocketServer, split_inbound_text_lines
from dimos.ar.websocket.test_protocol import TYPESCRIPT_LOCA_ONE


def _pick_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _sample_hello(_client_id: str) -> HelloBody:
    return HelloBody(
        server_info={"robot_ip": "10.0.0.42", "armodule_version": "0.2.0"},
        robot=RobotDescription(
            display_name=UNITREE_GO2_PROFILE.display_name,
            body_bounds_m=UNITREE_GO2_PROFILE.body_bounds_m,
            footprint_m=UNITREE_GO2_PROFILE.footprint_m,
            base_height_m=UNITREE_GO2_PROFILE.base_height_m,
        ),
        capabilities={
            CapabilityName.LIDAR: Capability(available=True, reason=None),
            CapabilityName.NAVIGATION: Capability(available=True, reason=None),
            CapabilityName.LOCALIZATION: Capability(available=True, reason=None),
            CapabilityName.ESTOP: Capability(available=True, reason=None),
            CapabilityName.AGENT: Capability(
                available=False, reason="current blueprint has no DimOS agent"
            ),
        },
        navigation_inputs={
            NAV_GOAL: Capability(available=True, reason=None),
            NAV_JOYSTICK: Capability(available=True, reason=None),
        },
    )


async def _send_hello_request(ws: websockets.ClientConnection, ts_client: float = 1000.0) -> dict:
    await ws.send(json.dumps({"type": "hello_request", "ts_client": ts_client}))
    raw = await asyncio.wait_for(ws.recv(), timeout=3.0)
    return json.loads(raw)


class ServerHarness:
    def __init__(self, **handler_kwargs: object) -> None:
        self.port = _pick_free_port()
        self.loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._server: WebSocketServer | None = None
        self.nav_goal_requests: list[NavGoalRequest] = []
        self.localization_start_requests: list[str] = []
        self.disconnected_client_ids: list[str] = []
        self._handler_kwargs = handler_kwargs

    def _run_loop(self) -> None:
        asyncio.set_event_loop(self.loop)
        self.loop.run_forever()

    def _on_nav_goal_request(
        self, msg: NavGoalRequest, _websocket: object, _client_id: str
    ) -> None:
        self.nav_goal_requests.append(msg)

    def _on_localization_start_request(
        self, _msg: LocalizationStartRequest, client_id: str
    ) -> None:
        self.localization_start_requests.append(client_id)

    def _on_disconnect(self, _websocket: object, client_id: str) -> None:
        self.disconnected_client_ids.append(client_id)

    def start(self) -> None:
        self._thread.start()
        self._server = WebSocketServer(
            port=self.port,
            loop=self.loop,
            hello_supplier=_sample_hello,
            on_nav_goal_request=self._on_nav_goal_request,
            on_localization_start_request=self._on_localization_start_request,
            on_disconnect=self._on_disconnect,
            **self._handler_kwargs,  # type: ignore[arg-type]
        )
        self._server.start()

    def stop(self) -> None:
        if self._server is not None:
            self._server.stop()
        self.loop.call_soon_threadsafe(self.loop.stop)
        self._thread.join(timeout=2.0)


@pytest.fixture
def harness() -> ServerHarness:
    h = ServerHarness()
    h.start()
    try:
        yield h
    finally:
        h.stop()


def test_split_inbound_text_lines() -> None:
    assert split_inbound_text_lines('{"type":"estop_request"}\n\n') == ['{"type":"estop_request"}']


def _open_silent_websocket(port: int) -> socket.socket:
    """Complete the upgrade, then never read. Models a Specs socket left CONNECTING."""
    sock = socket.create_connection(("127.0.0.1", port), timeout=3)
    key = base64.b64encode(os.urandom(16)).decode()
    sock.sendall(
        (
            "GET /ws HTTP/1.1\r\n"
            f"Host: 127.0.0.1:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "\r\n"
        ).encode()
    )
    buffer = b""
    while b"\r\n\r\n" not in buffer:
        chunk = sock.recv(4096)
        if not chunk:
            raise RuntimeError("websocket upgrade closed")
        buffer += chunk
    status = buffer.split(b"\r\n", 1)[0]
    if b" 101 " not in status:
        raise RuntimeError(status.decode())
    sock.settimeout(None)
    return sock


@pytest.mark.asyncio
async def test_reconnect_handshakes_while_prior_socket_ignores_close(
    harness: ServerHarness,
) -> None:
    stale = _open_silent_websocket(harness.port)
    try:
        async with websockets.connect(f"ws://127.0.0.1:{harness.port}/ws") as ws:
            msg = await _send_hello_request(ws)
            assert msg["type"] == "hello"
    finally:
        stale.close()


@pytest.mark.asyncio
async def test_connect_receives_hello_after_hello_request(harness: ServerHarness) -> None:
    async with websockets.connect(f"ws://127.0.0.1:{harness.port}/ws") as ws:
        msg = await _send_hello_request(ws, ts_client=42.0)
        assert msg["server_info"] == {"robot_ip": "10.0.0.42", "armodule_version": "0.2.0"}
        assert msg["type"] == "hello"
        assert "client_id" in msg
        assert msg["time_sync"]["ts_client"] == 42.0
        assert isinstance(msg["time_sync"]["ts_server"], float)
        assert "protocol_version" not in msg


@pytest.mark.asyncio
async def test_nav_goal_request_reaches_handler(harness: ServerHarness) -> None:
    async with websockets.connect(f"ws://127.0.0.1:{harness.port}/ws") as ws:
        await _send_hello_request(ws)
        await ws.send(
            json.dumps(
                {
                    "type": "nav_goal_request",
                    "position": [1.0, 2.0, 0.0],
                    "orientation": [0.0, 0.0, 0.0, 1.0],
                }
            )
        )
        await asyncio.sleep(0.05)
    assert len(harness.nav_goal_requests) == 1
    assert harness.nav_goal_requests[0].position == (1.0, 2.0, 0.0)


@pytest.mark.asyncio
async def test_invalid_path_rejected() -> None:
    h = ServerHarness()
    h.start()
    try:
        with pytest.raises(websockets.exceptions.ConnectionClosedError):
            async with websockets.connect(f"ws://127.0.0.1:{h.port}/nope") as ws:
                await ws.recv()
    finally:
        h.stop()


@pytest.mark.asyncio
async def test_localization_start_request_reaches_handler(harness: ServerHarness) -> None:
    async with websockets.connect(f"ws://127.0.0.1:{harness.port}/ws") as ws:
        hello = await _send_hello_request(ws)
        await ws.send(json.dumps({"type": "localization_start_request"}))
        await asyncio.sleep(0.05)
    assert harness.localization_start_requests == [hello["client_id"]]


@pytest.mark.asyncio
async def test_schedule_send_to_client_targets_one_connection(harness: ServerHarness) -> None:
    assert harness._server is not None
    async with websockets.connect(f"ws://127.0.0.1:{harness.port}/ws") as ws:
        hello = await _send_hello_request(ws)
        harness._server.schedule_send_to_client(
            hello["client_id"],
            '{"type":"localization_observations_request","capture_policy":"any_angle","observation_count":1}\n',
        )
        raw = await asyncio.wait_for(ws.recv(), timeout=3.0)
        msg = json.loads(raw)
        assert msg["type"] == "localization_observations_request"


def test_server_does_not_import_localization_policy() -> None:
    import dimos.ar.websocket.server as server_mod

    assert not hasattr(server_mod, "LocalizationPolicy")
    source = inspect.getsource(server_mod)
    assert "LocalizationPolicy" not in source
    assert "OdomMapTransform" not in source


@pytest.mark.asyncio
async def test_estop_is_processed_on_same_socket_while_localization_waits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from types import SimpleNamespace

    from dimos.ar.localization.coordinator import LocalizationOutcome
    from dimos.ar.localization.policy import LocalizationPolicy
    from dimos.ar.localization.runner import LocalizationRunner
    from dimos.ar.module import ARModule
    from dimos.ar.robot.odometry import RobotOdometry
    import dimos.ar.websocket.server as server_module
    from dimos.ar.websocket.test_protocol import TYPESCRIPT_LOCA_ONE

    monkeypatch.setattr(server_module, "lan_ip", lambda: None)
    entered = threading.Event()
    release = threading.Event()
    stopped = threading.Event()
    callback_threads = []
    module = object.__new__(ARModule)
    module._policy = LocalizationPolicy(["vps"])
    module._odometry = RobotOdometry(factor=1.0)
    module._replay_mode = False

    async def localize(_observations, **_kwargs):
        entered.set()
        await asyncio.to_thread(release.wait, 3)
        return LocalizationOutcome()

    async def close():
        pass

    def connected(_socket, client_id):
        callback_threads.append(threading.get_ident())
        module._policy.on_hello(client_id)
        module._localization_runner = LocalizationRunner(
            coordinator=SimpleNamespace(run=localize, close=close),
            policy=module._policy,
            on_outcome=lambda *_args: None,
            on_prompt=lambda _client: None,
        )

    def disconnected(_socket, client_id):
        module._localization_runner.cancel(client_id)
        module._policy.on_disconnect(client_id)

    h = ServerHarness(
        on_connect=connected,
        on_estop_request=lambda *_args: stopped.set(),
        on_localization_observations=module._on_localization_observations,
    )
    try:
        h.start()
        h._server._on_disconnect = disconnected
        async with websockets.connect(f"ws://127.0.0.1:{h.port}/ws") as ws:
            await _send_hello_request(ws)
            await ws.send(TYPESCRIPT_LOCA_ONE)
            assert await asyncio.to_thread(entered.wait, 1)
            await ws.send(json.dumps({"type": "estop_request"}))
            assert await asyncio.to_thread(stopped.wait, 0.5)
            assert not release.is_set()
            assert callback_threads == [h._thread.ident]
    finally:
        release.set()
        if hasattr(module, "_localization_runner"):
            future = asyncio.run_coroutine_threadsafe(module._localization_runner.close(), h.loop)
            await asyncio.wrap_future(future)
        h.stop()


async def test_clients_sharing_an_ip_remain_independent(harness: ServerHarness) -> None:
    async with websockets.connect(f"ws://127.0.0.1:{harness.port}/ws") as first:
        first_hello = await _send_hello_request(first)
        async with websockets.connect(f"ws://127.0.0.1:{harness.port}/ws") as second:
            second_hello = await _send_hello_request(second)
            assert first_hello["client_id"] != second_hello["client_id"]
            assert harness._server.connection_count == 2
            harness._server.schedule_broadcast_text('{"type":"agent_message","text":"both"}\n')
            for peer in (first, second):
                frame = json.loads(await asyncio.wait_for(peer.recv(), 1))
                assert frame == {"type": "agent_message", "text": "both"}


def test_start_propagates_bind_failure_without_starting_relay(monkeypatch) -> None:
    relay = []
    monkeypatch.setattr(
        "dimos.ar.websocket.server.IpRelayPublisher",
        lambda *args: relay.append(args),
    )
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as occupied:
        occupied.bind(("127.0.0.1", 0))
        occupied.listen()
        h = ServerHarness()
        h.port = occupied.getsockname()[1]
        try:
            with pytest.raises(OSError):
                h.start()
            assert relay == []
            assert h._server._serve_future is None
        finally:
            h.stop()


@pytest.mark.parametrize("invalid", [
    "{", "[]", '{"type":"unknown"}',
    '{"type":"nav_goal_request","position":[true,0,0],"orientation":[0,0,0,1]}',
    b"", bytes(4), TYPESCRIPT_LOCA_ONE[:-1],
])
async def test_invalid_frames_do_not_dispatch_commands_or_break_the_connection(invalid) -> None:
    h = ServerHarness()

    def acknowledge(_request, websocket):
        h._server.schedule_send_to(websocket, '{"type":"agent_message","text":"ready"}\n')

    h._handler_kwargs["on_state_request"] = acknowledge
    h.start()
    try:
        async with websockets.connect(f"ws://127.0.0.1:{h.port}/ws") as ws:
            await _send_hello_request(ws)
            await ws.send(invalid)
            await ws.send('{"type":"state_request"}')
            assert json.loads(await asyncio.wait_for(ws.recv(), 1))["text"] == "ready"
            assert h.nav_goal_requests == []
    finally:
        h.stop()


@pytest.mark.parametrize("invalid", ["{", "[]", b"binary", '{"type":"state_request"}'])
async def test_malformed_handshake_closes_with_policy_error(harness, invalid) -> None:
    async with websockets.connect(f"ws://127.0.0.1:{harness.port}/ws") as ws:
        await ws.send(invalid)
        with pytest.raises(websockets.ConnectionClosedError) as error:
            await asyncio.wait_for(ws.recv(), 1)
        assert error.value.rcvd.code == 1008


def test_start_timeout_cancels_pending_listener_and_leaves_no_server(monkeypatch) -> None:
    cancelled = threading.Event()

    class ShortStartup(Future):
        def result(self, timeout=None):
            return super().result(timeout=0.05)

    @asynccontextmanager
    async def stalled_serve(*_args, **_kwargs):
        try:
            await asyncio.Event().wait()
            yield
        finally:
            cancelled.set()

    monkeypatch.setattr("dimos.ar.websocket.server.Future", ShortStartup)
    monkeypatch.setattr("dimos.ar.websocket.server.ws_server.serve", stalled_serve)
    h = ServerHarness()
    try:
        with pytest.raises(TimeoutError):
            h.start()
        assert cancelled.wait(1)
        assert h._server._serve_future is None
        assert h._server._ip_relay is None
    finally:
        h.stop()


async def test_hello_precedes_broadcasts_and_only_completed_handshakes_receive_telemetry() -> None:
    h = ServerHarness()
    entered, release = threading.Event(), threading.Event()

    def hello(client_id):
        entered.set()
        assert release.wait(3)
        return _sample_hello(client_id)

    h.start()
    h._server._hello_supplier = hello
    try:
        async with websockets.connect(f"ws://127.0.0.1:{h.port}/ws") as ws:
            await ws.send('{"type":"hello_request","ts_client":1}')
            assert await asyncio.to_thread(entered.wait, 1)
            assert h._server.connection_count == 0
            assert h._server._client_ids == {}
            assert h._server._outbound == {}
            await asyncio.wrap_future(asyncio.run_coroutine_threadsafe(
                h._server._enqueue_all_text('{"type":"agent_message","text":"before"}\n'), h.loop
            ))
            await asyncio.wrap_future(asyncio.run_coroutine_threadsafe(
                h._server._enqueue_all_binary(b"before"), h.loop
            ))
            release.set()
            first = json.loads(await asyncio.wait_for(ws.recv(), 1))
            assert first["type"] == "hello"
            assert h._server.connection_count == 1
            h._server.schedule_broadcast_text('{"type":"agent_message","text":"after"}\n')
            assert json.loads(await asyncio.wait_for(ws.recv(), 1))["text"] == "after"
            h._server.schedule_broadcast_binary(b"after")
            assert await asyncio.wait_for(ws.recv(), 1) == b"after"
    finally:
        release.set()
        h.stop()


async def test_unhandshaken_socket_does_not_count_as_active_or_trigger_disconnect() -> None:
    h = ServerHarness()
    h.start()
    stale = _open_silent_websocket(h.port)
    disconnected = threading.Event()
    remaining = []

    def on_disconnect(websocket, client_id):
        h._on_disconnect(websocket, client_id)
        remaining.append(h._server.connection_count)
        disconnected.set()

    h._server._on_disconnect = on_disconnect
    try:
        assert h._server.connection_count == 0
        async with websockets.connect(f"ws://127.0.0.1:{h.port}/ws") as ws:
            hello = await _send_hello_request(ws)
            assert h._server.connection_count == 1
        assert await asyncio.to_thread(disconnected.wait, 1)
        assert remaining == [0]
        assert h.disconnected_client_ids == [hello["client_id"]]
    finally:
        stale.close()
        h.stop()
    assert h.disconnected_client_ids == [hello["client_id"]]
    assert h._server._time_sync == {}


@pytest.mark.parametrize("send_request", [False, True])
async def test_hello_timeout_retires_silent_or_blocked_handshake_without_registration(monkeypatch, send_request) -> None:
    monkeypatch.setattr("dimos.ar.websocket.server.HELLO_TIMEOUT_S", 0.05)
    h = ServerHarness()
    entered, release = threading.Event(), threading.Event()

    def hello(client_id):
        entered.set()
        assert release.wait(3)
        return _sample_hello(client_id)

    h.start()
    h._server._hello_supplier = hello
    try:
        async with websockets.connect(f"ws://127.0.0.1:{h.port}/ws") as ws:
            if send_request:
                await ws.send('{"type":"hello_request","ts_client":1}')
                assert await asyncio.to_thread(entered.wait, 1)
            with pytest.raises(websockets.ConnectionClosedError) as error:
                await asyncio.wait_for(ws.recv(), 1)
            assert error.value.rcvd.code == 1008
            assert error.value.rcvd.reason == "hello_request timeout"
    finally:
        release.set()
        h.stop()
    assert h._server.connection_count == 0
    assert h._server._client_ids == {}
    assert h._server._outbound == {}
    assert h._server._time_sync == {}
    assert h.disconnected_client_ids == []
