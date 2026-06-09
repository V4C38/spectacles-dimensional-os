from __future__ import annotations

import asyncio
import json

import pytest

from dimos_xr.websocket_server import (
    COALESCE_MESSAGE_TYPES,
    _ConnectionOutbound,
    _peek_message_type,
)


class _FakeWebSocket:
    def __init__(self) -> None:
        self.sent: list[str] = []
        self.closed = False

    async def send(self, text: str) -> None:
        if self.closed:
            raise ConnectionError("closed")
        self.sent.append(text)


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ('{"type":"lidar","points_flat":[1]}', "lidar"),
        ('{"type":"nav_status","state":"idle"}', "nav_status"),
        ("not json", None),
    ],
)
def test_peek_message_type(payload: str, expected: str | None) -> None:
    assert _peek_message_type(payload) == expected


@pytest.mark.asyncio
async def test_outbound_preserves_critical_order() -> None:
    ws = _FakeWebSocket()
    outbound = _ConnectionOutbound(ws)  # type: ignore[arg-type]
    outbound.start()

    outbound.enqueue('{"type":"nav_status","state":"idle"}')
    outbound.enqueue('{"type":"path","waypoints":[[1,2,3]]}')
    outbound.enqueue('{"type":"bridge_status","registered":true}')

    await asyncio.sleep(0.05)
    await outbound.stop()

    types = [_peek_message_type(text) for text in ws.sent]
    assert types == ["nav_status", "path", "bridge_status"]


@pytest.mark.asyncio
async def test_outbound_coalesces_pose_and_lidar() -> None:
    ws = _FakeWebSocket()
    outbound = _ConnectionOutbound(ws)  # type: ignore[arg-type]
    outbound.start()

    outbound.enqueue('{"type":"nav_status","state":"following_path"}')
    outbound.enqueue('{"type":"pose","position":[1,2,3]}')
    outbound.enqueue('{"type":"pose","position":[4,5,6]}')
    outbound.enqueue('{"type":"lidar","points_flat":[1,2,3]}')
    outbound.enqueue('{"type":"lidar","points_flat":[7,8,9]}')
    outbound.enqueue('{"type":"path","waypoints":[[0,0,0]]}')

    await asyncio.sleep(0.05)
    await outbound.stop()

    assert len(ws.sent) == 4
    assert _peek_message_type(ws.sent[0]) == "nav_status"
    by_type = {(_peek_message_type(text) or ""): json.loads(text) for text in ws.sent[1:]}
    assert by_type["pose"]["position"] == [4, 5, 6]
    assert by_type["lidar"]["points_flat"] == [7, 8, 9]
    assert by_type["path"]["waypoints"] == [[0, 0, 0]]


def test_coalesce_message_types_cover_streams() -> None:
    assert COALESCE_MESSAGE_TYPES == frozenset({"lidar", "pose"})
