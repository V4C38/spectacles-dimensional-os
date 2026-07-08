"""Smoke tests for RegistrationSession — full integration tests live in hardware runs."""

from __future__ import annotations

import asyncio
import time
from unittest.mock import MagicMock

import numpy as np
import pytest

from dimos.ar.registration.session import FrameAdmission, RegistrationSession
from dimos.ar.registration.session.flows import TAG_REGISTRATION_MIN_OBS
from dimos.ar.registration.types import CaptureHint, RegistrationMode, RegistrationPhase
from dimos.ar.registration.wire import RegistrationCommandMessage, RegistrationStatusPayload
from dimos.ar.tag_tracking.solve import TagMount, TagObservation
from dimos.ar.tag_tracking.tracker import FrameResult
from dimos.ar.world_frame.registry import WorldRegistry
from dimos.ar.world_frame.state import WorldFrameState


def _stable_observations(count: int = TAG_REGISTRATION_MIN_OBS) -> list[TagObservation]:
    base_mono = time.monotonic()
    observations: list[TagObservation] = []
    for i in range(count):
        T_world_tag = np.eye(4, dtype=np.float64)
        T_world_tag[:3, 3] = [1.0 + i * 0.001, 0.0, -2.0]
        observations.append(
            TagObservation(
                mono_ts=base_mono - 0.1 * i,
                tag_id=0,
                p_world_tag=(1.0 + i * 0.001, 0.0, -2.0),
                p_odom_tag=(0.0, 0.0, 0.0),
                T_world_tag=T_world_tag,
                T_odom_tag=np.eye(4, dtype=np.float64),
                T_odom_base=np.eye(4, dtype=np.float64),
                quality=0.9,
                reprojection_error_px=1.0,
            )
        )
    return observations


def _configure_tag_tracker(tag_tracker: MagicMock) -> None:
    mount = TagMount(tag_id=0)
    tag_tracker.mounts_configured.return_value = True
    tag_tracker.mounts_snapshot.return_value = {0: mount}
    tag_tracker.recent_observations.return_value = _stable_observations()
    tag_tracker.active = False
    tag_tracker.has_camera_info.return_value = True
    tag_tracker.last_tag_detected = False
    tag_tracker.robot_world_pose_estimate.return_value = (
        (1.0, 0.0, -2.0),
        (0.0, 0.0, 0.0, 1.0),
        0.9,
    )


def _make_session(
    *,
    registry: WorldRegistry | None = None,
    tag_tracker: MagicMock | None = None,
) -> tuple[RegistrationSession, list[str], WorldRegistry, MagicMock]:
    sent: list[str] = []
    sender = MagicMock()
    sender.send.side_effect = sent.append
    if registry is None:
        registry = WorldRegistry(WorldFrameState(), tf_publish_static=lambda _tf: None)
    odom = MagicMock()
    odom.latest.return_value = None
    status = MagicMock()
    if tag_tracker is None:
        tag_tracker = MagicMock()
        _configure_tag_tracker(tag_tracker)
    world_frame_refiner = MagicMock()
    session = RegistrationSession(
        robot_id="test_robot",
        sender=sender,
        registry=registry,
        odom=odom,
        status=status,
        tag_tracker=tag_tracker,
        loop=asyncio.new_event_loop(),
        frame_max_age_s=4.0,
        manual_registration_quality=0.7,
        world_frame_refiner=world_frame_refiner,
    )
    return session, sent, registry, tag_tracker


def test_registration_command_start_april_tag_broadcasts_scanning() -> None:
    session, sent, _registry, _tag_tracker = _make_session()
    session.on_registration_command(
        RegistrationCommandMessage(
            ts=1.0, robot_id="test_robot", command="start", mode="april_tag"
        ),
        MagicMock(),
    )
    assert sent
    assert '"type":"registration_status"' in sent[-1]
    assert '"phase":"scanning"' in sent[-1]
    assert '"capture":"burst"' in sent[-1]


def test_registration_command_start_april_tag_fails_without_mounts() -> None:
    tag_tracker = MagicMock()
    tag_tracker.mounts_configured.return_value = False
    session, sent, _registry, _tag_tracker = _make_session(tag_tracker=tag_tracker)
    session.on_registration_command(
        RegistrationCommandMessage(
            ts=1.0, robot_id="test_robot", command="start", mode="april_tag"
        ),
        MagicMock(),
    )
    assert '"phase":"failed"' in sent[-1]


