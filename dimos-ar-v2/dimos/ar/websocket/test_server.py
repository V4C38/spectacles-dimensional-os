from __future__ import annotations

import asyncio
import json
import socket
import threading

import pytest
import websockets

from dimos.ar.websocket.protocol import (
    CapabilityWire,
    HelloRobotWire,
    HelloWire,
    NavGoalMessage,
)
from dimos.ar.websocket.server import WebSocketServer, split_inbound_text_lines


def _pick_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _sample_hello(client_id: str) -> HelloWire:
    return HelloWire(
        client_id=client_id,
        robot=HelloRobotWire(
            display_name="Unitree Go2",
            body_bounds_m=(0.7, 0.5, 0.55),
            footprint_m=(0.7, 0.5),
            base_height_m=0.33,
        ),
        requires_robot_in_view=False,
        capabilities={
            "lidar": CapabilityWire(available=True, reason=None),
            "navigation": CapabilityWire(available=True, reason=None),
            "estop": CapabilityWire(available=True, reason=None),
        },
    )


class ServerHarness:
    def __init__(self, **handler_kwargs: object) -> None:
        self.port = _pick_free_port()
        self.loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._server: WebSocketServer | None = None
        self.nav_goals: list[NavGoalMessage] = []
        self._handler_kwargs = handler_kwargs

    def _run_loop(self) -> None:
        asyncio.set_event_loop(self.loop)
        self.loop.run_forever()

    def _on_nav_goal(self, msg: NavGoalMessage, _websocket: object) -> None:
        self.nav_goals.append(msg)

    def start(self) -> None:
        self._thread.start()
        self._server = WebSocketServer(
            port=self.port,
            loop=self.loop,
            hello_supplier=_sample_hello,
            on_nav_goal=self._on_nav_goal,
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
    assert split_inbound_text_lines('{"type":"estop"}\n\n') == ['{"type":"estop"}']


@pytest.mark.asyncio
async def test_connect_receives_hello(harness: ServerHarness) -> None:
    async with websockets.connect(f"ws://127.0.0.1:{harness.port}/ws") as ws:
        raw = await asyncio.wait_for(ws.recv(), timeout=3.0)
        msg = json.loads(raw)
        assert msg["type"] == "hello"
        assert "client_id" in msg
        assert "protocol_version" not in msg


@pytest.mark.asyncio
async def test_time_sync_receives_time(harness: ServerHarness) -> None:
    async with websockets.connect(f"ws://127.0.0.1:{harness.port}/ws") as ws:
        await ws.recv()
        await ws.send(json.dumps({"type": "time_sync", "client_send_ts": 42.0}))
        raw = await asyncio.wait_for(ws.recv(), timeout=3.0)
        msg = json.loads(raw)
        assert msg["type"] == "time"
        assert msg["client_send_ts"] == 42.0
        assert msg["server_recv_ts"] <= msg["server_send_ts"]


@pytest.mark.asyncio
async def test_nav_goal_reaches_handler(harness: ServerHarness) -> None:
    async with websockets.connect(f"ws://127.0.0.1:{harness.port}/ws") as ws:
        await ws.recv()
        await ws.send(
            json.dumps({"type": "nav_goal", "position": [1.0, 2.0, 0.0]})
        )
        await asyncio.sleep(0.05)
    assert len(harness.nav_goals) == 1
    assert harness.nav_goals[0].position == (1.0, 2.0, 0.0)


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
