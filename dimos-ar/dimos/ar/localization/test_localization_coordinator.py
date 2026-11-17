"""Public shared-frame behavior and the single capture lifecycle."""

import asyncio
from dataclasses import replace
import json
import math
from types import SimpleNamespace
from unittest.mock import AsyncMock

import numpy as np
import pytest

from dimos.ar.async_execution import BoundedWorker
from dimos.ar.localization.coordinator import LocalizationCoordinator
from dimos.ar.localization.types import LocalizedPose
from dimos.ar.localization.vps.admission import VpsAdmission
from dimos.ar.robot.odometry import PoseBuffer
from dimos.ar.spatial import frozen_matrix
from dimos.ar.websocket.protocol import LocalizationTracking, TimeSync
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.utils.transform_utils import matrix_to_pose
from test_support.localization import _observation


def transform(x=0, y=0, yaw=0):
    c, s = math.cos(yaw), math.sin(yaw)
    return np.array([[c, -s, 0, x], [s, c, 0, y], [0, 0, 1, 0], [0, 0, 0, 1]], dtype=float)


@pytest.fixture
async def setup():
    history = PoseBuffer()
    for ts in (99.9, 100.0, 100.1):
        history.push(PoseStamped(ts=ts, position=[0, 0, 0]), ts_server=ts)
    odometry = SimpleNamespace(
        generation=0, reference_id="odom1", history=history, travel=lambda: 0.0
    )
    local = SimpleNamespace(
        localize=lambda obs: LocalizedPose(matrix_to_pose(transform(1, 2)), "odom", 0.9)
    )
    local.snapshot = lambda: local
    worker = BoundedWorker()
    messages, changes = [], []
    vps = SimpleNamespace(localize=AsyncMock(return_value=None), close=AsyncMock())
    service = LocalizationCoordinator(
        odometry=odometry,
        robot_images=SimpleNamespace(newest=lambda **kw: None),
        marker=local,
        vps=vps,
        worker=worker,
        admission=VpsAdmission(),
        map_code="office",
        send=lambda key, text: messages.append((key, json.loads(text))),
        travel_threshold_m=0.75,
        heading_threshold_deg=30,
        marker_preference_s=3,
        headset_travel_threshold_m=10,
        timeout_s=0.05,
        clock=lambda: 10.0,
        wall_clock=lambda: 100.0,
        on_frame_change=lambda frame, rebase: changes.append((frame, rebase)),
    )
    service.connect("client")
    client = service._clients["client"]
    client.reference, client.active, client.seen_at = "tracking1", True, 10.0
    yield SimpleNamespace(
        service=service,
        client=client,
        local=local,
        worker=worker,
        messages=messages,
        changes=changes,
        odometry=odometry,
        vps=vps,
    )
    await service.close()
    worker.close()


def results(f):
    return [body for _, body in f.messages if body["type"] == "localization_result"]


async def tag(f):
    episode = f.service._request("client", f.client, "robot")
    await f.service._tag("client", f.client, episode, (_observation(100.0),))
    return episode


def acknowledge(f):
    result = results(f)[-1]
    f.service.progress(
        LocalizationTracking(
            tracking_reference_id="tracking1",
            travel_m=0.0,
            active=True,
            alignment_id=result["alignment_id"],
        ),
        "client",
        TimeSync(ts_client=0.0, ts_server=0.0),
    )


async def test_tag_immediately_returns_one_shared_result_and_keeps_provenance(setup):
    f = setup
    await tag(f)
    result = results(f)[-1]
    assert result["position"] == [1.0, 2.0, 0.0]
    assert result["shared_frame_id"] == "session:odom1"
    assert result["tracking_reference_id"] == "tracking1"
    assert "map_alignment" not in result and "map_transform" not in result
    acknowledge(f)
    assert f.client.alignment.source == "tag"
    assert not f.service._headset_due(f.client)
    assert not f.vps.localize.called


