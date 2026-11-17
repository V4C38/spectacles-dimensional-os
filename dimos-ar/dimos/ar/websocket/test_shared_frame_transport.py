"""Spatial messages keep their creation frame across asynchronous transport work."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest
import websockets

from dimos.ar.websocket.bulk import BulkPeer, TokenBucket
from dimos.ar.websocket.send_queue import ClientSendQueue
from test_support.websocket import ServerHarness, _send_hello_request


@pytest.mark.asyncio
async def test_lidar_frame_stays_with_inflight_payload_during_root_adoption() -> None:
    records: list[str | bytes] = []
    first_header = asyncio.Event()
    continue_transfer = asyncio.Event()
    complete = asyncio.Event()
    old_payload, new_payload = b"a" * 20_000, b"b" * 20

    class Socket:
        async def send(self, record: str | bytes) -> None:
            records.append(record)
            if len(records) == 1:
                first_header.set()
                await continue_transfer.wait()
            if isinstance(record, bytes) and record[12:] == new_payload:
                complete.set()

    peer = BulkPeer(Socket(), "transport", TokenBucket(1e9, 1e9), lambda: 1, lambda: False)
    peer.lidar(old_payload, shared_frame_id="session-map")
    task = asyncio.create_task(peer.run())
    try:
        await asyncio.wait_for(first_header.wait(), 1)
        # Adoption occurs while the old transfer is suspended between header and chunks.
        peer.lidar(new_payload, shared_frame_id="vps-map")
        continue_transfer.set()
        await asyncio.wait_for(complete.wait(), 1)
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    headers = [json.loads(record) for record in records if isinstance(record, str)]
    assert [header["shared_frame_id"] for header in headers] == ["session-map", "vps-map"]
    payloads: dict[int, bytearray] = {}
    for record in records:
        if isinstance(record, str):
            identity = json.loads(record)["id"]
            payloads[identity] = bytearray()
        else:
            identity = int.from_bytes(record[4:8], "little")
            payloads[identity].extend(record[12:])
    assert [bytes(payloads[header["id"]]) for header in headers] == [old_payload, new_payload]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["client_pose", "nav_goal_request", "interaction_request"])
async def test_retired_spatial_requests_are_rejected_without_retiring_control(kind: str) -> None:
    context = {"shared_frame_id": "session-map", "odom_reference_id": "test-odom"}
    poses: list[Any] = []
    interactions: list[Any] = []
    harness = ServerHarness(
        presence_context=lambda: dict(context),
        on_client_pose=lambda request, *_: poses.append(request),
        on_interaction_request=lambda request, *_: interactions.append(request),
    )
    harness._handler_kwargs["on_state_request"] = lambda _request, socket: (
        harness._server.schedule_send_to(socket, '{"type":"agent_message","text":"barrier"}\n')
    )
    harness.start()
    try:
        async with websockets.connect(f"ws://127.0.0.1:{harness.port}") as control:
            await _send_hello_request(control)
            message: dict[str, Any] = {
                "type": kind,
                "position": [1, 2, 3],
                "orientation": [0, 0, 0, 1],
                "ts": 1,
            }
            if kind == "interaction_request":
                message.update(action="update", request_id="sample", epoch="authority",
                               lease_id="lease", sequence=1)

            async def barrier() -> None:
                await control.send('{"type":"state_request"}')
                while True:
                    reply = json.loads(await asyncio.wait_for(control.recv(), 1))
                    if reply.get("text") == "barrier":
                        return

            await control.send(json.dumps({**message, "shared_frame_id": "session-map"}))
            await barrier()
            accepted = poses if kind == "client_pose" else (
                interactions if kind == "interaction_request" else harness.nav_goal_requests
            )
            assert len(accepted) == 1

            # Mutate the authoritative context on its owning loop before sending old work.
            adopted = asyncio.run_coroutine_threadsafe(_adopt(context), harness.loop)
            await asyncio.wrap_future(adopted)
            await control.send(json.dumps({**message, "shared_frame_id": "session-map"}))
            await control.send(json.dumps(message))
            await barrier()
            assert len(accepted) == 1

            await control.send(json.dumps({**message, "shared_frame_id": "vps-map"}))
            await control.send('{"type":"localization_start_request"}')
            await barrier()
            assert len(accepted) == 2
            assert len(harness.localization_start_requests) == 1
    finally:
        harness.stop()


async def _adopt(context: dict[str, str]) -> None:
    context["shared_frame_id"] = "vps-map"


@pytest.mark.asyncio
async def test_root_transition_precedes_the_rebased_coalesced_snapshot() -> None:
    received: list[dict[str, Any]] = []
    snapshot_sent = asyncio.Event()

    class Socket:
        async def send(self, text: str) -> None:
            received.extend(json.loads(line) for line in text.splitlines())
            if any(frame["type"] == "interaction_state" for frame in received):
                snapshot_sent.set()

    queue = ClientSendQueue(Socket())  # type: ignore[arg-type]
    old = {"type": "interaction_state", "shared_frame_id": "session-map", "revision": 1}
    transition = {"type": "localization_context", "shared_frame_id": "vps-map"}
    updated = {**old, "shared_frame_id": "vps-map", "revision": 2}
    for frame in (old, transition, updated):
        queue.enqueue(json.dumps(frame) + "\n")
    queue.start()
    try:
        await asyncio.wait_for(snapshot_sent.wait(), 1)
        assert received == [transition, updated]
    finally:
        await queue.stop()
