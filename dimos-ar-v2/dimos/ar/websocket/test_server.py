from __future__ import annotations

import asyncio
import inspect
import json
import socket
import threading

import pytest
import websockets

from dimos.ar.websocket.protocol import (
    Capability,
    CapabilityName,
    HelloBody,
    LocalizationStartRequest,
    NavGoalRequest,
    RobotDescription,
)
from dimos.ar.websocket.server import WebSocketServer, split_inbound_text_lines


def _pick_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _sample_hello(_client_id: str) -> HelloBody:
    return HelloBody(
        robot=RobotDescription(
            display_name="Unitree Go2",
            body_bounds_m=(0.7, 0.5, 0.55),
            footprint_m=(0.7, 0.5),
            base_height_m=0.33,
        ),
        capabilities={
            CapabilityName.LIDAR: Capability(available=True, reason=None),
            CapabilityName.NAVIGATION: Capability(available=True, reason=None),
            CapabilityName.LOCALIZATION: Capability(available=True, reason=None),
            CapabilityName.ESTOP: Capability(available=True, reason=None),
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

    def _on_localization_start_request(self, _msg: LocalizationStartRequest, client_id: str) -> None:
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


@pytest.mark.asyncio
async def test_connect_receives_hello_after_hello_request(harness: ServerHarness) -> None:
    async with websockets.connect(f"ws://127.0.0.1:{harness.port}/ws") as ws:
        msg = await _send_hello_request(ws, ts_client=42.0)
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

