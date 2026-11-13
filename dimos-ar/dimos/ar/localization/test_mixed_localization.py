"""Mixed-mode setup must not make working tags depend on a cloud map anchor."""

import asyncio
import json
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from dimos.ar.async_execution import BoundedWorker
from dimos.ar.localization.map_localization import MapLocalization, RelativeAlignment
from dimos.ar.localization.odom_map_transform import OdomMapTransform
from dimos.ar.localization.types import LocalizedPose
from dimos.ar.localization.vps.admission import QueryDeferredError, VpsAdmission
from dimos.ar.robot.odometry import PoseBuffer
from dimos.ar.websocket.protocol import LocalizationCaptureProgress, LocalizationTracking, TimeSync
from dimos.msgs.geometry_msgs.Pose import Pose
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from test_support.localization import _observation


@pytest.fixture
async def mixed():
    timestamp = time.time()
    history = PoseBuffer()
    for ts in (timestamp - 0.05, timestamp + 0.05):
        history.push(PoseStamped(ts=ts, position=[0, 0, 0]), ts_server=ts)
    odometry = SimpleNamespace(
        generation=0, reference_id="odom", history=history, travel=lambda: 0.0
    )
    worker = BoundedWorker()
    messages = []
    marker = SimpleNamespace(localize=lambda observations: LocalizedPose(Pose(1, 2, 0), "odom", 0.8))
    marker.snapshot = lambda: marker
    vps = SimpleNamespace(localize=AsyncMock(return_value=LocalizedPose(Pose(), "map", 0.9)))
    images = SimpleNamespace(newest=lambda **kwargs: None)
    service = MapLocalization(
        odometry=odometry, transforms=OdomMapTransform(), robot_images=images,
        marker=marker, vps=vps, worker=worker, admission=VpsAdmission(), map_code="office",
        send=lambda client, text: messages.append((client, json.loads(text))),
        travel_threshold_m=0.75, heading_threshold_deg=30, marker_preference_s=3,
        headset_travel_threshold_m=10, timeout_s=1,
    )
    service.connect("client")
    client = service._clients["client"]
    client.reference = "tracking"
    client.active = True
    client.seen_at = time.monotonic()
    yield SimpleNamespace(
        service=service, odometry=odometry, messages=messages, marker=marker,
        vps=vps, images=images, client=client, timestamp=timestamp, worker=worker,
    )
    await service.close()
    worker.close()


def requests(fixture):
    return [body for _, body in fixture.messages
            if body["type"] == "localization_observations_request"]


async def test_initial_vps_prerequisite_failure_falls_back_to_relative_tag(mixed):
    f = mixed
    f.service._tick()
    assert requests(f) == []  # Initial setup tries the robot VPS anchor first.
    await f.service._cloud_task
    f.service._tick()
    request = requests(f)[-1]
    assert request["purpose"] == "robot"
    assert request["wait_timeout_s"] == 3
    episode = f.client.episode
    await f.service._tag("client", f.client, episode, (_observation(f.timestamp),))
    result = next(body for _, body in f.messages if body["type"] == "localization_result")
    assert result["position"] == [1, 2, 0]
    assert "map_alignment" not in result and "map_transform" not in result
    assert f.service._map_payload() is None
    assert f.client.relative_alignment is not None
    assert not f.service._headset_due(f.client)
    f.service._tick()
    assert len(requests(f)) == 1  # No repeated scans after a successful tag.


async def test_initial_vps_success_never_requests_a_tag(mixed):
    f = mixed
    f.images.newest = lambda **kwargs: SimpleNamespace(
        observation=_observation(f.timestamp), source_generation=0, travel_m=0
    )
    f.service._tick()
    await f.service._cloud_task
    f.service._tick()
    assert [request["purpose"] for request in requests(f)] == ["headset"]
    episode = f.client.episode
    await f.service._headset("client", f.client, episode, _observation(f.timestamp))
    result = next(body for _, body in f.messages if body["type"] == "localization_result")
    assert result["map_alignment"]["tracking_reference_id"] == "tracking"


@pytest.mark.parametrize("outcome", [None, RuntimeError("offline"), QueryDeferredError(30)])
async def test_failed_headset_vps_allows_tag_without_discarding_relative_alignment(mixed, outcome):
    f = mixed
    baseline = RelativeAlignment(0, 0, 0)
    f.client.relative_alignment = baseline
    f.client.force = True
    f.service._commit_robot(LocalizedPose(Pose(), "map", 0.9), f.timestamp - 1, 0, 0, 0)
    if isinstance(outcome, Exception):
        f.vps.localize.side_effect = outcome
    else:
        f.vps.localize.return_value = outcome
    episode = f.service._request("client", f.client, "headset")
    await f.service._headset("client", f.client, episode, _observation(f.timestamp))
    assert f.client.relative_alignment is baseline
    assert f.client.next_attempt == "tag"
    assert f.client.retry_at <= time.monotonic() + 2
    f.client.retry_at = 0
    f.service._tick()
    assert requests(f)[-1]["purpose"] == "robot"


@pytest.mark.parametrize("trigger", ["manual", "headset", "robot", "heading"])
async def test_relative_alignment_uses_tag_preference_for_corrections(mixed, trigger):
    f = mixed
    f.client.relative_alignment = RelativeAlignment(0, 0, -1 if trigger == "heading" else 0)
    f.client.next_attempt = "tag"
    f.client.manual = False
    if trigger == "manual":
        f.service.manual("client")
    elif trigger == "headset":
        f.client.travel_m = 10
    elif trigger == "robot":
        f.odometry.travel = lambda: 0.75
    f.service._tick()
    assert requests(f)[-1]["purpose"] == "robot"
    assert requests(f)[-1]["wait_timeout_s"] == 3


