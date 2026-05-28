"""Live WebSocket integration tests against a running ARBridge."""

from __future__ import annotations

import asyncio
import json
import os
import time

import pytest
import websockets

WS_URL = os.environ.get("DIMOS_AR_WS_URL", "ws://127.0.0.1:8765")
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


async def _collect_m1_protocol_messages() -> dict[str, int]:
    seen: dict[str, int] = {"hello": 0, "lidar": 0, "pose": 0, "registered": 0}
    async with await _connect_with_retry() as ws:
        deadline = time.monotonic() + TIMEOUT_S
        while time.monotonic() < deadline:
            raw = await asyncio.wait_for(ws.recv(), timeout=15.0)
            msg = json.loads(raw)
            msg_type = msg.get("type")
            if msg_type == "hello" and seen["hello"] == 0:
                assert msg.get("protocol_version") == 1
                assert "lidar" in msg.get("capabilities", [])
                assert "odom" in msg.get("capabilities", [])
                assert "align" in msg.get("capabilities", [])
                register = {
                    "type": "register",
                    "ts": time.time(),
                    "robot_id": "go2",
                    "marker_id": 0,
                    "marker_position": [0.0, 0.0, 0.0],
                    "marker_orientation": [0.0, 0.0, 0.0, 1.0],
                }
                await ws.send(json.dumps(register))
            if msg_type in seen:
                seen[msg_type] += 1
            if seen["registered"] >= 1 and seen["lidar"] >= 2 and seen["pose"] >= 2:
                break
    return seen


@pytest.mark.integration
@pytest.mark.asyncio
async def test_arbridge_m1_protocol_live() -> None:
    """Requires ARBridge running (e.g. blueprints/go2_ar_basic.py in replay mode)."""
    seen = await _collect_m1_protocol_messages()
    assert seen["hello"] >= 1
    assert seen["lidar"] >= 2
    assert seen["pose"] >= 2
    assert seen["registered"] >= 1