def test_registration_command_start_clears_committed_world_frame() -> None:
    registry = WorldRegistry(WorldFrameState(), tf_publish_static=lambda _tf: None)
    registry.state.commit(
        np.eye(4, dtype=np.float64),
        method="april_tag",
        approximate=False,
    )
    assert registry.state.is_committed

    for mode in ("april_tag", "manual_pose"):
        registry.state.commit(
            np.eye(4, dtype=np.float64),
            method="april_tag",
            approximate=False,
        )
        session, _sent, _registry, _tag_tracker = _make_session(registry=registry)
        session.on_registration_command(
            RegistrationCommandMessage(
                ts=1.0,
                robot_id="test_robot",
                command="start",
                mode=mode,
            ),
            MagicMock(),
        )
        assert not registry.state.is_committed


def test_registration_command_start_manual_enters_editing() -> None:
    session, sent, _registry, _tag_tracker = _make_session()
    session.on_registration_command(
        RegistrationCommandMessage(
            ts=1.0, robot_id="test_robot", command="start", mode="manual_pose"
        ),
        MagicMock(),
    )
    assert sent
    assert '"phase":"editing"' in sent[-1]


def test_frame_admission_processes_during_april_tag_scanning() -> None:
    session, _sent, _registry, _tag_tracker = _make_session()
    session.on_registration_command(
        RegistrationCommandMessage(
            ts=1.0, robot_id="test_robot", command="start", mode="april_tag"
        ),
        MagicMock(),
    )
    assert session._session.mode == RegistrationMode.APRIL_TAG
    admission = session._frame_admission({"seq": 1, "ts": 1.0, "send_ts": 1.0}, 0.0)
    assert admission == FrameAdmission.PROCESS


def test_apply_tracker_update_broadcasts_during_scanning() -> None:
    session, sent, _registry, tag_tracker = _make_session()
    session.on_registration_command(
        RegistrationCommandMessage(
            ts=1.0, robot_id="test_robot", command="start", mode="april_tag"
        ),
        MagicMock(),
    )
    sent.clear()
    tag_tracker.active = True
    tag_tracker.last_tag_detected = True
    tag_tracker.observation_count.return_value = 2
    tag_tracker.recent_observations.return_value = _stable_observations(2)
    session._session.last_status = RegistrationStatusPayload(
        mode=RegistrationMode.APRIL_TAG,
        phase=RegistrationPhase.SCANNING,
        capture=CaptureHint.STEADY,
        message="Look at the AprilTag on your robot",
        tag_visible=True,
        preview_pose=None,
    )

    session._apply_tracker_update(
        frame_result=FrameResult(tag_detected=True, tag_ids=[0], quality=0.9, observations_added=1),
    )

    assert sent
    assert '"phase":"scanning"' in sent[-1]
    assert '"message":""' in sent[-1]
    assert '"progress":40' in sent[-1]


def test_periodic_broadcast_includes_bridge_progress() -> None:
    session, sent, _registry, tag_tracker = _make_session()
    session.on_registration_command(
        RegistrationCommandMessage(
            ts=1.0, robot_id="test_robot", command="start", mode="april_tag"
        ),
        MagicMock(),
    )
    sent.clear()
    tag_tracker.last_tag_detected = True
    tag_tracker.recent_observations.return_value = _stable_observations(2)
    session._session.last_status = RegistrationStatusPayload(
        mode=RegistrationMode.APRIL_TAG,
        phase=RegistrationPhase.SCANNING,
        capture=CaptureHint.STEADY,
        message="Look at the AprilTag on your robot",
        tag_visible=True,
        preview_pose=None,
    )

    session._broadcast_status()

    assert sent
    assert '"progress":40' in sent[-1]


def test_tag_registration_auto_commit_when_stable() -> None:
    session, sent, registry, tag_tracker = _make_session()
    session.on_registration_command(
        RegistrationCommandMessage(
            ts=1.0, robot_id="test_robot", command="start", mode="april_tag"
        ),
        MagicMock(),
    )
    odom_sample = MagicMock()
    odom_sample.position = (0.0, 0.0, 0.0)
    odom_sample.orientation = (0.0, 0.0, 0.0, 1.0)
    session._odom.latest.return_value = odom_sample
    tag_tracker.robot_world_pose_estimate.return_value = (
        (1.0, 0.0, -2.0),
        (0.0, 0.0, 0.0, 1.0),
        0.9,
    )
    sent.clear()

    asyncio.run(session._maybe_finish_tag_registration())

    assert registry.state.is_committed
    assert any('"phase":"succeeded"' in payload for payload in sent)