async def test_native_insertion_preserves_pose_then_updates_only_lower_edge(setup):
    f = setup
    upper = transform(4, 5, 0.2)
    assert f.service.on_native_reference(upper, ts_server=100, native_map_id="room")
    np.testing.assert_allclose(f.service.frames.T_map_odom, np.eye(4), atol=1e-12)
    first_upper = f.service.frames.T_map_native
    updated = transform(5, 6, 0.3)
    assert f.service.on_native_reference(updated, ts_server=101, native_map_id="room")
    np.testing.assert_allclose(f.service.frames.T_map_odom, first_upper @ updated)
    revision = f.service.frames.revision
    assert not f.service.on_native_reference(updated, ts_server=102, native_map_id="room")
    assert f.service.frames.revision == revision
    assert not f.service.on_native_reference(upper, ts_server=99, native_map_id="room")


async def test_native_rejects_tilt_and_snapshot_is_deeply_immutable(setup):
    f = setup
    tilted = np.eye(4)
    angle = math.radians(10)
    tilted[1:3, 1:3] = [[math.cos(angle), -math.sin(angle)], [math.sin(angle), math.cos(angle)]]
    assert not f.service.on_native_reference(tilted, ts_server=100, native_map_id="room")
    with pytest.raises(ValueError):
        f.service.frames.T_map_odom[0, 3] = 9
    raw = transform(1)
    copy = replace(f.service.frames, T_map_odom=raw)
    raw[0, 3] = 9
    assert copy.T_map_odom[0, 3] == 1


async def test_adoption_rebases_existing_alignment_once_without_changing_tag_source(setup):
    f = setup
    await tag(f)
    acknowledge(f)
    before = f.service.frames
    T = transform(3, -2, 0.4)
    assert f.service._commit_robot(
        LocalizedPose(matrix_to_pose(T), "map", 0.9), ts=100, travel=0, heading=0, snapshot=before
    )
    assert f.service.frames.shared_frame_id == "vps:office"
    assert len([change for change in f.changes if change[1] is not None]) == 1
    np.testing.assert_allclose(f.client.alignment.T_map_tracking, T @ transform(1, 2))
    assert f.client.alignment.source == "tag"
    assert f.messages[-1][1]["rebase"]["previous_shared_frame_id"] == "session:odom1"
    assert f.service._commit_robot(
        LocalizedPose(matrix_to_pose(transform(4)), "map", 0.9),
        ts=101,
        travel=0,
        heading=0,
        snapshot=f.service.frames,
    )
    assert len([change for change in f.changes if change[1] is not None]) == 1


async def test_vps_uses_capture_native_edge_then_composes_latest_native_edge(setup):
    f = setup
    native = transform(2, 3, 0.3)
    f.service.on_native_reference(native, ts_server=99, native_map_id="room")
    f.service._commit_robot(
        LocalizedPose(matrix_to_pose(transform(10)), "map", 0.9),
        ts=100,
        travel=0,
        heading=0,
        snapshot=f.service.frames,
    )
    capture = f.service.frames
    newest = transform(3, 4, 0.5)
    f.service.on_native_reference(newest, ts_server=101, native_map_id="room")
    vps = transform(20, 30, 0.8)
    f.service._commit_robot(
        LocalizedPose(matrix_to_pose(vps), "map", 0.9),
        ts=102,
        travel=0,
        heading=0,
        snapshot=capture,
    )
    expected_upper = vps @ np.linalg.inv(capture.T_native_odom)
    np.testing.assert_allclose(f.service.frames.T_map_native, expected_upper)
    np.testing.assert_allclose(f.service.frames.T_map_odom, expected_upper @ newest)
    np.testing.assert_allclose(f.service.frames.T_native_odom, newest)


