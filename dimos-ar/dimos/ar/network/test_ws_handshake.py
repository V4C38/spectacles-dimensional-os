"""In-process WebSocket handshake tests for ARWebSocketServer."""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
import json
import socket
import threading
import time

import pytest
import websockets

from dimos.ar.network.protocol import (
    DEFAULT_CAPABILITIES,
    PROTOCOL_VERSION,
    GetStatusMessage,
    RegistrationCommandMessage,
    encode_runtime_snapshot,
)
from dimos.ar.network.websocket_server import ARWebSocketServer
from dimos.ar.robot_profile.base import CapabilityState, RobotHandshake

HELLO_TIMEOUT_S = 3.0
SLOW_HANDLER_SLEEP_S = 0.5


def _sample_handshake() -> RobotHandshake:
    capability_states = {
        capability: CapabilityState(capability != "emergency_stop", "disabled")
        if capability == "emergency_stop"
        else CapabilityState(True)
        for capability in DEFAULT_CAPABILITIES
    }
    return RobotHandshake(
        robot_id="unitree_go2",
        display_name="Unitree Go2",
        capability_states=capability_states,
        body_bounds_m=(0.7, 0.5, 0.55),
        footprint_m=(0.7, 0.5),
        visual_origin_frame="base_link",
        base_height_m=0.33,
        default_render_offset_m=(0.0, 0.0, 0.0),
    )


def _pick_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _sample_runtime_snapshot(robot_id: str = "unitree_go2") -> str:
    return encode_runtime_snapshot(
        robot_id=robot_id,
        bridge={
            "robot_connected": True,
            "reconnecting": False,
            "world_frame_committed": False,
            "world_frame_method": None,
            "world_frame_approximate": False,
        },
        nav={"phase": "idle"},
        ts=1.0,
    )


class HandshakeServerHarness:
    def __init__(
        self,
        *,
        slow_status_connect: bool = False,
        slow_registration_command: bool = False,
        send_snapshot_on_connect: bool = True,
    ) -> None:
        self.port = _pick_free_port()
        self.loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._server: ARWebSocketServer | None = None
        self._slow_status_connect = slow_status_connect
        self._slow_registration_command = slow_registration_command
        self._send_snapshot_on_connect = send_snapshot_on_connect
        self.get_status_replies = 0
        self.registration_command_count = 0

    def _run_loop(self) -> None:
        asyncio.set_event_loop(self.loop)
        self.loop.run_forever()

    def _on_status_connect(self, websocket: object) -> None:
        if self._slow_status_connect:
            time.sleep(SLOW_HANDLER_SLEEP_S)
        if self._send_snapshot_on_connect and self._server is not None:
            self._server.schedule_send_to(websocket, _sample_runtime_snapshot() + "\n")

    def _on_get_status(self, _msg: GetStatusMessage, websocket: object) -> None:
        self.get_status_replies += 1
        if self._server is not None:
            self._server.schedule_send_to(websocket, _sample_runtime_snapshot() + "\n")

    def _on_registration_command(
        self, _msg: RegistrationCommandMessage, _websocket: object
    ) -> None:
        self.registration_command_count += 1
        if self._slow_registration_command:
            time.sleep(SLOW_HANDLER_SLEEP_S)

    def start(self) -> None:
        self._thread.start()
        self._server = ARWebSocketServer(
            port=self.port,
            hello_supplier=_sample_handshake,
            max_message_bytes=1_048_576,
            loop=self.loop,
            on_get_status=self._on_get_status,
            on_registration_command=self._on_registration_command,
            on_status_connect=self._on_status_connect,
        )
        self._server.start()

    def stop(self) -> None:
        if self._server is not None:
            self._server.stop()
            self._server = None
        time.sleep(0.1)
        if self.loop.is_running():
            self.loop.call_soon_threadsafe(self.loop.stop)
        self._thread.join(timeout=5.0)


@pytest.fixture
def handshake_server() -> Iterator[HandshakeServerHarness]:
    harness = HandshakeServerHarness()
    harness.start()
    try:
        yield harness
    finally:
        harness.stop()


@pytest.fixture
def handshake_server_no_connect_snapshot() -> Iterator[HandshakeServerHarness]:
    harness = HandshakeServerHarness(send_snapshot_on_connect=False)
    harness.start()
    try:
        yield harness
    finally:
        harness.stop()


@pytest.fixture
def slow_status_connect_server() -> Iterator[HandshakeServerHarness]:
    harness = HandshakeServerHarness(
        slow_status_connect=True,
        send_snapshot_on_connect=False,
    )
    harness.start()
    try:
        yield harness
    finally:
        harness.stop()


@pytest.fixture
def slow_registration_command_server() -> Iterator[HandshakeServerHarness]:
    harness = HandshakeServerHarness(
        slow_registration_command=True,
        send_snapshot_on_connect=False,
    )
    harness.start()
    try:
        yield harness
    finally:
        harness.stop()


@pytest.mark.asyncio
async def test_connect_receives_hello_before_timeout(
    handshake_server: HandshakeServerHarness,
) -> None:
    url = f"ws://127.0.0.1:{handshake_server.port}"
    async with websockets.connect(url, open_timeout=HELLO_TIMEOUT_S) as ws:
        raw = await asyncio.wait_for(ws.recv(), timeout=HELLO_TIMEOUT_S)
        msg = json.loads(raw)
        assert msg["type"] == "hello"
        assert msg["protocol_version"] == PROTOCOL_VERSION


