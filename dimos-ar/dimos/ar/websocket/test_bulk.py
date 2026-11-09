from __future__ import annotations

import asyncio
from contextlib import AsyncExitStack
import json
import time

import pytest
import websockets

from dimos.ar.websocket.bulk import (
    CHUNK_BYTES,
    BulkAssetStore,
    BulkPeer,
    BulkUpload,
    TokenBucket,
    binary_chunks,
)
from test_support.websocket import (
    TYPESCRIPT_LOCA_ONE,
    ServerHarness,
    _encode_localization_observations_frame,
    _send_hello_request,
)


def _plan(count: int = 8192) -> dict:
    return {"plan_id": "checked-1", "group_id": "arm", "target_revision": 7,
            "joint_names": [f"j{i}" for i in range(24)], "duration": count / 100,
            "trajectory": [{"time": i / 100, "positions": [i / 10000] * 24}
                           for i in range(count)]}


def test_maximum_trajectory_is_incremental_and_not_repeated_in_control() -> None:
    store = BulkAssetStore()
    plan = _plan()
    compact = store.compact({"type": "manipulation_state", "plan": plan})
    assert "plan" not in compact
    assert len(json.dumps(compact)) < 1024
    asset = store.get("trajectory", compact["plan_ref"])
    assert asset is not None
    assert all(len(part.encode()) <= CHUNK_BYTES for part in asset.records)
    assert sum(len(json.loads(part)["data"].get("points", [])) for part in asset.records) == 8192
    assert store.compact({"plan": plan})["plan_ref"] == compact["plan_ref"]
    assert store.get("trajectory", compact["plan_ref"]) is asset
    assert store.get("trajectory", {**compact["plan_ref"], "epoch": "retired"}) is None


def test_model_and_nested_routes_use_revision_references() -> None:
    store = BulkAssetStore()
    model = {"revision": "model-1", "root": "base", "links": [{"name": "base"}], "joints": []}
    result = store.compact({"model": model, "preview": {"type": "nav_goal", "path_poses": [[1, 2, 3, 4]], "ts": 1}})
    assert "model" not in result
    assert "path_poses" not in result["preview"]
    assert store.get("model", result["model_ref"]) is not None
    assert store.get("route", result["preview"]["route_ref"]) is not None


def test_active_model_stays_fetchable_after_many_plans_and_routes() -> None:
    store = BulkAssetStore()
    compact = store.compact({"model": {"revision": "unchanged", "links": [], "joints": []}})
    for index in range(70):
        plan = _plan(3)
        plan["plan_id"] = f"plan-{index}"
        store.compact({"plan": plan, "active_goal": {"path_poses": [[index, 0, 0, 0]], "ts": index}})
    assert len(store._assets) <= 32
    assert store.get("model", compact["model_ref"]) is not None


def test_repromoted_cached_route_is_pinned_during_preview_churn() -> None:
    store = BulkAssetStore()
    original = {"path_poses": [[0, 0, 0, 0]], "ts": 1}
    ref = store.compact(original)["route_ref"]
    store.compact({"path_poses": [[1, 1, 0, 0]], "ts": 2})
    store.compact(original)
    for index in range(50):
        store.compact({"path_poses": [[index, 1, 0, 0]], "ts": index, "preview": True})
    assert store.get("route", ref) is not None


def test_bulk_upload_rejects_reordering_oversize_and_expiry(monkeypatch) -> None:
    data = b"x" * 40_000
    chunks = list(binary_chunks(5, data))
    assert all(len(chunk) <= CHUNK_BYTES for chunk in chunks)
    upload = BulkUpload(5, len(data))
    assert upload.append(chunks[0]) is None
    with pytest.raises(ValueError, match="offset"):
        upload.append(chunks[0])
    assert upload.append(chunks[1]) is None
    assert upload.append(chunks[2]) == data
    with pytest.raises(ValueError):
        BulkUpload(1, 4_194_305)
    expired = BulkUpload(5, len(data))
    monkeypatch.setattr("dimos.ar.websocket.bulk.time.monotonic", lambda: expired.started + 16)
    with pytest.raises(ValueError, match="expired"):
        expired.append(chunks[0])


