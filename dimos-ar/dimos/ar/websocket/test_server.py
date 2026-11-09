from __future__ import annotations

import asyncio
import base64
from concurrent.futures import Future
from contextlib import asynccontextmanager
import json
import os
import socket
import threading
from types import SimpleNamespace

import pytest
import websockets

from dimos.ar.websocket.server import WebSocketServer, split_inbound_text_lines
from test_support.websocket import (
    TYPESCRIPT_LOCA_ONE,
    ServerHarness,
    _sample_hello,
    _send_hello_request,
    _upload_localization,
)


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
        assert msg["protocol_version"] == 2


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
    from test_support.websocket import TYPESCRIPT_LOCA_ONE

    monkeypatch.setattr(server_module, "lan_ip", lambda: None)
    entered = threading.Event()
    release = threading.Event()
    stopped = threading.Event()
    callback_threads = []
    module = object.__new__(ARModule)
    module._map_localization = None
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
            hello = await _send_hello_request(ws)
            await _upload_localization(h, ws, hello, TYPESCRIPT_LOCA_ONE)
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
            await harness.wait_for_connection(first_hello["client_id"])
            await harness.wait_for_connection(second_hello["client_id"])
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


async def test_hello_precedes_broadcasts_and_only_completed_handshakes_receive_telemetry(monkeypatch) -> None:
    h = ServerHarness()
    entered, release = threading.Event(), threading.Event()
    written, bulk_received = threading.Event(), threading.Event()
    publish = asyncio.Event()

    def hello(client_id):
        entered.set()
        assert release.wait(3)
        return _sample_hello(client_id)

    h.start()
    original_handshake = h._server._complete_handshake
    original_bulk = h._server._handle_bulk

    async def handshake(websocket, client_id):
        send = websocket.send

        async def write_then_yield(message):
            await send(message)
            written.set()
            # Receiving hello doesn't imply this send awaiter has resumed.
            await publish.wait()

        websocket.send = write_then_yield
        try:
            return await original_handshake(websocket, client_id)
        finally:
            websocket.send = send

    async def handle_bulk(websocket):
        recv = websocket.recv

        async def received(*args, **kwargs):
            message = await recv(*args, **kwargs)
            bulk_received.set()
            return message

        websocket.recv = received
        try:
            await original_bulk(websocket)
        finally:
            websocket.recv = recv

    monkeypatch.setattr(h._server, "_complete_handshake", handshake)
    monkeypatch.setattr(h._server, "_handle_bulk", handle_bulk)
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
            release.set()
            first = json.loads(await asyncio.wait_for(ws.recv(), 1))
            assert first["type"] == "hello"
            assert await asyncio.to_thread(written.wait, 1)
            assert h._server.connection_count == 0
            assert h._server._client_ids == {}
            assert h._server._outbound == {}
            async with websockets.connect(f"ws://127.0.0.1:{h.port}{first['bulk_url']}") as bulk:
                await bulk.send(json.dumps({"type": "bulk_hello_request", "protocol_version": 2,
                                           "client_id": first["client_id"], "token": first["bulk_token"]}))
                assert await asyncio.to_thread(bulk_received.wait, 1)
                assert h._server._bulk_peers == {}
                await asyncio.wrap_future(asyncio.run_coroutine_threadsafe(
                    h._server._enqueue_all_text('{"type":"agent_message","text":"not-admitted"}\n'), h.loop
                ))
                await asyncio.wrap_future(asyncio.run_coroutine_threadsafe(
                    h._server._enqueue_all_binary(b"not-admitted"), h.loop
                ))
                h.loop.call_soon_threadsafe(publish.set)
                await h.wait_for_connection(first["client_id"])
                assert h._server.connection_count == 1
                assert json.loads(await asyncio.wait_for(bulk.recv(), 1))["type"] == "bulk_hello"
                h._server.schedule_broadcast_text('{"type":"agent_message","text":"after"}\n')
                assert json.loads(await asyncio.wait_for(ws.recv(), 1))["text"] == "after"
                h._server.schedule_broadcast_binary(b"after")
                begin = json.loads(await asyncio.wait_for(bulk.recv(), 1))
                assert begin["type"] == "bulk_binary_begin"
                assert begin["kind"] == "lidar" and begin["total_bytes"] == 5
                packet = await asyncio.wait_for(bulk.recv(), 1)
                assert isinstance(packet, bytes) and packet.endswith(b"after")
    finally:
        release.set()
        h.loop.call_soon_threadsafe(publish.set)
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
            await h.wait_for_connection(hello["client_id"])
            assert h._server.connection_count == 1
        assert await asyncio.to_thread(disconnected.wait, 1)
        assert remaining == [0]
        assert h.disconnected_client_ids == [hello["client_id"]]
    finally:
        stale.close()
        h.stop()
    assert h.disconnected_client_ids == [hello["client_id"]]
    assert h._server._time_sync == {}