async def test_first_headset_vps_requires_independent_alignment_then_can_adopt(setup):
    f = setup
    f.vps.localize.return_value = LocalizedPose(matrix_to_pose(transform(10, 20)), "map", 0.9)
    episode = f.service._request("client", f.client, "headset")
    await f.service._headset("client", f.client, episode, _observation(100.0))
    assert not results(f)
    assert f.service.frames.shared_frame_id == "session:odom1"
    await tag(f)
    acknowledge(f)
    episode = f.service._request("client", f.client, "headset")
    await f.service._headset("client", f.client, episode, _observation(100.0))
    assert results(f)[-1]["position"] == [10.0, 20.0, 0.0]
    assert f.service.frames.shared_frame_id == "vps:office"


@pytest.mark.parametrize("retire", ["source", "tracking", "disconnect", "replacement", "timeout"])
async def test_late_vps_results_cannot_cross_retired_episode(setup, retire):
    f = setup
    f.service._vps_adopted = True
    started, release = asyncio.Event(), asyncio.Event()

    async def query(_observations):
        started.set()
        await release.wait()
        return LocalizedPose(matrix_to_pose(transform(1)), "map", 0.9)

    f.vps.localize.side_effect = query
    episode = f.service._request("client", f.client, "headset")
    task = asyncio.create_task(f.service._headset("client", f.client, episode, _observation(100.0)))
    await started.wait()
    if retire == "source":
        f.odometry.generation += 1
    elif retire == "tracking":
        f.client.reference = "other"
    elif retire == "disconnect":
        f.service.disconnect("client")
    elif retire == "replacement":
        f.service._request("client", f.client, "headset")
    else:
        await asyncio.sleep(0.06)
    release.set()
    await task
    assert not results(f)


async def test_pending_replacement_preserves_accepted_alignment_until_matching_ack(setup):
    f = setup
    await tag(f)
    acknowledge(f)
    accepted = f.client.alignment
    await tag(f)
    assert f.client.alignment is accepted
    first = results(f)[0]
    f.service.progress(
        LocalizationTracking(
            tracking_reference_id="tracking1",
            travel_m=0,
            active=True,
            alignment_id=first["alignment_id"],
        ),
        "client",
        TimeSync(ts_client=0.0, ts_server=0.0),
    )
    assert f.client.pending_alignment is not None
    acknowledge(f)
    assert f.client.pending_alignment is None
    assert f.client.alignment.id != accepted.id


async def test_local_capture_runs_while_cloud_busy_and_checks_capture_timestamp(setup):
    f = setup
    blocked = asyncio.Event()
    f.service._cloud_task = f.service._spawn(blocked.wait())
    f.service._tick()
    assert f.client.episode.purpose == "robot"
    episode = f.client.episode
    episode.phase, episode.capture_ts = "submitted", 99.8
    f.service.observations((_observation(100.0),), "client")
    assert episode.phase == "submitted"
    episode.capture_ts = 100.0
    f.service.observations((_observation(100.0),), "client")
    await asyncio.sleep(0.02)
    assert results(f)
    blocked.set()


async def test_repeated_gate_wait_does_not_extend_deadline(setup):
    from dimos.ar.websocket.protocol import LocalizationCaptureProgress

    f = setup
    episode = f.service._request("client", f.client, "robot")
    deadline = episode.deadline
    f.service.progress(
        LocalizationCaptureProgress(episode_id=episode.id, phase="capturing", travel_m=0),
        "client",
        TimeSync(ts_client=0.0, ts_server=0.0),
    )
    f.service.progress(
        LocalizationCaptureProgress(episode_id=episode.id, phase="waiting", travel_m=0),
        "client",
        TimeSync(ts_client=0.0, ts_server=0.0),
    )
    assert episode.deadline == deadline


async def test_shutdown_waits_for_owned_jobs_before_closing_provider(setup):
    f = setup
    order = []

    async def job():
        try:
            await asyncio.Event().wait()
        finally:
            order.append("job")

    f.service._spawn(job())
    await asyncio.sleep(0)
    f.vps.close.side_effect = lambda: order.append("vps")
    await f.service.close()
    assert order == ["job", "vps"]


