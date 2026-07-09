from __future__ import annotations

import asyncio
import json
import struct

import pytest

from dimos.ar.network.protocol import decode_inbound
from dimos.ar.network.websocket_server import split_inbound_text_lines
from dimos.ar.network.ws_send_queue import (
    COALESCE_MESSAGE_TYPES,
    OUTBOUND_FIFO_MAXSIZE,
    ClientSendQueue,
    peek_message_type,
)
from dimos.ar.tag_tracking.solve import CAMERA_FRAME_MAGIC, parse_camera_frame


class _FakeWebSocket:
    def __init__(self) -> None:
        self.sent: list[str] = []
        self.closed = False

    async def send(self, text: str) -> None:
        if self.closed:
            raise ConnectionError("closed")
        self.sent.append(text)


def _messages_from_sent(sent: list[str]) -> list[dict]:
    messages: list[dict] = []
    for chunk in sent:
        for line in chunk.split("\n"):
            if line:
                messages.append(json.loads(line))
    return messages


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ('{"type":"lidar","points_flat":[1]}', "lidar"),
        ('{"type":"nav_status","phase":"idle"}', "nav_status"),
        ("not json", None),
    ],
)
def test_peek_message_type(payload: str, expected: str | None) -> None:
    assert peek_message_type(payload) == expected


@pytest.mark.asyncio
async def test_outbound_coalesces_broadcast_snapshots() -> None:
    ws = _FakeWebSocket()
    outbound = ClientSendQueue(ws)  # type: ignore[arg-type]
    outbound.start()

    outbound.enqueue('{"type":"nav_status","phase":"idle"}')
    outbound.enqueue('{"type":"path","waypoints":[[1,2,3]]}')
    outbound.enqueue('{"type":"bridge_status","world_frame_committed":true}')
    outbound.enqueue('{"type":"nav_status","phase":"navigating"}')

    await asyncio.sleep(0.05)
    await outbound.stop()

    by_type = {msg["type"]: msg for msg in _messages_from_sent(ws.sent)}
    assert by_type["nav_status"]["phase"] == "navigating"
    assert by_type["path"]["waypoints"] == [[1, 2, 3]]
    assert by_type["bridge_status"]["world_frame_committed"] is True
    assert len(ws.sent) == 1


@pytest.mark.asyncio
async def test_outbound_coalesces_pose_and_lidar() -> None:
    ws = _FakeWebSocket()
    outbound = ClientSendQueue(ws)  # type: ignore[arg-type]
    outbound.start()

    outbound.enqueue('{"type":"nav_status","phase":"navigating"}')
    outbound.enqueue('{"type":"pose","position":[1,2,3]}')
    outbound.enqueue('{"type":"pose","position":[4,5,6]}')
    outbound.enqueue('{"type":"lidar","points_flat":[1,2,3]}')
    outbound.enqueue('{"type":"lidar","points_flat":[7,8,9]}')
    outbound.enqueue('{"type":"path","waypoints":[[0,0,0]]}')

    await asyncio.sleep(0.05)
    await outbound.stop()

    assert len(ws.sent) == 1
    by_type = {msg["type"]: msg for msg in _messages_from_sent(ws.sent)}
    assert by_type["nav_status"]["phase"] == "navigating"
    assert by_type["pose"]["position"] == [4, 5, 6]
    assert by_type["lidar"]["points_flat"] == [7, 8, 9]
    assert by_type["path"]["waypoints"] == [[0, 0, 0]]


@pytest.mark.asyncio
async def test_outbound_interleaves_coalesced_after_fifo() -> None:
    ws = _FakeWebSocket()
    outbound = ClientSendQueue(ws)  # type: ignore[arg-type]
    outbound.start()

    outbound.enqueue('{"type":"hello","protocol_version":2}')
    outbound.enqueue('{"type":"pose","position":[1,1,1]}')
    outbound.enqueue('{"type":"hello","protocol_version":3}')
    outbound.enqueue('{"type":"lidar","points_flat":[1]}')

    await asyncio.sleep(0.05)
    await outbound.stop()

    messages = _messages_from_sent(ws.sent)
    types = [msg["type"] for msg in messages]
    assert types[0] == "hello"
    assert types[1] in {"pose", "lidar"}
    assert "hello" in types
    assert "pose" in types
    assert "lidar" in types