async def _attach(stack: AsyncExitStack, harness: ServerHarness, hello: dict):
    bulk = await stack.enter_async_context(websockets.connect(f"ws://127.0.0.1:{harness.port}{hello['bulk_url']}"))
    await bulk.send(json.dumps({"type": "bulk_hello_request", "protocol_version": 2,
                               "client_id": hello["client_id"], "token": hello["bulk_token"]}))
    ready = json.loads(await asyncio.wait_for(bulk.recv(), 1))
    assert ready["epoch"] == hello["bulk_epoch"]
    return bulk


async def _capture(harness: ServerHarness, control, hello: dict) -> str:
    harness._server.schedule_send_to_client(hello["client_id"], json.dumps({
        "type": "localization_observations_request", "capture_policy": "any_angle", "observation_count": 1}) + "\n")
    while True:
        request = json.loads(await control.recv())
        if request["type"] == "localization_observations_request":
            return request["capture_id"]


@pytest.mark.asyncio
async def test_bulk_pairing_never_counts_as_control_and_stale_tokens_cannot_reattach() -> None:
    h = ServerHarness()
    h.start()
    try:
        async with AsyncExitStack() as stack:
            control = await stack.enter_async_context(websockets.connect(f"ws://127.0.0.1:{h.port}/ws"))
            hello = await _send_hello_request(control)
            bulk = await _attach(stack, h, hello)
            assert h._server.connection_count == 1
            assert not control.protocol.extensions
            await bulk.close()
            assert h._server.connection_count == 1
            await control.close()
        async with websockets.connect(f"ws://127.0.0.1:{h.port}/ws/bulk") as stale:
            await stale.send(json.dumps({"type": "bulk_hello_request", "protocol_version": 2,
                                        "client_id": hello["client_id"], "token": hello["bulk_token"]}))
            with pytest.raises(websockets.ConnectionClosed):
                await stale.recv()
        assert h._server.connection_count == 0
    finally:
        h.stop()


@pytest.mark.asyncio
async def test_five_peers_keep_controls_live_during_trajectory_and_jpeg_bulk() -> None:
    uploads = []
    h = ServerHarness(on_localization_observations=lambda observations, client, _sync: uploads.append(client))
    h._handler_kwargs["on_state_request"] = lambda _request, socket: h._server.schedule_send_to(
        socket, '{"type":"agent_message","text":"ack"}\n')
    h.start()
    try:
        async with AsyncExitStack() as stack:
            controls, bulks, hellos = [], [], []
            for _ in range(5):
                control = await stack.enter_async_context(websockets.connect(f"ws://127.0.0.1:{h.port}/ws"))
                hello = await _send_hello_request(control)
                controls.append(control)
                hellos.append(hello)
                bulks.append(await _attach(stack, h, hello))
            h._server.schedule_broadcast_text(json.dumps({"type": "manipulation_state", "plan": _plan()}) + "\n")
            # One receiver deliberately leaves its bulk socket unread. Control
            # acknowledgments still use five independent small bounded queues.
            for peer in controls:
                await peer.send('{"type":"state_request"}')
            started = time.monotonic()
            for peer in controls:
                while True:
                    frame = json.loads(await asyncio.wait_for(peer.recv(), 1))
                    if frame.get("text") == "ack":
                        break
            assert time.monotonic() - started < 1
            assert h._server.connection_count == 5
            capture_id = await _capture(h, controls[0], hellos[0])
            await bulks[0].send(json.dumps({"type": "bulk_upload_begin", "kind": "localization",
                                           "upload_id": 4, "total_bytes": len(TYPESCRIPT_LOCA_ONE),
                                           "capture_id": capture_id}))
            while json.loads(await asyncio.wait_for(bulks[0].recv(), 2)).get("type") != "bulk_upload_ready":
                pass
            for chunk in binary_chunks(4, TYPESCRIPT_LOCA_ONE):
                await bulks[0].send(chunk)
            while json.loads(await asyncio.wait_for(bulks[0].recv(), 2)).get("type") != "bulk_upload_result":
                pass
            assert uploads == [hellos[0]["client_id"]]
            assert h._server.connection_count == 5
    finally:
        h.stop()