async def _broadcast_iteration_when_tag_stable(session: RegistrationSession) -> None:
    await session._maybe_finish_tag_registration()


def test_broadcast_loop_auto_commits_when_tag_stable() -> None:
    session, sent, registry, tag_tracker = _make_session()
    session.on_registration_command(
        RegistrationCommandMessage(
            ts=1.0, robot_id="test_robot", command="start", mode="april_tag"
        ),
        MagicMock(),
    )
    odom_sample = MagicMock()
    odom_sample.position = (0.0, 0.0, 0.0)
    odom_sample.orientation = (0.0, 0.0, 0.0, 1.0)
    session._odom.latest.return_value = odom_sample
    tag_tracker.robot_world_pose_estimate.return_value = (
        (1.0, 0.0, -2.0),
        (0.0, 0.0, 0.0, 1.0),
        0.9,
    )
    sent.clear()

    asyncio.run(_broadcast_iteration_when_tag_stable(session))

    assert registry.state.is_committed
    assert any('"phase":"succeeded"' in payload for payload in sent)


def test_registration_command_stop_preserves_committed_registration_when_idle() -> None:
    session, _sent, registry, tag_tracker = _make_session()
    registry.state.commit(
        np.eye(4, dtype=np.float64),
        method="manual_pose",
        approximate=False,
    )
    assert registry.state.is_committed
    tag_tracker.active = True

    session.on_registration_command(
        RegistrationCommandMessage(ts=1.0, robot_id="test_robot", command="stop"),
        MagicMock(),
    )

    assert registry.state.is_committed
    assert tag_tracker.active is True
    session._status.broadcast.assert_not_called()


def test_idle_stop_is_noop_when_session_inactive() -> None:
    session, _sent, registry, tag_tracker = _make_session()
    registry.state.commit(
        np.eye(4, dtype=np.float64),
        method="april_tag",
        approximate=False,
    )
    tag_tracker.active = False
    tag_tracker.reset_window = MagicMock()

    session.on_registration_command(
        RegistrationCommandMessage(ts=1.0, robot_id="test_robot", command="stop"),
        MagicMock(),
    )

    assert session._session.mode is None
    tag_tracker.reset_window.assert_not_called()


def test_active_stop_clears_april_tag_session() -> None:
    session, sent, _registry, tag_tracker = _make_session()
    session.on_registration_command(
        RegistrationCommandMessage(
            ts=1.0, robot_id="test_robot", command="start", mode="april_tag"
        ),
        MagicMock(),
    )
    assert session._session.mode == RegistrationMode.APRIL_TAG
    sent.clear()

    session.on_registration_command(
        RegistrationCommandMessage(ts=2.0, robot_id="test_robot", command="stop"),
        MagicMock(),
    )

    assert session._session.mode is None
    assert tag_tracker.active is False
    assert sent
    assert '"phase":"idle"' in sent[-1]


def _spaced_observations(
    *,
    count: int,
    spacing_s: float,
    newest_mono: float,
) -> list[TagObservation]:
    observations: list[TagObservation] = []
    for i in range(count):
        mono_ts = newest_mono - spacing_s * (count - 1 - i)
        T_world_tag = np.eye(4, dtype=np.float64)
        T_world_tag[:3, 3] = [1.0 + i * 0.001, 0.0, -2.0]
        observations.append(
            TagObservation(
                mono_ts=mono_ts,
                tag_id=0,
                p_world_tag=(1.0 + i * 0.001, 0.0, -2.0),
                p_odom_tag=(0.0, 0.0, 0.0),
                T_world_tag=T_world_tag,
                T_odom_tag=np.eye(4, dtype=np.float64),
                T_odom_base=np.eye(4, dtype=np.float64),
                quality=0.9,
                reprojection_error_px=1.0,
            )
        )
    return observations