@pytest.mark.asyncio
async def test_get_status_returns_runtime_snapshot(
    handshake_server_no_connect_snapshot: HandshakeServerHarness,
) -> None:
    harness = handshake_server_no_connect_snapshot
    url = f"ws://127.0.0.1:{harness.port}"
    async with websockets.connect(url, open_timeout=HELLO_TIMEOUT_S) as ws:
        hello_raw = await asyncio.wait_for(ws.recv(), timeout=HELLO_TIMEOUT_S)
        assert json.loads(hello_raw)["type"] == "hello"

        await ws.send('{"type":"get_status","ts":1.0,"robot_id":"unitree_go2"}\n')
        deadline = time.monotonic() + HELLO_TIMEOUT_S
        while time.monotonic() < deadline:
            raw = await asyncio.wait_for(ws.recv(), timeout=HELLO_TIMEOUT_S)
            msg = json.loads(raw)
            if msg["type"] == "runtime_snapshot" and harness.get_status_replies >= 1:
                assert msg["robot_id"] == "unitree_go2"
                assert msg["nav"]["phase"] == "idle"
                return
        pytest.fail("did not receive runtime_snapshot after get_status")


@pytest.mark.asyncio
async def test_slow_status_connect_does_not_block_hello(
    slow_status_connect_server: HandshakeServerHarness,
) -> None:
    url = f"ws://127.0.0.1:{slow_status_connect_server.port}"
    started = time.monotonic()
    async with websockets.connect(url, open_timeout=HELLO_TIMEOUT_S) as ws:
        raw = await asyncio.wait_for(ws.recv(), timeout=HELLO_TIMEOUT_S)
        elapsed = time.monotonic() - started
    msg = json.loads(raw)
    assert msg["type"] == "hello"
    assert elapsed < SLOW_HANDLER_SLEEP_S


@pytest.mark.asyncio
async def test_slow_registration_command_does_not_block_ping(
    slow_registration_command_server: HandshakeServerHarness,
) -> None:
    harness = slow_registration_command_server
    url = f"ws://127.0.0.1:{harness.port}"
    async with websockets.connect(url, open_timeout=HELLO_TIMEOUT_S) as ws:
        hello_raw = await asyncio.wait_for(ws.recv(), timeout=HELLO_TIMEOUT_S)
        assert json.loads(hello_raw)["type"] == "hello"

        await ws.send(
            '{"type":"registration_command","ts":1.0,"robot_id":"unitree_go2",'
            '"command":"start","mode":"april_odom_baseline"}\n'
        )
        ping_ts = 42.0
        await ws.send(
            f'{{"type":"ping","ts":1.0,"robot_id":"unitree_go2","client_ts":{ping_ts}}}\n'
        )

        started = time.monotonic()
        pong_raw = await asyncio.wait_for(ws.recv(), timeout=HELLO_TIMEOUT_S)
        elapsed = time.monotonic() - started
        pong = json.loads(pong_raw)
        assert pong["type"] == "pong"
        assert pong["client_ts"] == ping_ts
        assert elapsed < 0.1

    assert harness.registration_command_count == 1


@pytest.mark.asyncio
async def test_slow_registration_command_does_not_block_get_status(
    slow_registration_command_server: HandshakeServerHarness,
) -> None:
    harness = slow_registration_command_server
    url = f"ws://127.0.0.1:{harness.port}"
    async with websockets.connect(url, open_timeout=HELLO_TIMEOUT_S) as ws:
        hello_raw = await asyncio.wait_for(ws.recv(), timeout=HELLO_TIMEOUT_S)
        assert json.loads(hello_raw)["type"] == "hello"

        await ws.send(
            '{"type":"registration_command","ts":1.0,"robot_id":"unitree_go2",'
            '"command":"start","mode":"april_odom_baseline"}\n'
        )
        await ws.send('{"type":"get_status","ts":2.0,"robot_id":"unitree_go2"}\n')

        started = time.monotonic()
        raw = await asyncio.wait_for(ws.recv(), timeout=HELLO_TIMEOUT_S)
        elapsed = time.monotonic() - started
        msg = json.loads(raw)
        assert msg["type"] == "runtime_snapshot"
        assert elapsed < 0.1

    assert harness.registration_command_count == 1
    assert harness.get_status_replies == 1


@pytest.mark.asyncio
async def test_same_remote_reconnect_closes_prior_connection(
    handshake_server: HandshakeServerHarness,
) -> None:
    harness = handshake_server
    url = f"ws://127.0.0.1:{harness.port}"
    first = await websockets.connect(url, open_timeout=HELLO_TIMEOUT_S)
    try:
        first_hello = json.loads(await asyncio.wait_for(first.recv(), timeout=HELLO_TIMEOUT_S))
        assert first_hello["type"] == "hello"
        assert harness._server is not None
        assert harness._server.connection_count == 1

        second = await websockets.connect(url, open_timeout=HELLO_TIMEOUT_S)
        try:
            second_hello = json.loads(
                await asyncio.wait_for(second.recv(), timeout=HELLO_TIMEOUT_S)
            )
            assert second_hello["type"] == "hello"
            assert harness._server.connection_count == 1

            await asyncio.wait_for(first.wait_closed(), timeout=HELLO_TIMEOUT_S)
            assert first.close_code == 1000
        finally:
            await second.close()
    finally:
        if first.state.name != "CLOSED":
            await first.close()
        await first.wait_closed()
