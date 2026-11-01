from __future__ import annotations

import asyncio
import json
from unittest.mock import Mock

import pytest

from dimos.ar import timing_diagnostics
from dimos.ar.websocket.send_queue import (
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


@pytest.mark.asyncio
async def test_send_timing_reports_backpressure_without_silent_drops(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = [100.0]
    monkeypatch.setattr(timing_diagnostics.time, "monotonic", lambda: now[0])
    logger = Mock()
    monkeypatch.setattr(timing_diagnostics, "logger", logger)

    class SlowWebSocket(_FakeWebSocket):
        async def send(self, payload: str | bytes) -> None:
            now[0] += 0.25
            await super().send(payload)

    outbound = ClientSendQueue(SlowWebSocket())
    for _ in range(OUTBOUND_FIFO_MAXSIZE):
        outbound.enqueue('{"type":"hello"}\n')
    now[0] += 30
    await outbound._send_text("test")
    fields = logger.info.call_args.kwargs
    assert fields["send_max_ms"] == 250
    assert fields["slow_sends"] == 1
    assert fields["dropped_fifo"] == 0
    now[0] += 30
    await outbound._send_binary(b"test")
    assert logger.info.call_args.kwargs["dropped_fifo"] == 0


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


@pytest.mark.asyncio
async def test_outbound_coalesces_pose_nav_goal_state() -> None:
    ws = _FakeWebSocket()
    outbound = ClientSendQueue(ws)  # type: ignore[arg-type]
    outbound.start()

    outbound.enqueue('{"type":"state","nav":{"state":"idle"}}\n')
    outbound.enqueue('{"type":"pose","position":[1,2,3]}\n')
    outbound.enqueue('{"type":"pose","position":[4,5,6]}\n')
    outbound.enqueue('{"type":"nav_goal","pose":[0,0,0,0],"path_poses":[[0,0,0,0]]}\n')

    await asyncio.sleep(0.05)
    await outbound.stop()

    assert len(ws.sent_text) == 1
    by_type = {msg["type"]: msg for msg in _messages_from_sent(ws.sent_text)}
    assert by_type["pose"]["position"] == [4, 5, 6]
    assert by_type["nav_goal"]["path_poses"] == [[0, 0, 0, 0]]
    assert by_type["state"]["nav"]["state"] == "idle"


@pytest.mark.asyncio
async def test_outbound_interleaves_fifo_before_coalesced() -> None:
    ws = _FakeWebSocket()
    outbound = ClientSendQueue(ws)  # type: ignore[arg-type]
    outbound.start()

    outbound.enqueue('{"type":"hello","client_id":"a"}\n')
    outbound.enqueue('{"type":"pose","position":[1,1,1]}\n')
    outbound.enqueue('{"type":"hello","client_id":"b"}\n')
    outbound.enqueue('{"type":"nav_goal","pose":[1,2,3,0],"path_poses":[[1,2,3,0]]}\n')

    await asyncio.sleep(0.05)
    await outbound.stop()

    messages = _messages_from_sent(ws.sent_text)
    types = [msg["type"] for msg in messages]
    assert types[0] == "hello"
    assert types.count("hello") == 2
    assert "pose" in types
    assert "nav_goal" in types


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
async def test_outbound_overflow_retires_connection_without_dropping_an_old_reply() -> None:
    ws = _FakeWebSocket()
    failures: list[str] = []
    outbound = ClientSendQueue(ws, on_failure=failures.append)  # type: ignore[arg-type]

    for index in range(OUTBOUND_FIFO_MAXSIZE + 5):
        outbound.enqueue(f'{{"type":"hello","seq":{index}}}\n')

    assert failures == ["outbound control queue overflow"]
    assert outbound.failure_reason == failures[0]
    assert outbound._queue.qsize() == OUTBOUND_FIFO_MAXSIZE
    assert json.loads(outbound._queue.get_nowait()[1])["seq"] == 0
    outbound.enqueue_binary(b"ignored")
    assert outbound._coalesce_latest_binary is None
    assert ws.sent_text == []


@pytest.mark.asyncio
@pytest.mark.parametrize("binary", [False, True])
async def test_blocked_send_is_bounded_and_retires_authority_once(binary: bool) -> None:
    class BlockedWebSocket(_FakeWebSocket):
        async def send(self, payload: str | bytes) -> None:
            await asyncio.Event().wait()

    failures: list[str] = []
    outbound = ClientSendQueue(
        BlockedWebSocket(), on_failure=failures.append, send_timeout_s=0.01
    )
    if binary:
        outbound.enqueue_binary(b"lidar")
    else:
        outbound.enqueue('{"type":"interaction_result"}\n')
    outbound.start()
    assert outbound._task is not None
    await asyncio.wait_for(outbound._task, 1)
    assert failures == ["outbound send timeout"]
    await outbound._send_text("later")
    await outbound.stop()
    assert failures == ["outbound send timeout"]


@pytest.mark.asyncio
async def test_failed_sender_does_not_leave_a_live_silent_connection() -> None:
    ws = _FakeWebSocket()
    ws.closed = True
    failures: list[str] = []
    outbound = ClientSendQueue(ws, on_failure=failures.append)
    outbound.enqueue('{"type":"interaction_result"}\n')
    outbound.start()
    assert outbound._task is not None
    await asyncio.wait_for(outbound._task, 1)
    assert failures == ["outbound send failed"]


@pytest.mark.asyncio
@pytest.mark.parametrize("domain", ["interaction", "manipulation"])
async def test_interaction_snapshots_coalesce_but_decisions_remain_fifo(domain: str) -> None:
    ws = _FakeWebSocket()
    outbound = ClientSendQueue(ws)
    for revision in [1, 2, 3]:
        outbound.enqueue(json.dumps({"type": f"{domain}_state", "revision": revision}) + "\n")
        outbound.enqueue(json.dumps({"type": f"{domain}_result", "request_id": str(revision)}) + "\n")
    outbound.start()
    await asyncio.sleep(0.01)
    await outbound.stop()
    frames = _messages_from_sent(ws.sent_text)
    assert [f["request_id"] for f in frames if f["type"] == f"{domain}_result"] == ["1", "2", "3"]
    assert [f["revision"] for f in frames if f["type"] == f"{domain}_state"] == [3]


@pytest.mark.asyncio
@pytest.mark.parametrize("preview_first", [True, False])
async def test_preview_reply_never_coalesces_with_active_goal(preview_first: bool) -> None:
    websocket = _FakeWebSocket()
    queue = ClientSendQueue(websocket)
    active = {"type": "nav_goal", "path_poses": [[1, 2, 0, 0]], "pose": [1, 2, 0, 0], "ts": 1}
    preview = {"type": "nav_goal", "preview": True, "preview_id": "aim", "path_poses": [], "ts": 2}
    frames = [preview, active] if preview_first else [active, preview]
    for frame in frames:
        queue.enqueue(json.dumps(frame) + "\n")
    queue.start()
    await asyncio.sleep(0)
    await queue.stop()
    assert sorted(_messages_from_sent(websocket.sent_text), key=lambda msg: msg["ts"]) == [
        active,
        preview,
    ]