def test_tag_registration_stability_with_realistic_frame_spacing() -> None:
    session, _sent, registry, tag_tracker = _make_session()
    registry.state.commit(
        np.eye(4, dtype=np.float64),
        method="april_tag",
        approximate=False,
    )
    session.on_registration_command(
        RegistrationCommandMessage(
            ts=1.0, robot_id="test_robot", command="start", mode="april_tag",
        ),
        MagicMock(),
    )
    assert not registry.state.is_committed
    newest = time.monotonic()
    tag_tracker.recent_observations.return_value = _spaced_observations(
        count=TAG_REGISTRATION_MIN_OBS,
        spacing_s=3.5,
        newest_mono=newest,
    )

    assert session._tag_registration_stability_met() is True


def test_second_registration_start_clears_committed_world_frame_before_mode() -> None:
    registry = WorldRegistry(WorldFrameState(), tf_publish_static=lambda _tf: None)
    registry.state.commit(
        np.eye(4, dtype=np.float64),
        method="april_tag",
        approximate=False,
    )
    session, _sent, _registry, tag_tracker = _make_session(registry=registry)
    clear_calls: list[str] = []

    original_clear = registry.clear

    def tracked_clear() -> None:
        clear_calls.append("registry")
        original_clear()

    registry.clear = tracked_clear  # type: ignore[method-assign]

    session.on_registration_command(
        RegistrationCommandMessage(
            ts=1.0, robot_id="test_robot", command="start", mode="april_tag",
        ),
        MagicMock(),
    )

    assert clear_calls == ["registry"]
    assert not registry.state.is_committed
    assert session._session.mode == RegistrationMode.APRIL_TAG
    assert tag_tracker.active is True


@pytest.mark.asyncio
async def test_april_tag_session_frames_ignore_committed_world_frame() -> None:
    registry = WorldRegistry(WorldFrameState(), tf_publish_static=lambda _tf: None)
    registry.state.commit(np.eye(4, dtype=np.float64), method="manual_pose", approximate=False)
    session, _sent, _registry, tag_tracker = _make_session(registry=registry)
    session.on_registration_command(
        RegistrationCommandMessage(
            ts=1.0,
            robot_id="test_robot",
            command="start",
            mode="april_tag",
        ),
        MagicMock(),
    )
    tag_tracker.active = True
    tag_tracker.process_frame = MagicMock(
        return_value=FrameResult(tag_detected=False, tag_ids=[], quality=0.0, observations_added=0),
    )
    odom_sample = MagicMock()
    odom_sample.position = (0.0, 0.0, 0.0)
    odom_sample.orientation = (0.0, 0.0, 0.0, 1.0)
    session._odom.at_or_latest_by_source.return_value = odom_sample

    header = {"seq": 1, "ts": 1.0, "send_ts": 1.0, "capture_ts_robot": 1.0}
    await session.on_camera_frame(header, b"jpeg", MagicMock())

    kwargs = tag_tracker.process_frame.call_args.kwargs
    assert kwargs["world_frame_committed"] is False
    assert kwargs["T_committed"] is None
    session._odom.at_or_latest_by_source.assert_called_once()


@pytest.mark.asyncio
async def test_runtime_refinement_frames_use_committed_world_frame() -> None:
    registry = WorldRegistry(WorldFrameState(), tf_publish_static=lambda _tf: None)
    registry.state.commit(np.eye(4, dtype=np.float64), method="manual_pose", approximate=False)
    session, _sent, _registry, tag_tracker = _make_session(registry=registry)
    tag_tracker.active = False
    tag_tracker.process_frame = MagicMock(
        return_value=FrameResult(tag_detected=False, tag_ids=[], quality=0.0, observations_added=0),
    )
    session._world_frame_refiner.committed_or_current_for_frame.return_value = np.eye(
        4, dtype=np.float64
    )
    odom_sample = MagicMock()
    odom_sample.position = (0.0, 0.0, 0.0)
    odom_sample.orientation = (0.0, 0.0, 0.0, 1.0)
    session._odom.at_interpolated_by_source.return_value = odom_sample

    header = {"seq": 2, "ts": 2.0, "send_ts": 2.0, "capture_ts_robot": 2.0}
    await session.on_camera_frame(header, b"jpeg", MagicMock())

    kwargs = tag_tracker.process_frame.call_args.kwargs
    assert kwargs["world_frame_committed"] is True
    assert kwargs["T_committed"] is not None
    session._odom.at_interpolated_by_source.assert_called_once()