@pytest.mark.asyncio
async def test_invalid_control_batch_retires_only_its_source() -> None:
    h = ServerHarness()
    h.start()
    try:
        async with websockets.connect(f"ws://127.0.0.1:{h.port}") as offender:
            await _send_hello_request(offender)
            async with websockets.connect(f"ws://127.0.0.1:{h.port}") as observer:
                await _send_hello_request(observer)
                await offender.send('{"type":"state_request"}\n' * 33)
                with pytest.raises(websockets.ConnectionClosed):
                    await offender.recv()
                await observer.send('{"type":"localization_start_request"}')
                for _ in range(20):
                    if h.localization_start_requests:
                        break
                    await asyncio.sleep(0.01)
                assert len(h.localization_start_requests) == 1
                assert h._server.connection_count == 1
    finally:
        h.stop()


@pytest.mark.asyncio
async def test_maximum_jpeg_upload_does_not_block_control_stop() -> None:
    received, stops = [], []
    h = ServerHarness(
        on_localization_observations=lambda values, _client, _sync: received.append(len(values[0].jpeg)),
        on_estop_request=lambda *_args: stops.append(time.monotonic()),
    )
    intrinsics = json.dumps({"fx": 100, "fy": 100, "cx": 50, "cy": 50,
                             "width": 100, "height": 100,
                             "distortion_model": "none", "distortion": []}).encode()
    overhead = len(_encode_localization_observations_frame(b"", intrinsics))
    payload = _encode_localization_observations_frame(b"x" * (4_194_304 - overhead), intrinsics)
    h.start()
    try:
        async with AsyncExitStack() as stack:
            control = await stack.enter_async_context(websockets.connect(f"ws://127.0.0.1:{h.port}/ws"))
            hello = await _send_hello_request(control)
            bulk = await _attach(stack, h, hello)
            capture_id = await _capture(h, control, hello)
            await bulk.send(json.dumps({"type": "bulk_upload_begin", "kind": "localization",
                                       "upload_id": 9, "total_bytes": len(payload),
                                       "capture_id": capture_id}))
            assert json.loads(await bulk.recv())["type"] == "bulk_upload_ready"

            first_chunk, continue_upload = asyncio.Event(), asyncio.Event()

            async def upload() -> None:
                for index, chunk in enumerate(binary_chunks(9, payload)):
                    await bulk.send(chunk)
                    if index == 0:
                        first_chunk.set()
                        await continue_upload.wait()

            uploading = asyncio.create_task(upload())
            await first_chunk.wait()
            await control.send('{"type":"estop_request"}')
            for _ in range(50):
                if stops:
                    break
                await asyncio.sleep(0.01)
            assert stops and not received
            continue_upload.set()
            await uploading
            response = json.loads(await asyncio.wait_for(bulk.recv(), 8))
            assert response["status"] == "accepted"
            assert received == [4_194_304 - overhead]
    finally:
        h.stop()


@pytest.mark.asyncio
async def test_five_maximum_jpegs_ignore_empty_download_budget_and_yield_to_control_stop() -> None:
    received, stops = [], []
    h = ServerHarness(
        on_localization_observations=lambda values, client, _sync: received.append(client),
        on_estop_request=lambda *_args: stops.append(time.monotonic()),
    )
    intrinsics = json.dumps({"fx": 100, "fy": 100, "cx": 50, "cy": 50,
                             "width": 100, "height": 100,
                             "distortion_model": "none", "distortion": []}).encode()
    overhead = len(_encode_localization_observations_frame(b"", intrinsics))
    payload = _encode_localization_observations_frame(b"x" * (4_194_304 - overhead), intrinsics)
    h.start()
    try:
        h._server._bulk_budget.tokens = 0
        h._server._bulk_budget.rate = 0
        async with AsyncExitStack() as stack:
            controls, bulks, captures = [], [], []
            for _ in range(5):
                control = await stack.enter_async_context(websockets.connect(f"ws://127.0.0.1:{h.port}/ws"))
                hello = await _send_hello_request(control)
                controls.append(control)
                bulks.append(await _attach(stack, h, hello))
                captures.append(await _capture(h, control, hello))
            admitted = [asyncio.Event() for _ in range(5)]
            resume = asyncio.Event()

            async def upload(index: int) -> None:
                bulk = bulks[index]
                await bulk.send(json.dumps({"type": "bulk_upload_begin", "kind": "localization",
                                           "upload_id": index, "total_bytes": len(payload),
                                           "capture_id": captures[index]}))
                assert json.loads(await bulk.recv())["type"] == "bulk_upload_ready"
                for part, chunk in enumerate(binary_chunks(index, payload)):
                    await bulk.send(chunk)
                    if part == 0:
                        admitted[index].set()
                        await resume.wait()
                assert json.loads(await bulk.recv())["status"] == "accepted"

            tasks = [asyncio.create_task(upload(index)) for index in range(5)]
            try:
                await asyncio.wait_for(asyncio.gather(*(event.wait() for event in admitted)), 1)
                await controls[0].send('{"type":"estop_request"}')
                for _ in range(50):
                    if stops:
                        break
                    await asyncio.sleep(0.01)
                assert stops and not received
                started = time.monotonic()
                resume.set()
                await asyncio.wait_for(asyncio.gather(*tasks), 2)
                assert time.monotonic() - started < 2
                assert len(set(received)) == 5
                assert h._server.connection_count == 5
                assert h._server._bulk_budget.tokens == 0
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
    finally:
        h.stop()