@pytest.mark.parametrize("held_cleanup", ["bulk_close", "writer_stop"])
async def test_disconnect_retires_authority_before_transport_cleanup(monkeypatch, held_cleanup) -> None:
    h = ServerHarness()
    entered, release, finished = threading.Event(), threading.Event(), threading.Event()
    remaining = []

    def on_disconnect(websocket, client_id):
        h._on_disconnect(websocket, client_id)
        remaining.append(h._server.connection_count)
        # A sender can report its failure during the callback or cleanup. It must
        # not retire the same authority twice.
        h._server._retire_connection(websocket, client_id, "late sender failure")

    h.start()
    h._server._on_disconnect = on_disconnect
    try:
        async with websockets.connect(f"ws://127.0.0.1:{h.port}/ws") as old:
            hello = await _send_hello_request(old)
            old_id = hello["client_id"]
            await h.wait_for_connection(old_id)

            async def install_held_cleanup():
                websocket = h._server._connections[old_id]

                async def hold():
                    entered.set()
                    while not release.is_set():
                        await asyncio.sleep(0.005)

                if held_cleanup == "bulk_close":
                    async def close(*_args):
                        await hold()
                        finished.set()

                    h._server._bulk_peers[old_id] = SimpleNamespace(
                        task=None, websocket=SimpleNamespace(close=close))
                else:
                    queued = h._server._outbound[websocket]
                    real_stop = queued.stop

                    async def stop():
                        await hold()
                        await real_stop()
                        finished.set()

                    monkeypatch.setattr(queued, "stop", stop)
                return websocket

            old_socket = await asyncio.wrap_future(
                asyncio.run_coroutine_threadsafe(install_held_cleanup(), h.loop))
            await old.close()
            assert await asyncio.to_thread(entered.wait, 1)
            assert h._server.connection_count == 0
            assert h.disconnected_client_ids == [old_id]
            assert remaining == [0]
            assert old_socket not in h._server._client_ids
            assert old_socket not in h._server._outbound
            assert old_id not in h._server._bulk_tokens
            assert old_id not in h._server._bulk_peers

            async with websockets.connect(f"ws://127.0.0.1:{h.port}/ws") as successor:
                successor_id = (await _send_hello_request(successor))["client_id"]
                await h.wait_for_connection(successor_id)
                assert successor_id != old_id
                assert h._server.connection_count == 1
                release.set()
                assert await asyncio.to_thread(finished.wait, 1)
                await successor.send('{"type":"localization_start_request"}')
                for _ in range(100):
                    if h.localization_start_requests:
                        break
                    await asyncio.sleep(0.005)
                assert h.localization_start_requests == [successor_id]
                assert h._server.connection_count == 1
                assert h.disconnected_client_ids == [old_id]
                assert remaining == [0]
                assert old_socket not in h._server._retired_connections
    finally:
        release.set()
        h.stop()


async def test_disconnect_callback_and_bulk_close_failures_still_stop_sender(monkeypatch) -> None:
    h = ServerHarness()
    stopped = threading.Event()

    def on_disconnect(websocket, client_id):
        h._on_disconnect(websocket, client_id)
        raise RuntimeError("disconnect callback failed")

    h.start()
    h._server._on_disconnect = on_disconnect
    try:
        async with websockets.connect(f"ws://127.0.0.1:{h.port}/ws") as ws:
            hello = await _send_hello_request(ws)
            client_id = hello["client_id"]
            await h.wait_for_connection(client_id)

            async def install_failing_cleanup():
                websocket = h._server._connections[client_id]
                queued = h._server._outbound[websocket]
                real_stop = queued.stop

                async def close(*_args):
                    raise RuntimeError("bulk close failed")

                async def stop():
                    await real_stop()
                    stopped.set()

                h._server._bulk_peers[client_id] = SimpleNamespace(
                    task=None, websocket=SimpleNamespace(close=close))
                monkeypatch.setattr(queued, "stop", stop)
                return websocket

            server_socket = await asyncio.wrap_future(
                asyncio.run_coroutine_threadsafe(install_failing_cleanup(), h.loop))
            await ws.close()
            assert await asyncio.to_thread(stopped.wait, 1)
            assert h._server.connection_count == 0
            assert h.disconnected_client_ids == [client_id]
            assert server_socket not in h._server._retired_connections
            assert h._server._outbound == {}
    finally:
        h.stop()


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


