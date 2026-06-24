"""Smoke tests for RegistrationSession — full integration tests live in hardware runs."""

from __future__ import annotations

import asyncio
import time
from unittest.mock import MagicMock, patch

import numpy as np

from dimos.ar.adapters.base import DEFAULT_BASELINE_MOTION_RECIPE
from dimos.ar.bridge.adapter_command_queue import AdapterCommandQueue
from dimos.ar.registration.baseline import (
    SAMPLE_MIN_OBS,
    SAMPLE_SETTLE_S,
    _BaselineState,
    _MovePhase,
)
from dimos.ar.registration.registry import WorldRegistry
from dimos.ar.registration.session import FrameAdmission, RegistrationSession
from dimos.ar.registration.tracker import FrameResult, TagSolve
from dimos.ar.registration.transforms import Calibration
from dimos.ar.registration.types import CaptureHint, RegistrationMode, RegistrationPhase
from dimos.ar.registration.wire import RegistrationCommandMessage, RegistrationStatusPayload


_LEG_DURATIONS = DEFAULT_BASELINE_MOTION_RECIPE.leg_duration_s


def _make_session(
    *,
    registry: WorldRegistry | None = None,
) -> tuple[RegistrationSession, list[str], WorldRegistry]:
    sent: list[str] = []
    sender = MagicMock()
    sender.send.side_effect = sent.append
    calibration = Calibration()
    if registry is None:
        registry = WorldRegistry(calibration, tf_publish_static=lambda _tf: None)
    odom = MagicMock()
    odom.latest.return_value = None
    status = MagicMock()
    tag_tracker = MagicMock()
    tag_tracker.active = False
    tag_tracker.has_camera_info.return_value = True
    tag_tracker.last_tag_detected = False
    tag_tracker.robot_world_pose_estimate.return_value = None
    tag_tracker.latest_waypoint_robot_world_position.return_value = None
    tag_tracker.record_latest_waypoint_observation.return_value = False
    pose_refiner = MagicMock()
    adapter = MagicMock()
    adapter.baseline_motion_available.return_value = True
    adapter.baseline_set_lateral_velocity.return_value = True
    queue = AdapterCommandQueue(adapter)
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
        pose_refiner=pose_refiner,
        adapter=adapter,
        command_queue=queue,
        baseline_motion_available=True,
        baseline_motion_recipe=DEFAULT_BASELINE_MOTION_RECIPE,
    )
    return session, sent, registry


def test_registration_command_start_april_odom_broadcasts_scanning() -> None:
    session, sent, _registry = _make_session()
    session.on_registration_command(
        RegistrationCommandMessage(ts=1.0, robot_id="test_robot", command="start", mode="april_odom_baseline"),
        MagicMock(),
    )
    assert sent
    assert '"type":"registration_status"' in sent[-1]
    assert '"phase":"scanning"' in sent[-1] or '"phase":"failed"' in sent[-1]


def test_registration_command_start_manual_enters_editing() -> None:
    session, sent, _registry = _make_session()
    session.on_registration_command(
        RegistrationCommandMessage(ts=1.0, robot_id="test_robot", command="start", mode="manual_pose"),
        MagicMock(),
    )
    assert sent
    assert '"phase":"editing"' in sent[-1]


def test_frame_admission_processes_during_baseline_estimating() -> None:
    session, _sent, _registry = _make_session()
    session.on_registration_command(
        RegistrationCommandMessage(ts=1.0, robot_id="test_robot", command="start", mode="april_odom_baseline"),
        MagicMock(),
    )
    assert session._baseline is not None
    assert session._baseline.state == _BaselineState.ESTIMATING
    admission = session._frame_admission({"seq": 1, "ts": 1.0, "send_ts": 1.0}, 0.0)
    assert admission == FrameAdmission.PROCESS


def test_frame_admission_processes_during_baseline_leg() -> None:
    session, _sent, _registry = _make_session()
    session.on_registration_command(
        RegistrationCommandMessage(ts=1.0, robot_id="test_robot", command="start", mode="april_odom_baseline"),
        MagicMock(),
    )
    assert session._baseline is not None
    baseline = session._baseline
    pos = (1.0, 0.0, -2.0)
    for i in range(3):
        baseline.tick(obs_count=i, latest_obs_pos_world=pos)
    baseline.authorize_motion()
    assert baseline.state == _BaselineState.MOVE
    admission = session._frame_admission({"seq": 2, "ts": 1.0, "send_ts": 1.0}, 0.0)
    assert admission == FrameAdmission.PROCESS