@pytest.mark.asyncio
async def test_inflight_asset_requests_deduplicate_but_new_revision_replaces() -> None:
    class Socket:
        def __init__(self):
            self.entered, self.release = asyncio.Event(), asyncio.Event()
            self.sent = []

        async def send(self, value):
            self.entered.set()
            await self.release.wait()
            self.sent.append(json.loads(value))

    store = BulkAssetStore()
    first = store.put("route", "active", "first", {"path_poses": [[1, 0, 0, 0]], "ts": 1})
    second = store.put("route", "active", "second", {"path_poses": [[2, 0, 0, 0]], "ts": 2})
    socket = Socket()
    peer = BulkPeer(socket, store.epoch, TokenBucket(1_048_576, 65_536), lambda: 1, lambda: False)
    peer.enqueue(store.get("route", first))
    task = asyncio.create_task(peer.run())
    try:
        await asyncio.wait_for(socket.entered.wait(), 1)
        peer.enqueue(store.get("route", first))
        peer.enqueue(store.get("route", first))
        assert len(peer._assets) == 0
        peer.enqueue(store.get("route", second))
        assert len(peer._assets) == 1
        socket.release.set()
        for _ in range(20):
            if len(socket.sent) == 2:
                break
            await asyncio.sleep(0.01)
        assert [record["revision"] for record in socket.sent] == ["first", "second"]
        peer.enqueue(store.get("route", second))
        for _ in range(20):
            if len(socket.sent) == 3:
                break
            await asyncio.sleep(0.01)
        assert len(socket.sent) == 3
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


@pytest.mark.asyncio
async def test_preview_and_active_route_both_complete_without_replacing_each_other() -> None:
    store = BulkAssetStore()
    state = store.compact({"type": "interaction_state",
                           "preview": {"path_poses": [[1, 0, 0, 0]] * 400, "ts": 1},
                           "active_goal": {"path_poses": [[2, 0, 0, 0]] * 400, "ts": 2}})
    assert state["preview"]["route_ref"]["id"] != state["active_goal"]["route_ref"]["id"]
    sent = []

    class Socket:
        async def send(self, value):
            sent.append(json.loads(value))

    peer = BulkPeer(Socket(), store.epoch, TokenBucket(1_048_576, 65_536), lambda: 1, lambda: False)
    for field in ("preview", "active_goal"):
        peer.enqueue(store.get("route", state[field]["route_ref"]))
    task = asyncio.create_task(peer.run())
    try:
        for _ in range(30):
            if len({record["id"] for record in sent}) == 2:
                break
            await asyncio.sleep(0.01)
        assert {record["id"] for record in sent} == {"route:preview", "route:active_goal"}
        assert sum(len(record["data"].get("points", [])) for record in sent) == 800
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