@pytest.mark.asyncio
async def test_client_decode_report_does_not_disconnect_or_generate_a_reply(harness, monkeypatch):
    from dimos.ar.websocket import server

    reports = []
    monkeypatch.setattr(server.logger, "error", lambda event, **fields: reports.append((event, fields)))
    async with websockets.connect(f"ws://127.0.0.1:{harness.port}") as ws:
        hello = await _send_hello_request(ws)
        await ws.send(json.dumps({"type": "client_error", "message_type": "manipulation_state",
                                  "detail": "invalid pose", "excerpt": "orientation", "ts": 1001}))
        await ws.send(json.dumps({"type": "localization_start_request"}))
        for _ in range(50):
            if reports and harness.localization_start_requests:
                break
            await asyncio.sleep(0.01)
        assert reports[0][1]["client_id"] == hello["client_id"]
        assert reports[0][1]["detail"] == "invalid pose"
        assert harness.localization_start_requests == [hello["client_id"]]
        assert harness.disconnected_client_ids == []
        with pytest.raises(TimeoutError):
            await asyncio.wait_for(ws.recv(), 0.05)


@pytest.mark.asyncio
async def test_stop_at_rate_limit_is_honored_then_flooding_peer_retires():
    from dimos.ar.websocket.bulk import TokenBucket

    stops = []
    h = ServerHarness(on_estop_request=lambda *_args: stops.append(True))
    h.start()
    try:
        async with websockets.connect(f"ws://localhost:{h.port}") as ws:
            hello = await _send_hello_request(ws)
            await h.wait_for_connection(hello["client_id"])
            installed = threading.Event()

            def limit():
                h._server._ingress[hello["client_id"]] = TokenBucket(0, 1)
                installed.set()

            h.loop.call_soon_threadsafe(limit)
            assert await asyncio.to_thread(installed.wait, 1)
            await ws.send('\n'.join(['{"type":"estop_request"}'] * 4))
            await asyncio.wait_for(ws.wait_closed(), 2)
            assert len(stops) == 2
    finally:
        h.stop()


@pytest.mark.asyncio
@pytest.mark.parametrize("delay", [0.1, 0.5, 0.9])
async def test_resumable_socket_preserves_identity_without_disconnect_callback(harness, delay):
    url = f"ws://127.0.0.1:{harness.port}/"
    async with websockets.connect(url) as first:
        await first.send(json.dumps({"type": "hello_request", "ts_client": 1,
                                     "resumable": True, "server_follow_stream": True}))
        hello = json.loads(await first.recv())
        await harness.wait_for_connection(hello["client_id"])
    await asyncio.sleep(delay)
    assert harness.disconnected_client_ids == []
    async with websockets.connect(url) as second:
        await second.send(json.dumps({"type": "hello_request", "ts_client": 2,
                                      "resumable": True, "resume_token": hello["resume_token"]}))
        resumed = json.loads(await second.recv())
        await harness.wait_for_connection(resumed["client_id"])
        assert resumed["client_id"] == hello["client_id"]
        assert resumed["bulk_token"] != hello["bulk_token"]
        await asyncio.sleep(0.15)
        assert harness.disconnected_client_ids == []


@pytest.mark.asyncio
async def test_expired_resume_cannot_restore_authority(harness):
    url = f"ws://127.0.0.1:{harness.port}/"
    async with websockets.connect(url) as first:
        await first.send(json.dumps({"type": "hello_request", "ts_client": 1, "resumable": True}))
        hello = json.loads(await first.recv())
        await harness.wait_for_connection(hello["client_id"])
    await asyncio.sleep(1.1)
    assert harness.disconnected_client_ids == [hello["client_id"]]
    async with websockets.connect(url) as second:
        await second.send(json.dumps({"type": "hello_request", "ts_client": 2,
                                      "resumable": True, "resume_token": hello["resume_token"]}))
        with pytest.raises(websockets.ConnectionClosed):
            await second.recv()


