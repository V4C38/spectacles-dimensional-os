"""Live WebSocket integration tests against a running XR bridge."""

from __future__ import annotations

import asyncio
import json
import os
import time

import pytest
import websockets

WS_URL = os.environ.get("DIMOS_AR_WS_URL", "ws://127.0.0.1:8787")
TIMEOUT_S = 60.0
CONNECT_RETRIES = 10
CONNECT_RETRY_DELAY_S = 1.0


async def _connect_with_retry() -> websockets.ClientConnection:
    last_error: Exception | None = None
    for attempt in range(CONNECT_RETRIES):
        try:
            return await websockets.connect(WS_URL, open_timeout=5)
        except (ConnectionRefusedError, OSError, websockets.exceptions.WebSocketException) as exc:
            last_error = exc
            if attempt + 1 < CONNECT_RETRIES:
                await asyncio.sleep(CONNECT_RETRY_DELAY_S)
    raise RuntimeError(
        f"Could not connect to {WS_URL} after {CONNECT_RETRIES} attempts",
    ) from last_error


async def _collect_protocol_messages() -> dict[str, int]:
    seen: dict[str, int] = {"hello": 0, "bridge_status": 0, "lidar": 0, "pose": 0}
    async with await _connect_with_retry() as ws:
        deadline = time.monotonic() + TIMEOUT_S
        while time.monotonic() < deadline:
            raw = await asyncio.wait_for(ws.recv(), timeout=15.0)
            msg = json.loads(raw)
            msg_type = msg.get("type")
            if msg_type == "hello" and seen["hello"] == 0:
                assert msg.get("protocol_version") == 3
                assert isinstance(msg.get("robot"), dict)
                caps = msg.get("capabilities", [])
                assert "lidar" in caps
                assert "odom" in caps
                assert "align" in caps
                assert "nav" in caps
                assert "path" in caps
                assert "emergency_stop" in caps
            if msg_type in seen:
                seen[msg_type] += 1
            if (
                seen["hello"] >= 1
                and seen["bridge_status"] >= 1
                and seen["lidar"] >= 2
                and seen["pose"] >= 2
            ):
                break
    return seen


@pytest.mark.integration
@pytest.mark.asyncio
async def test_arbridge_protocol_live() -> None:
    """Requires XR bridge running (e.g. blueprints/dimos.ar.py)."""
    seen = await _collect_protocol_messages()
    assert seen["hello"] >= 1
    assert seen["bridge_status"] >= 1
    assert seen["lidar"] >= 2
    assert seen["pose"] >= 2


@pytest.mark.integration
@pytest.mark.asyncio
async def test_arbridge_accepts_camera_info() -> None:
    """Requires XR bridge running (e.g. blueprints/dimos.ar.py)."""
    async with await _connect_with_retry() as ws:
        await ws.recv()
        await ws.recv()
        await ws.send(
            json.dumps(
                {
                    "type": "camera_info",
                    "ts": time.time(),
                    "robot_id": "unitree_go2",
                    "width": 3200,
                    "height": 2400,
                    "fx": 1800.0,
                    "fy": 1800.0,
                    "cx": 1600.0,
                    "cy": 1200.0,
                    "distortion": [],
                    "camera_model": "pinhole",
                    "device_model": "spectacles",
                }
            )
        )
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline:
            raw = await asyncio.wait_for(ws.recv(), timeout=2.0)
            msg = json.loads(raw)
            if msg.get("type") in {"pose", "lidar", "bridge_status"}:
                break
