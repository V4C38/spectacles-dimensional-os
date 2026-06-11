from __future__ import annotations

import asyncio
import json
import struct

import pytest

from dimos_xr.tracking.tag_tracker import CAMERA_FRAME_MAGIC, parse_camera_frame
from dimos_xr.network.websocket_server import (
    COALESCE_MESSAGE_TYPES,
    OUTBOUND_FIFO_MAXSIZE,
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
async def test_outbound_coalesces_broadcast_snapshots() -> None:
    ws = _FakeWebSocket()
    outbound = _ConnectionOutbound(ws)  # type: ignore[arg-type]
    outbound.start()

    outbound.enqueue('{"type":"nav_status","state":"idle"}')
    outbound.enqueue('{"type":"path","waypoints":[[1,2,3]]}')
    outbound.enqueue('{"type":"bridge_status","registered":true}')
    outbound.enqueue('{"type":"nav_status","state":"following_path"}')

    await asyncio.sleep(0.05)
    await outbound.stop()

    by_type = {(_peek_message_type(text) or ""): json.loads(text) for text in ws.sent}
    assert by_type["nav_status"]["state"] == "following_path"
    assert by_type["path"]["waypoints"] == [[1, 2, 3]]
    assert by_type["bridge_status"]["registered"] is True
    assert len(ws.sent) == 3


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
    by_type = {(_peek_message_type(text) or ""): json.loads(text) for text in ws.sent}
    assert by_type["nav_status"]["state"] == "following_path"
    assert by_type["pose"]["position"] == [4, 5, 6]
    assert by_type["lidar"]["points_flat"] == [7, 8, 9]
    assert by_type["path"]["waypoints"] == [[0, 0, 0]]


@pytest.mark.asyncio
async def test_outbound_interleaves_coalesced_after_fifo() -> None:
    ws = _FakeWebSocket()
    outbound = _ConnectionOutbound(ws)  # type: ignore[arg-type]
    outbound.start()

    outbound.enqueue('{"type":"hello","protocol_version":2}')
    outbound.enqueue('{"type":"pose","position":[1,1,1]}')
    outbound.enqueue('{"type":"hello","protocol_version":3}')
    outbound.enqueue('{"type":"lidar","points_flat":[1]}')

    await asyncio.sleep(0.05)
    await outbound.stop()

    types = [_peek_message_type(text) for text in ws.sent]
    assert types[0] == "hello"
    assert types[1] in {"pose", "lidar"}
    assert "hello" in types
    assert "pose" in types
    assert "lidar" in types


@pytest.mark.asyncio
async def test_outbound_drops_oldest_fifo_when_full() -> None:
    ws = _FakeWebSocket()
    outbound = _ConnectionOutbound(ws)  # type: ignore[arg-type]
    outbound.start()

    for index in range(OUTBOUND_FIFO_MAXSIZE + 5):
        outbound.enqueue(f'{{"type":"hello","seq":{index}}}')

    await asyncio.sleep(0.1)
    await outbound.stop()

    assert outbound._dropped_fifo_count >= 5
    assert len(ws.sent) <= OUTBOUND_FIFO_MAXSIZE + 5
    first_seq = json.loads(ws.sent[0])["seq"]
    assert first_seq >= 5


def test_binary_camera_frame_parses_for_handler_dispatch() -> None:
    header = {
        "type": "camera_frame",
        "robot_id": "unitree_go2",
        "seq": 3,
        "ts": 1.0,
        "send_ts": 1.1,
        "cam_pos": [0.0, 0.0, 0.0],
        "cam_rot": [0.0, 0.0, 0.0, 1.0],
    }
    jpeg = b"\xff\xd8\xff\xd9"
    header_bytes = json.dumps(header, separators=(",", ":")).encode("utf-8")
    payload = CAMERA_FRAME_MAGIC + struct.pack("<I", len(header_bytes)) + header_bytes + jpeg
    parsed_header, parsed_jpeg = parse_camera_frame(payload)
    assert parsed_header["seq"] == 3
    assert parsed_jpeg == jpeg


def test_coalesce_message_types_cover_streams() -> None:
    assert COALESCE_MESSAGE_TYPES == frozenset(
        {
            "lidar",
            "pose",
            "path",
            "path_preview",
            "nav_status",
            "bridge_status",
            "align_status",
            "camera_frame_ack",
        }
    )