@pytest.mark.asyncio
async def test_resume_uses_its_reserved_slot_when_capacity_is_full(harness, monkeypatch):
    monkeypatch.setattr("dimos.ar.websocket.server.MAX_CONTROL_CLIENTS", 1)
    url = f"ws://127.0.0.1:{harness.port}/"
    async with websockets.connect(url) as first:
        await first.send(json.dumps({"type": "hello_request", "ts_client": 1, "resumable": True}))
        hello = json.loads(await first.recv())
        await harness.wait_for_connection(hello["client_id"])
    await asyncio.sleep(0.05)
    async with websockets.connect(url) as second:
        await second.send(json.dumps({"type": "hello_request", "ts_client": 2,
                                      "resumable": True, "resume_token": hello["resume_token"]}))
        resumed = json.loads(await second.recv())
        assert resumed["client_id"] == hello["client_id"]
        await harness.wait_for_connection(resumed["client_id"])
    assert harness.disconnected_client_ids == []


@pytest.mark.asyncio
async def test_concurrent_resume_claims_have_one_owner_and_one_valid_bulk_token():
    loop = asyncio.get_running_loop()
    server = WebSocketServer(port=0, loop=loop, hello_supplier=_sample_hello)
    token = "a" * 64
    server._resume_tokens["client"] = token
    handle = loop.call_later(10, lambda: None)
    server._disconnect_handles["client"] = handle
    entered, release = asyncio.Event(), asyncio.Event()

    class Socket:
        def __init__(self, blocked=False):
            self.blocked = blocked
            self.sent = []

        async def recv(self):
            return json.dumps({"type": "hello_request", "ts_client": 1,
                               "resumable": True, "resume_token": token})

        async def send(self, value):
            self.sent.append(json.loads(value))
            if self.blocked:
                entered.set()
                await release.wait()

    first, second = Socket(True), Socket()
    pending = asyncio.create_task(server._complete_handshake(first, "fresh-a"))
    try:
        await asyncio.wait_for(entered.wait(), 1)
        assert server.logical_session_count == 1
        with pytest.raises(ValueError, match="still connected"):
            await server._complete_handshake(second, "fresh-b")
        assert not second.sent
        release.set()
        assert await pending == "client"
        assert server._bulk_tokens["client"] == first.sent[0]["bulk_token"]
        assert not server._resume_claims
    finally:
        release.set()
        await asyncio.gather(pending, return_exceptions=True)
        handle.cancel()
        server._encoder.shutdown(wait=False)
        server._hello_executor.shutdown(wait=False)


@pytest.mark.asyncio
async def test_failed_resume_send_releases_claim_without_retiring_the_session():
    loop = asyncio.get_running_loop()
    server = WebSocketServer(port=0, loop=loop, hello_supplier=_sample_hello)
    token = "b" * 64
    server._resume_tokens["client"] = token
    handle = loop.call_later(10, lambda: None)
    server._disconnect_handles["client"] = handle

    class Socket:
        async def recv(self):
            return json.dumps({"type": "hello_request", "ts_client": 1,
                               "resumable": True, "resume_token": token})

        async def send(self, value):
            raise OSError("socket closed during hello")

    try:
        with pytest.raises(OSError):
            await server._complete_handshake(Socket(), "fresh")
        assert not server._resume_claims
        assert server.logical_session_count == 1
        assert server._resume_tokens["client"] == token
        assert "client" not in server._bulk_tokens
    finally:
        handle.cancel()
        server._encoder.shutdown(wait=False)
        server._hello_executor.shutdown(wait=False)


@pytest.mark.asyncio
async def test_expired_resume_claim_does_not_keep_a_logical_session_alive():
    loop = asyncio.get_running_loop()
    server = WebSocketServer(port=0, loop=loop, hello_supplier=_sample_hello)
    token = "c" * 64
    server._resume_tokens["client"] = token
    counts = []
    entered, release, expired = asyncio.Event(), asyncio.Event(), asyncio.Event()

    def expire():
        server._disconnect_handles.pop("client", None)
        server._resume_tokens.pop("client", None)
        counts.append(server.logical_session_count)
        expired.set()

    server._disconnect_handles["client"] = loop.call_later(0.05, expire)

    class Socket:
        async def recv(self):
            return json.dumps({"type": "hello_request", "ts_client": 1,
                               "resumable": True, "resume_token": token})

        async def send(self, value):
            entered.set()
            await release.wait()

    pending = asyncio.create_task(server._complete_handshake(Socket(), "fresh"))
    try:
        await asyncio.wait_for(entered.wait(), 1)
        await asyncio.wait_for(expired.wait(), 1)
        assert counts == [0]
        release.set()
        with pytest.raises(ValueError, match="expired"):
            await pending
        assert server.logical_session_count == 0
        assert not server._resume_claims
        assert "client" not in server._bulk_tokens
    finally:
        release.set()
        await asyncio.gather(pending, return_exceptions=True)
        server._encoder.shutdown(wait=False)
        server._hello_executor.shutdown(wait=False)