@pytest.mark.asyncio
async def test_outbound_drops_oldest_fifo_when_full() -> None:
    ws = _FakeWebSocket()
    outbound = ClientSendQueue(ws)  # type: ignore[arg-type]
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


def test_binary_camera_frame_parses_capture_ts_robot() -> None:
    header = {
        "type": "camera_frame",
        "robot_id": "unitree_go2",
        "seq": 3,
        "ts": 1.0,
        "send_ts": 1.1,
        "capture_ts_robot": 1.005,
        "cam_pos": [0.0, 0.0, 0.0],
        "cam_rot": [0.0, 0.0, 0.0, 1.0],
    }
    jpeg = b"\xff\xd8\xff\xd9"
    header_bytes = json.dumps(header, separators=(",", ":")).encode("utf-8")
    payload = CAMERA_FRAME_MAGIC + struct.pack("<I", len(header_bytes)) + header_bytes + jpeg
    parsed_header, parsed_jpeg = parse_camera_frame(payload)
    assert parsed_header["capture_ts_robot"] == 1.005
    assert parsed_header["seq"] == 3
    assert parsed_jpeg == jpeg


def test_binary_camera_frame_rejects_null_timestamp() -> None:
    header = {
        "type": "camera_frame",
        "robot_id": "unitree_go2",
        "seq": 3,
        "ts": None,
        "send_ts": 1.1,
        "cam_pos": [0.0, 0.0, 0.0],
        "cam_rot": [0.0, 0.0, 0.0, 1.0],
    }
    jpeg = b"\xff\xd8\xff\xd9"
    header_bytes = json.dumps(header, separators=(",", ":")).encode("utf-8")
    payload = CAMERA_FRAME_MAGIC + struct.pack("<I", len(header_bytes)) + header_bytes + jpeg
    with pytest.raises(ValueError, match="camera_frame invalid ts"):
        parse_camera_frame(payload)


def test_coalesce_message_types_cover_streams() -> None:
    assert COALESCE_MESSAGE_TYPES == frozenset(
        {
            "lidar",
            "pose",
            "path",
            "nav_status",
            "bridge_status",
            "registration_status",
            "runtime_snapshot",
        }
    )


@pytest.mark.asyncio
async def test_outbound_fifo_ack_before_coalesced_pose() -> None:
    ws = _FakeWebSocket()
    outbound = ClientSendQueue(ws)  # type: ignore[arg-type]
    outbound.start()

    outbound.enqueue('{"type":"pose","position":[1,2,3]}')
    outbound.enqueue('{"type":"camera_frame_ack","seq":7,"ts":1.0}')

    await asyncio.sleep(0.05)
    await outbound.stop()

    messages = _messages_from_sent(ws.sent)
    assert len(messages) == 2
    assert messages[0]["type"] == "camera_frame_ack"
    assert messages[0]["seq"] == 7
    assert messages[1]["type"] == "pose"


@pytest.mark.asyncio
async def test_outbound_coalesced_batch_single_send() -> None:
    ws = _FakeWebSocket()
    outbound = ClientSendQueue(ws)  # type: ignore[arg-type]
    outbound.start()

    outbound.enqueue('{"type":"pose","position":[1,2,3]}')
    outbound.enqueue('{"type":"nav_status","phase":"idle"}')
    outbound.enqueue('{"type":"bridge_status","world_frame_committed":true}')

    await asyncio.sleep(0.05)
    await outbound.stop()

    assert len(ws.sent) == 1
    messages = _messages_from_sent(ws.sent)
    assert [msg["type"] for msg in messages] == ["pose", "nav_status", "bridge_status"]