@pytest.mark.asyncio
async def test_capture_restart_retires_old_bulk_completion_without_clock_thresholds() -> None:
    received = []
    h = ServerHarness(on_localization_observations=lambda values, *_args: received.append(values))
    intrinsics = json.dumps({"fx": 100, "fy": 100, "cx": 50, "cy": 50,
                             "width": 100, "height": 100,
                             "distortion_model": "none", "distortion": []}).encode()
    payload = _encode_localization_observations_frame(b"x" * 40_000, intrinsics)
    h.start()
    try:
        async with AsyncExitStack() as stack:
            control = await stack.enter_async_context(websockets.connect(f"ws://127.0.0.1:{h.port}/ws"))
            hello = await _send_hello_request(control)
            bulk = await _attach(stack, h, hello)
            old = await _capture(h, control, hello)
            await bulk.send(json.dumps({"type": "bulk_upload_begin", "kind": "localization",
                                       "upload_id": 7, "total_bytes": len(payload), "capture_id": old}))
            assert json.loads(await bulk.recv())["type"] == "bulk_upload_ready"
            chunks = list(binary_chunks(7, payload))
            await bulk.send(chunks[0])
            await control.send('{"type":"localization_start_request"}')
            for _ in range(50):
                if h.localization_start_requests:
                    break
                await asyncio.sleep(0.01)
            assert h.localization_start_requests
            for chunk in chunks[1:]:
                await bulk.send(chunk)
            rejected = json.loads(await bulk.recv())
            assert rejected["status"] == "rejected" and rejected["code"] == "capture_retired"
            assert not received
            current = await _capture(h, control, hello)
            assert current != old
            await bulk.send(json.dumps({"type": "bulk_upload_begin", "kind": "localization",
                                       "upload_id": 8, "total_bytes": len(TYPESCRIPT_LOCA_ONE),
                                       "capture_id": current}))
            assert json.loads(await bulk.recv())["type"] == "bulk_upload_ready"
            await bulk.send('{"type":"bulk_upload_cancel","upload_id":7}')
            assert json.loads(await bulk.recv())["upload_id"] == 7
            for chunk in binary_chunks(8, TYPESCRIPT_LOCA_ONE):
                await bulk.send(chunk)
            assert json.loads(await bulk.recv())["status"] == "accepted"
            assert len(received) == 1
    finally:
        h.stop()


@pytest.mark.asyncio
async def test_upload_cancel_is_idempotent_and_bulk_cache_error_identifies_reference() -> None:
    h = ServerHarness()
    h.start()
    try:
        async with AsyncExitStack() as stack:
            control = await stack.enter_async_context(websockets.connect(f"ws://127.0.0.1:{h.port}/ws"))
            hello = await _send_hello_request(control)
            bulk = await _attach(stack, h, hello)
            capture_id = await _capture(h, control, hello)
            await bulk.send(json.dumps({"type": "bulk_upload_begin", "kind": "localization",
                                       "upload_id": 1, "total_bytes": 30_000, "capture_id": capture_id}))
            assert json.loads(await bulk.recv())["type"] == "bulk_upload_ready"
            await bulk.send(next(iter(binary_chunks(1, bytes(30_000)))))
            for _ in range(2):
                await bulk.send('{"type":"bulk_upload_cancel","upload_id":1}')
                assert json.loads(await bulk.recv())["status"] == "cancelled"
            ref = {"kind": "trajectory", "epoch": hello["bulk_epoch"],
                   "id": "missing", "revision": "retired"}
            await bulk.send(json.dumps({"type": "bulk_get", **ref}))
            response = json.loads(await bulk.recv())
            assert response == {"type": "bulk_error", "code": "asset_unavailable", **ref}
            assert h._server.connection_count == 1
    finally:
        h.stop()


@pytest.mark.asyncio
async def test_largest_lidar_record_progresses_despite_continuous_control_pressure():
    from unittest.mock import AsyncMock

    socket = AsyncMock()
    checks = 0

    def controls_pending():
        nonlocal checks
        checks += 1
        return True

    peer = BulkPeer(socket, "epoch", TokenBucket(1_048_576, 65_536),
                    lambda: 1, controls_pending)
    payload = bytes(65_536)
    await asyncio.wait_for(peer._send(payload), 2)
    socket.send.assert_awaited_once_with(payload)
    assert checks > 1


@pytest.mark.asyncio
async def test_impossible_bulk_record_fails_instead_of_waiting_forever():
    from unittest.mock import AsyncMock

    peer = BulkPeer(AsyncMock(), "epoch", TokenBucket(1_048_576, 65_536),
                    lambda: 1, lambda: False)
    with pytest.raises(ValueError, match="burst capacity"):
        await peer.consume(65_537)