def test_apply_tracker_update_broadcasts_during_moving() -> None:
    session, sent, _registry = _make_session()
    session.on_registration_command(
        RegistrationCommandMessage(ts=1.0, robot_id="test_robot", command="start", mode="april_odom_baseline"),
        MagicMock(),
    )
    assert session._baseline is not None
    baseline = session._baseline
    for i in range(3):
        baseline.tick(obs_count=i, latest_obs_pos_world=(1.0, 0.0, -2.0))
    baseline.authorize_motion()
    sent.clear()

    session._tag_tracker.active = True
    session._tag_tracker.last_tag_detected = True
    session._tag_tracker.robot_world_pose_estimate.return_value = (
        (1.0, 0.0, -2.0),
        (0.0, 0.0, 0.0, 1.0),
        0.9,
    )
    session._session.last_status = RegistrationStatusPayload(
        mode=RegistrationMode.APRIL_ODOM_BASELINE,
        phase=RegistrationPhase.MOVING,
        capture=CaptureHint.STEADY,
        message="Robot moving — waypoint 1/3",
        tag_visible=True,
        motion=None,
        preview_pose=None,
    )

    session._apply_tracker_update(
        frame_result=FrameResult(tag_detected=True, tag_ids=[0], quality=0.9, observations_added=1),
    )

    assert sent
    assert '"phase":"moving"' in sent[-1]
    assert "Robot moving" in sent[-1]


def test_leg_frame_observations_do_not_tick_baseline_sample() -> None:
    session, _sent, _registry = _make_session()
    session.on_registration_command(
        RegistrationCommandMessage(ts=1.0, robot_id="test_robot", command="start", mode="april_odom_baseline"),
        MagicMock(),
    )
    assert session._baseline is not None
    baseline = session._baseline
    for i in range(3):
        baseline.tick(obs_count=i, latest_obs_pos_world=(1.0, 0.0, -2.0))
    baseline.authorize_motion()

    session._tag_tracker.active = True
    baseline.tick = MagicMock(wraps=baseline.tick)  # type: ignore[method-assign]

    session._apply_tracker_update(
        frame_result=FrameResult(tag_detected=True, tag_ids=[0], quality=0.9, observations_added=1),
    )

    baseline.tick.assert_not_called()


def test_estimating_frame_observations_advance_baseline() -> None:
    session, _sent, _registry = _make_session()
    session.on_registration_command(
        RegistrationCommandMessage(ts=1.0, robot_id="test_robot", command="start", mode="april_odom_baseline"),
        MagicMock(),
    )
    assert session._baseline is not None
    assert session._baseline.is_estimating

    session._tag_tracker.active = True
    session._tag_tracker.robot_world_pose_estimate.return_value = (
        (1.0, 0.0, -2.0),
        (0.0, 0.0, 0.0, 1.0),
        0.9,
    )

    for _ in range(3):
        session._apply_tracker_update(
            frame_result=FrameResult(tag_detected=True, tag_ids=[0], quality=0.9, observations_added=1),
        )

    assert session._baseline.state == _BaselineState.AWAITING_CONFIRM


def test_registration_command_stop_preserves_committed_registration_when_idle() -> None:
    session, _sent, registry = _make_session()
    registry.calibration.register_world_odom(np.eye(4, dtype=np.float64))
    assert registry.calibration.is_registered

    session.on_registration_command(
        RegistrationCommandMessage(ts=1.0, robot_id="test_robot", command="stop"),
        MagicMock(),
    )

    assert registry.calibration.is_registered
    session._status.set_registered.assert_not_called()


def _advance_baseline_to_awaiting_confirm(baseline) -> None:
    pos = (1.0, 0.0, -2.0)
    for i in range(3):
        baseline.tick(obs_count=i, latest_obs_pos_world=pos)
    assert baseline.state == _BaselineState.AWAITING_CONFIRM


def _stable_sample_positions(base: float = 1.0) -> list[tuple[float, float, float]]:
    return [(base + i * 0.001, 0.0, -2.0) for i in range(SAMPLE_MIN_OBS)]


def _drive_baseline_through_sample(baseline, *, expected_leg_after: int | None) -> None:
    settle_mono = baseline._sample_settle_mono
    assert settle_mono is not None
    with patch("dimos.ar.registration.baseline.time") as mt:
        mt.monotonic.return_value = settle_mono + SAMPLE_SETTLE_S + 0.01
        for pos in _stable_sample_positions():
            baseline.tick(obs_count=SAMPLE_MIN_OBS, latest_obs_pos_world=pos)
    if expected_leg_after is None:
        assert baseline.state == _BaselineState.DONE
    else:
        assert baseline._move_leg_index == expected_leg_after
        assert baseline._move_phase == _MovePhase.LEG