@pytest.mark.asyncio
async def test_terminal_registration_status_not_overwritten_by_non_terminal() -> None:
    """Terminal registration_status (succeeded/failed) must not be overwritten."""

    ws = _FakeWebSocket()
    outbound = ClientSendQueue(ws)  # type: ignore[arg-type]
    outbound.start()

    outbound.enqueue('{"type":"registration_status","phase":"succeeded","robot_id":"r"}')
    outbound.enqueue('{"type":"registration_status","phase":"scanning","robot_id":"r"}')

    await asyncio.sleep(0.05)
    await outbound.stop()

    statuses = [json.loads(t) for t in ws.sent if json.loads(t)["type"] == "registration_status"]
    assert statuses
    assert statuses[-1]["phase"] == "succeeded"


@pytest.mark.asyncio
async def test_terminal_failed_not_overwritten_by_non_terminal() -> None:
    ws = _FakeWebSocket()
    outbound = ClientSendQueue(ws)  # type: ignore[arg-type]
    outbound.start()

    outbound.enqueue('{"type":"registration_status","phase":"failed","robot_id":"r"}')
    outbound.enqueue('{"type":"registration_status","phase":"scanning","robot_id":"r"}')

    await asyncio.sleep(0.05)
    await outbound.stop()

    statuses = [json.loads(t) for t in ws.sent if json.loads(t)["type"] == "registration_status"]
    assert statuses
    assert statuses[-1]["phase"] == "failed"


@pytest.mark.asyncio
async def test_non_terminal_registration_status_can_be_overwritten() -> None:
    ws = _FakeWebSocket()
    outbound = ClientSendQueue(ws)  # type: ignore[arg-type]
    outbound.start()

    outbound.enqueue('{"type":"registration_status","phase":"scanning","robot_id":"r","v":1}')
    outbound.enqueue('{"type":"registration_status","phase":"editing","robot_id":"r","v":2}')

    await asyncio.sleep(0.05)
    await outbound.stop()

    statuses = [json.loads(t) for t in ws.sent if json.loads(t)["type"] == "registration_status"]
    assert len(statuses) == 1
    assert statuses[0]["phase"] == "editing"


@pytest.mark.asyncio
async def test_outbound_text_frames_are_newline_delimited() -> None:
    ws = _FakeWebSocket()
    outbound = ClientSendQueue(ws)  # type: ignore[arg-type]
    outbound.start()

    outbound.enqueue('{"type":"nav_status","phase":"idle"}')

    await asyncio.sleep(0.05)
    await outbound.stop()

    assert len(ws.sent) == 1
    assert ws.sent[0].endswith("\n")
    msg = json.loads(ws.sent[0].strip())
    assert msg["type"] == "nav_status"
    assert msg["phase"] == "idle"


def test_newline_framing_client_round_trip() -> None:
    """Simulate Lens line-split reassembly across fragmented callbacks."""
    buffer = ""
    messages: list[dict] = []
    for frame in (
        '{"type":"path","waypoints":[[1,2',
        ',3]]}\n{"type":"nav_status","phase":"idle"}\n',
    ):
        buffer += frame
        parts = buffer.split("\n")
        tail = parts.pop() if parts else ""
        for line in parts:
            if line:
                messages.append(json.loads(line))
        buffer = tail

    assert len(messages) == 2
    assert messages[0]["type"] == "path"
    assert messages[0]["waypoints"] == [[1, 2, 3]]
    assert messages[1]["phase"] == "idle"


def test_split_inbound_text_lines_splits_concatenated_messages() -> None:
    stop = (
        '{"type":"registration_command","command":"stop","ts":1.0,"robot_id":"unitree_go2"}'
    )
    start = (
        '{"type":"registration_command","command":"start","mode":"manual_pose",'
        '"ts":2.0,"robot_id":"unitree_go2"}'
    )
    lines = split_inbound_text_lines(f"{stop}\n{start}\n")
    assert len(lines) == 2
    stop_msg = decode_inbound(lines[0])
    start_msg = decode_inbound(lines[1])
    assert stop_msg.command == "stop"
    assert start_msg.command == "start"
    assert start_msg.mode == "manual_pose"
