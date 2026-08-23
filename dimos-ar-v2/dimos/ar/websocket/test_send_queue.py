from __future__ import annotations

import asyncio
import json

import pytest

from dimos.ar.websocket.send_queue import (
    COALESCE_FRAME_TYPES,
    OUTBOUND_FIFO_MAXSIZE,
    ClientSendQueue,
    peek_frame_type,
)


class _FakeWebSocket:
    def __init__(self) -> None:
        self.sent_text: list[str] = []
        self.sent_binary: list[bytes] = []
        self.closed = False

    async def send(self, payload: str | bytes) -> None:
        if self.closed:
            raise ConnectionError("closed")
        if isinstance(payload, bytes):
            self.sent_binary.append(payload)
        else:
            self.sent_text.append(payload)


def _messages_from_sent(sent: list[str]) -> list[dict]:
    messages: list[dict] = []
    for chunk in sent:
        for line in chunk.split("\n"):
            if line.strip():
                messages.append(json.loads(line))
    return messages


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ('{"type":"pose","position":[1,2,3]}\n', "pose"),
        ('{"type":"state","nav":{"state":"idle"}}\n', "state"),
        ("not json", None),
    ],
)
def test_peek_frame_type(payload: str, expected: str | None) -> None:
    assert peek_frame_type(payload) == expected


def test_coalesce_frame_types_match_state_streams() -> None:
    assert COALESCE_FRAME_TYPES == frozenset({"pose", "path", "state", "localization"})


@pytest.mark.asyncio
async def test_outbound_coalesces_pose_path_state() -> None:
    ws = _FakeWebSocket()
    outbound = ClientSendQueue(ws)  # type: ignore[arg-type]
    outbound.start()

    outbound.enqueue('{"type":"state","nav":{"state":"idle"}}\n')
    outbound.enqueue('{"type":"pose","position":[1,2,3]}\n')
    outbound.enqueue('{"type":"pose","position":[4,5,6]}\n')
    outbound.enqueue('{"type":"path","points":[[0,0,0]]}\n')

    await asyncio.sleep(0.05)
    await outbound.stop()

    assert len(ws.sent_text) == 1
    by_type = {msg["type"]: msg for msg in _messages_from_sent(ws.sent_text)}
    assert by_type["pose"]["position"] == [4, 5, 6]
    assert by_type["path"]["points"] == [[0, 0, 0]]
    assert by_type["state"]["nav"]["state"] == "idle"


@pytest.mark.asyncio
async def test_outbound_interleaves_fifo_before_coalesced() -> None:
    ws = _FakeWebSocket()
    outbound = ClientSendQueue(ws)  # type: ignore[arg-type]
    outbound.start()

    outbound.enqueue('{"type":"hello","client_id":"a"}\n')
    outbound.enqueue('{"type":"pose","position":[1,1,1]}\n')
    outbound.enqueue('{"type":"hello","client_id":"b"}\n')
    outbound.enqueue('{"type":"path","points":[[1,2,3]]}\n')

    await asyncio.sleep(0.05)
    await outbound.stop()

    messages = _messages_from_sent(ws.sent_text)
    types = [msg["type"] for msg in messages]
    assert types[0] == "hello"
    assert types.count("hello") == 2
    assert "pose" in types
    assert "path" in types


@pytest.mark.asyncio
async def test_outbound_coalesces_binary_lidar() -> None:
    ws = _FakeWebSocket()
    outbound = ClientSendQueue(ws)  # type: ignore[arg-type]
    outbound.start()

    outbound.enqueue_binary(b"LDAR-old")
    outbound.enqueue_binary(b"LDAR-new")

    await asyncio.sleep(0.05)
    await outbound.stop()

    assert ws.sent_binary == [b"LDAR-new"]


@pytest.mark.asyncio
async def test_outbound_drops_oldest_fifo_when_full() -> None:
    ws = _FakeWebSocket()
    outbound = ClientSendQueue(ws)  # type: ignore[arg-type]
    outbound.start()

    for index in range(OUTBOUND_FIFO_MAXSIZE + 5):
        outbound.enqueue(f'{{"type":"hello","seq":{index}}}\n')

    await asyncio.sleep(0.1)
    await outbound.stop()

    assert outbound._dropped_fifo_count >= 5
    first_seq = json.loads(ws.sent_text[0])["seq"]
    assert first_seq >= 5