@pytest.mark.asyncio
@pytest.mark.parametrize("providers, expected", [
    ([], []),
    (["fiducial_marker"], ["fiducial_marker"]),
    (["vps"], ["vps"]),
    (["vps", "fiducial_marker"], ["fiducial_marker", "vps"]),
])
async def test_hello_serializes_configured_provider_inventory(harness, monkeypatch, providers, expected):
    from test_support.module import _module_with_policy

    module = _module_with_policy(providers)
    monkeypatch.setattr(harness._server, "_hello_supplier", module._hello_body)
    async with websockets.connect(f"ws://127.0.0.1:{harness.port}/ws") as socket:
        hello = await _send_hello_request(socket)
    assert hello["protocol_version"] == 2
    assert hello["localization"] == {"providers": expected}
    assert hello["capabilities"]["localization"]["available"] is bool(expected)


@pytest.mark.asyncio
@pytest.mark.parametrize("resume", [False, True])
async def test_cancelled_post_hello_send_rolls_back_admission_without_retiring_resume(resume):
    loop = asyncio.get_running_loop()
    connected, disconnected = [], []
    server = WebSocketServer(port=0, loop=loop, hello_supplier=_sample_hello,
                             on_connect=lambda *_args: connected.append(True),
                             on_disconnect=lambda *_args: disconnected.append(True))
    token = "d" * 64
    handle = loop.call_later(30, lambda: None)
    if resume:
        server._resume_tokens["suspended"] = token
        server._disconnect_handles["suspended"] = handle
    sent = asyncio.Event()
    emitted = []

    class Socket:
        request = SimpleNamespace(path="/ws")

        async def recv(self):
            return json.dumps({"type": "hello_request", "ts_client": 1, "resumable": True,
                               **({"resume_token": token} if resume else {})})

        async def send(self, value):
            emitted.append(json.loads(value))
            sent.set()
            await asyncio.Event().wait()

    socket = Socket()
    task = asyncio.create_task(server._handler(socket))
    try:
        await asyncio.wait_for(sent.wait(), 1)
        assert emitted[0]["type"] == "hello"
        assert server.connection_count == 0
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert not connected and not disconnected
        assert server._pending_handshakes == 0
        assert server._client_ids == server._outbound == server._time_sync == {}
        assert not server._bulk_tokens and not server._resume_claims
        if resume:
            assert server._disconnect_handles["suspended"] is handle
            assert not handle.cancelled()
            assert server._resume_tokens["suspended"] == token
            assert server.logical_session_count == 1
        else:
            assert not server._resume_tokens
            assert server.logical_session_count == 0
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        handle.cancel()
        server._encoder.shutdown(wait=False)
        server._hello_executor.shutdown(wait=False)


@pytest.mark.asyncio
async def test_admission_callback_failure_removes_the_published_session_and_sender():
    loop = asyncio.get_running_loop()
    disconnected = []
    sent = []

    def reject(_socket, _client_id):
        raise RuntimeError("admission callback failed")

    server = WebSocketServer(port=0, loop=loop, hello_supplier=_sample_hello,
                             on_connect=reject,
                             on_disconnect=lambda _socket, client: disconnected.append(client))

    class Socket:
        request = SimpleNamespace(path="/ws")

        async def recv(self):
            return '{"type":"hello_request","ts_client":1}'

        async def send(self, value):
            sent.append(json.loads(value))

    try:
        with pytest.raises(RuntimeError, match="admission callback failed"):
            await server._handler(Socket())
        assert [frame["type"] for frame in sent] == ["hello"]
        assert disconnected == [sent[0]["client_id"]]
        assert server.connection_count == server.logical_session_count == 0
        assert server._pending_handshakes == 0
        assert server._client_ids == server._outbound == server._time_sync == {}
        assert not server._bulk_tokens and not server._resume_tokens
    finally:
        server._encoder.shutdown(wait=False)
        server._hello_executor.shutdown(wait=False)