def _wait_for_leg_timer(baseline) -> float:
    for _ in range(100):
        if baseline._move_start_mono is not None:
            return baseline._move_start_mono
        time.sleep(0.01)
    raise AssertionError("leg timer never started after velocity ack")


def _drive_baseline_to_done(baseline) -> None:
    _advance_baseline_to_awaiting_confirm(baseline)
    baseline.authorize_motion()

    t0 = _wait_for_leg_timer(baseline)
    with patch("dimos.ar.registration.baseline.time") as mt:
        mt.monotonic.return_value = t0 + _LEG_DURATIONS[0] + 0.1
        baseline.tick(obs_count=0, latest_obs_pos_world=None)
    _drive_baseline_through_sample(baseline, expected_leg_after=1)

    t1 = _wait_for_leg_timer(baseline)
    with patch("dimos.ar.registration.baseline.time") as mt:
        mt.monotonic.return_value = t1 + _LEG_DURATIONS[1] + 0.1
        baseline.tick(obs_count=0, latest_obs_pos_world=None)
    _drive_baseline_through_sample(baseline, expected_leg_after=2)

    t2 = _wait_for_leg_timer(baseline)
    with patch("dimos.ar.registration.baseline.time") as mt:
        mt.monotonic.return_value = t2 + _LEG_DURATIONS[2] + 0.1
        baseline.tick(obs_count=0, latest_obs_pos_world=None)
    _drive_baseline_through_sample(baseline, expected_leg_after=None)


def test_authorize_motion_command_broadcasts_moving() -> None:
    session, sent, _registry = _make_session()
    session.on_registration_command(
        RegistrationCommandMessage(ts=1.0, robot_id="test_robot", command="start", mode="april_odom_baseline"),
        MagicMock(),
    )
    assert session._baseline is not None
    _advance_baseline_to_awaiting_confirm(session._baseline)
    sent.clear()

    session.on_registration_command(
        RegistrationCommandMessage(ts=2.0, robot_id="test_robot", command="authorize_motion"),
        MagicMock(),
    )

    assert any('"phase":"moving"' in payload for payload in sent)


def test_full_baseline_auto_commit() -> None:
    session, sent, registry = _make_session()
    session.on_registration_command(
        RegistrationCommandMessage(ts=1.0, robot_id="test_robot", command="start", mode="april_odom_baseline"),
        MagicMock(),
    )
    assert session._baseline is not None
    _drive_baseline_to_done(session._baseline)

    solve = TagSolve(
        T_world_odom=np.eye(4, dtype=np.float64),
        method="apriltag_full",
        quality=0.95,
        observation_count=8,
        baseline_m=0.40,
    )
    session._tag_tracker.current_solve.return_value = solve
    sent.clear()

    asyncio.run(session._maybe_finish_baseline())

    assert registry.calibration.is_registered
    assert any('"phase":"succeeded"' in payload for payload in sent)
    session._status.set_registered.assert_called_once()


async def _broadcast_iteration_when_baseline_done(session: RegistrationSession) -> None:
    """One body iteration of the fixed ``_broadcast_loop`` after baseline DONE."""
    assert session._baseline is not None
    if session._baseline.is_active:
        session._baseline.tick(
            obs_count=session._tag_tracker.observation_count(),
            latest_obs_pos_world=None,
        )
    await session._maybe_finish_baseline()


def test_broadcast_loop_auto_commits_when_baseline_done() -> None:
    """Regression: finish check must run when baseline is DONE (not is_active)."""
    session, sent, registry = _make_session()
    session.on_registration_command(
        RegistrationCommandMessage(ts=1.0, robot_id="test_robot", command="start", mode="april_odom_baseline"),
        MagicMock(),
    )
    assert session._baseline is not None
    _drive_baseline_to_done(session._baseline)
    assert session._baseline.is_done
    assert not session._baseline.is_active

    solve = TagSolve(
        T_world_odom=np.eye(4, dtype=np.float64),
        method="apriltag_full",
        quality=0.95,
        observation_count=8,
        baseline_m=0.40,
    )
    session._tag_tracker.current_solve.return_value = solve
    sent.clear()

    asyncio.run(_broadcast_iteration_when_baseline_done(session))

    assert registry.calibration.is_registered
    assert any('"phase":"succeeded"' in payload for payload in sent)
    session._status.set_registered.assert_called_once()