async def test_missing_live_pose_defers_once_then_recovers(setup):
    f = setup
    f.odometry.history.clear()
    f.service._tick()
    f.service._tick()
    unavailable = [b for _, b in f.messages if b.get("reason") == "robot_pose_unavailable"]
    assert len(unavailable) == 1
    assert f.client.episode is None
    f.odometry.history.push(PoseStamped(ts=100, position=[0, 0, 0]), ts_server=100)
    f.service._tick()
    assert f.client.episode.purpose == "robot"
    assert any(b.get("reason") == "robot_pose_available" for _, b in f.messages)


async def test_capture_travel_not_completion_travel_controls_refresh(setup):
    f = setup
    episode = f.service._request("client", f.client, "robot")
    episode.travel_m = 3
    await f.service._tag("client", f.client, episode, (_observation(100),))
    f.client.travel_m = 13
    result = results(f)[-1]
    f.service.progress(
        LocalizationTracking(
            tracking_reference_id="tracking1",
            travel_m=13,
            active=True,
            alignment_id=result["alignment_id"],
        ),
        "client",
        TimeSync(0, 0),
    )
    assert f.client.alignment.travel_m == 3
    assert f.service._headset_due(f.client)


async def test_tag_correction_requires_independent_vps_provenance(setup):
    f = setup
    await tag(f)
    acknowledge(f)
    revision = f.service.frames.revision
    await tag(f)
    assert f.service.frames.revision == revision
    acknowledge(f)
    f.client.alignment = replace(
        f.client.alignment, source="vps", T_map_tracking=frozen_matrix(transform(4, 5))
    )
    accepted = f.client.alignment
    await tag(f)
    np.testing.assert_allclose(
        f.service.frames.T_map_odom, accepted.T_map_tracking @ np.linalg.inv(transform(1, 2))
    )
    assert f.service.frames.revision == revision + 1


async def test_expired_replacement_keeps_accepted_baseline(setup):
    f = setup
    await tag(f)
    acknowledge(f)
    accepted = f.client.alignment
    await tag(f)
    pending, _ = f.client.pending_alignment
    f.client.pending_alignment = (pending, 9)
    assert not f.service._headset_due(f.client)
    assert f.client.alignment is accepted
    assert f.client.pending_alignment is None


async def test_failed_provider_keeps_accepted_origin(setup):
    f = setup
    await tag(f)
    acknowledge(f)
    accepted = f.client.alignment
    f.local.localize = lambda obs: (_ for _ in ()).throw(ValueError("broken capture"))
    await tag(f)
    assert f.client.alignment is accepted
    assert f.client.retry_at == 12
    f.service.disconnect("client")
    f.service._tick()
    assert "client" not in f.service._clients


async def test_replay_can_use_final_retained_pose(setup):
    f = setup
    f.service._allow_latest_robot_pose = True
    f.service._wall_clock = lambda: 1000
    f.service._tick()
    assert f.client.episode.purpose == "robot"


async def test_randomized_native_vps_composition_roundtrips(setup):
    f = setup
    random = np.random.default_rng(17)
    for index in range(20):
        native = transform(*random.uniform(-5, 5, 2), random.uniform(-math.pi, math.pi))
        f.service.on_native_reference(native, ts_server=100 + index, native_map_id="room")
        snapshot = f.service.frames
        vps = transform(*random.uniform(-5, 5, 2), random.uniform(-math.pi, math.pi))
        f.service._commit_robot(
            LocalizedPose(matrix_to_pose(vps), "map", 0.9),
            ts=100 + index,
            travel=0,
            heading=0,
            snapshot=snapshot,
        )
        np.testing.assert_allclose(f.service.frames.T_map_odom, vps, atol=1e-12)
        point = np.r_[random.uniform(-5, 5, 3), 1]
        np.testing.assert_allclose(
            f.service.frames.T_odom_map @ f.service.frames.T_map_odom @ point, point, atol=1e-12
        )