async def test_failed_relative_tag_attempt_falls_back_to_vps_and_keeps_origin(mixed):
    f = mixed
    baseline = RelativeAlignment(0, 0, 0)
    f.client.relative_alignment = baseline
    f.client.force = True
    f.marker.localize = lambda observations: None
    episode = f.service._request("client", f.client, "robot")
    await f.service._tag("client", f.client, episode, (_observation(f.timestamp),))
    assert f.client.relative_alignment is baseline
    assert f.client.next_attempt == "vps"
    assert f.service._cloud_task is not None
    assert not any(body["type"] == "localization_result" for _, body in f.messages)


async def test_repeated_gate_waits_cannot_extend_the_preference_deadline(mixed):
    f = mixed
    episode = f.service._request("client", f.client, "robot")
    deadline = episode.gate_deadline
    for _ in range(3):
        episode.phase = "capturing"
        f.service.progress(LocalizationCaptureProgress(episode.id, "waiting", 0),
                           "client", TimeSync(0, 0))
        assert episode.deadline == deadline
    episode.gate_deadline = time.monotonic() - 1
    episode.phase = "capturing"
    f.service.progress(LocalizationCaptureProgress(episode.id, "waiting", 0),
                       "client", TimeSync(0, 0))
    f.service._tick()
    assert f.client.episode is None
    assert f.service._cloud_task is not None


@pytest.mark.parametrize("retire", ["reference", "source", "disconnect"])
async def test_late_tag_result_cannot_cross_reference_or_source_changes(mixed, monkeypatch, retire):
    f = mixed
    entered, release = asyncio.Event(), asyncio.Event()

    async def delayed(work):
        entered.set()
        await release.wait()
        return work()

    monkeypatch.setattr(f.worker, "run", delayed)
    episode = f.service._request("client", f.client, "robot")
    task = asyncio.create_task(f.service._tag(
        "client", f.client, episode, (_observation(f.timestamp),)
    ))
    await entered.wait()
    if retire == "reference":
        f.client.reference = "new-tracking"
    elif retire == "source":
        f.odometry.generation += 1
    else:
        f.service.disconnect("client")
    release.set()
    await task
    assert not any(body["type"] == "localization_result" for _, body in f.messages)


async def test_tracking_reference_reset_retires_relative_baselines(mixed):
    f = mixed
    f.client.relative_alignment = RelativeAlignment(0, 0, 0)
    f.client.next_attempt = "tag"
    f.service.progress(LocalizationTracking("replacement", 0, True), "client", TimeSync(0, 0))
    assert f.client.relative_alignment is None
    assert f.client.next_attempt == "vps"


async def test_cloud_budget_wait_still_allows_initial_tag_fallback(mixed):
    f = mixed
    for _ in range(3):
        f.service._admission.admit()
    f.service._tick()
    assert f.client.next_attempt == "tag"
    f.service._tick()
    assert requests(f)[-1]["purpose"] == "robot"
    f.vps.localize.assert_not_awaited()


async def test_failed_headset_capture_offers_tag_fallback(mixed):
    f = mixed
    episode = f.service._request("client", f.client, "headset")
    f.service.progress(LocalizationCaptureProgress(episode.id, "unavailable", 0),
                       "client", TimeSync(0, 0))
    assert f.client.episode is None
    assert f.client.next_attempt == "tag"


async def test_other_clients_cloud_query_does_not_block_local_tag_recovery(mixed):
    f = mixed
    pending = asyncio.Event()
    f.service._cloud_task = f.service._spawn(pending.wait())
    f.client.next_attempt = "tag"
    f.service._tick()
    assert requests(f)[-1]["purpose"] == "robot"


async def test_collecting_headset_keeps_turn_then_robot_and_other_client_both_progress(mixed):
    f = mixed
    f.service._commit_robot(LocalizedPose(Pose(), "map", .9), f.timestamp - 1, 0, 0, 0)
    f.service.connect("observer")
    f.service.progress(LocalizationTracking("other-tracking", 0, True),
                       "observer", TimeSync(0, 0))
    f.service._tick()
    first = requests(f)[-1]
    assert first["purpose"] == "headset"
    f.odometry.travel = lambda: 2
    f.service._tick()
    assert len(requests(f)) == 1  # Due robot work cannot steal a collecting headset's turn.
    f.service.progress(LocalizationCaptureProgress(first["episode_id"], "submitted", 0, f.timestamp),
                       "client", TimeSync(0, 0))
    f.service.observations([_observation(f.timestamp)], "client")
    await f.service._cloud_task
    result = next(body for key, body in f.messages
                  if key == "client" and body["type"] == "localization_result")
    alignment = result["map_alignment"]["id"]
    f.service.progress(LocalizationTracking("tracking", 0, True, alignment),
                       "client", TimeSync(0, 0))
    f.service._tick()
    f.service._tick()
    assert [request["purpose"] for request in requests(f)] == ["headset", "robot", "headset"]
    assert f.messages[-1][0] == "observer"
    # Ordinary reconnect can adopt the accepted map fix; reference reset cannot.
    f.service.disconnect("client")
    f.service.connect("client")
    f.service.progress(LocalizationTracking("tracking", 0, True, alignment),
                       "client", TimeSync(0, 0))
    assert f.service._clients["client"].alignment["id"] == alignment
    f.service.progress(LocalizationTracking("replacement", 0, True, alignment),
                       "client", TimeSync(0, 0))
    assert f.service._clients["client"].alignment is None
    assert f.messages[-1][1].get("reset") is True
