"""RegistrationSession tests for the similarity-aligner registration flow."""

from __future__ import annotations

import asyncio
import json
import time
from unittest.mock import MagicMock

import numpy as np

from dimos.ar.registration.session import RegistrationSession
from dimos.ar.registration.session.flows import TAG_REGISTRATION_WINDOW_S
from dimos.ar.registration.types import RegistrationMode
from dimos.ar.registration.wire import RegistrationCommandMessage
from dimos.ar.tag_tracking.solve import TagMount, TagObservation
from dimos.ar.world_frame.aligner import AlignmentEstimate
from dimos.ar.world_frame.registry import WorldRegistry
from dimos.ar.world_frame.state import WorldFrameState


def _observations(count: int) -> list[TagObservation]:
    now = time.monotonic()
    return [
        TagObservation(
            mono_ts=now - 0.1 * idx,
            tag_id=0,
            p_world_tag=(1.0 + idx, 0.0, 0.0),
            p_odom_tag=(float(idx), 0.0, 0.0),
            T_world_tag=np.eye(4, dtype=np.float64),
            T_odom_tag=np.eye(4, dtype=np.float64),
            T_odom_base=np.eye(4, dtype=np.float64),
            quality=0.9,
            reprojection_error_px=0.5,
        )
        for idx in range(count)
    ]


def _estimate(
    *,
    confidence: float = 0.4,
    approximate: bool = True,
    yaw_observable: bool = False,
    scale_observable: bool = False,
) -> AlignmentEstimate:
    return AlignmentEstimate(
        method="similarity",
        scale=1.2,
        yaw_rad=0.25,
        translation_world=(1.5, 0.0, -0.5),
        confidence=confidence,
        yaw_observable=yaw_observable,
        scale_observable=scale_observable,
        residual_rms_m=0.02,
        baseline_m=0.2,
        observation_count=4,
        rejected_count=0,
        alpha_yaw=1.0 if yaw_observable else 0.0,
        alpha_scale=1.0 if scale_observable else 0.0,
        quality_term=0.9,
        mean_ambiguity_ratio=1.6,
        max_pair_skew_s=0.02,
        approximate=approximate,
        scale_confidence=0.0,
        yaw_confidence=0.3 if yaw_observable else 0.0,
        scale_held=not scale_observable,
        yaw_held=not yaw_observable,
    )


def _make_session() -> tuple[RegistrationSession, list[str], WorldRegistry, MagicMock]:
    sent: list[str] = []
    sender = MagicMock()
    sender.send.side_effect = sent.append
    registry = WorldRegistry(WorldFrameState(), tf_publish_static=lambda _tf: None)
    odom = MagicMock()
    status = MagicMock()
    tag_tracker = MagicMock()
    tag_tracker.mounts_configured.return_value = True
    tag_tracker.has_camera_info.return_value = True
    tag_tracker.last_tag_detected = True
    tag_tracker.active = True
    tag_tracker.recent_observations.return_value = _observations(2)
    tag_tracker.robot_world_pose_estimate.return_value = (
        (1.0, 0.0, -2.0),
        (0.0, 0.0, 0.0, 1.0),
        0.9,
    )
    world_frame_refiner = MagicMock()
    world_frame_refiner.registration_min_observations.return_value = 4
    world_frame_refiner.registration_confidence_min.return_value = 0.7
    world_frame_refiner.scale_lock_confidence_threshold.return_value = 0.6
    world_frame_refiner.registration_alignment_estimate.return_value = _estimate()
    world_frame_refiner.current_alignment_estimate.return_value = _estimate()
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
        capture_min_tag_px=24.0,
        capture_max_distance_margin=1.25,
        capture_max_speed_mps=0.45,
        capture_min_distance_m=0.35,
        align_min_obs=3,
    )
    return session, sent, registry, tag_tracker


def test_broadcast_status_uses_aligner_observation_threshold() -> None:
    session, sent, _registry, _tag_tracker = _make_session()
    session.on_registration_command(
        RegistrationCommandMessage(
            ts=1.0,
            robot_id="test_robot",
            command="start",
            mode="april_tag",
        ),
        MagicMock(),
    )
    sent.clear()

    session._broadcast_status()

    payload = json.loads(sent[-1])
    assert payload["progress"] == 40
    assert payload["alignment_confidence"] == 0.4
    assert payload["refining"] is False


def test_maybe_finish_tag_registration_waits_for_confidence() -> None:
    session, sent, registry, tag_tracker = _make_session()
    session.on_registration_command(
        RegistrationCommandMessage(
            ts=1.0,
            robot_id="test_robot",
            command="start",
            mode="april_tag",
        ),
        MagicMock(),
    )
    session._world_frame_refiner.registration_alignment_estimate.return_value = _estimate(
        confidence=0.2,
    )
    sent.clear()

    asyncio.run(session._maybe_finish_tag_registration())

    assert registry.state.is_committed is False
    assert tag_tracker.active is True
    assert not any(json.loads(payload)["phase"] == "succeeded" for payload in sent)


def test_maybe_finish_tag_registration_commits_via_stability_fallback() -> None:
    session, sent, registry, tag_tracker = _make_session()
    now = time.monotonic()
    mount = TagMount(
        tag_id=0,
        size_m=0.056,
        position=(0.0, 0.0, 0.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )
    T_world_tag = np.eye(4, dtype=np.float64)
    T_world_tag[0, 3] = 1.0
    observations = [
        TagObservation(
            mono_ts=now - 0.1 * idx,
            tag_id=0,
            p_world_tag=(1.0, 0.0, 0.0),
            p_odom_tag=(0.0, 0.0, 0.0),
            T_world_tag=np.array(T_world_tag, dtype=np.float64, copy=True),
            T_odom_tag=np.eye(4, dtype=np.float64),
            T_odom_base=np.eye(4, dtype=np.float64),
            quality=0.9,
            reprojection_error_px=0.5,
        )
        for idx in range(4)
    ]
    tag_tracker.recent_observations.return_value = observations
    tag_tracker.mounts_snapshot.return_value = {0: mount}
    session.on_registration_command(
        RegistrationCommandMessage(
            ts=1.0,
            robot_id="test_robot",
            command="start",
            mode="april_tag",
        ),
        MagicMock(),
    )
    session._world_frame_refiner.registration_alignment_estimate.return_value = _estimate(
        confidence=0.2,
    )
    session._odom.latest.return_value = MagicMock()
    sent.clear()

    asyncio.run(session._maybe_finish_tag_registration())

    assert registry.state.is_committed is True
    assert any(json.loads(payload)["phase"] == "succeeded" for payload in sent)
    assert tag_tracker.active is False


def test_april_tag_progress_uses_observations_before_confidence() -> None:
    session, sent, _registry, tag_tracker = _make_session()
    tag_tracker.recent_observations.return_value = _observations(2)
    session._world_frame_refiner.registration_alignment_estimate.return_value = None
    session.on_registration_command(
        RegistrationCommandMessage(
            ts=1.0,
            robot_id="test_robot",
            command="start",
            mode="april_tag",
        ),
        MagicMock(),
    )
    sent.clear()

    session._broadcast_status()

    payload = json.loads(sent[-1])
    assert payload["progress"] == 40
    assert payload.get("alignment_confidence") is None


def test_maybe_finish_tag_registration_commits_when_confident() -> None:
    session, sent, registry, tag_tracker = _make_session()
    session.on_registration_command(
        RegistrationCommandMessage(
            ts=1.0,
            robot_id="test_robot",
            command="start",
            mode="april_tag",
        ),
        MagicMock(),
    )
    session._world_frame_refiner.registration_alignment_estimate.return_value = _estimate(
        confidence=0.85,
        yaw_observable=True,
        approximate=True,
    )
    session._odom.latest.return_value = MagicMock()
    sent.clear()

    asyncio.run(session._maybe_finish_tag_registration())

    assert registry.state.is_committed is True
    assert any(json.loads(payload)["phase"] == "succeeded" for payload in sent)
    assert tag_tracker.active is False


def test_maybe_finish_tag_registration_commits_aligner_candidate() -> None:
    session, sent, registry, tag_tracker = _make_session()
    session.on_registration_command(
        RegistrationCommandMessage(
            ts=1.0,
            robot_id="test_robot",
            command="start",
            mode="april_tag",
        ),
        MagicMock(),
    )
    session._odom.latest.return_value = MagicMock()
    session._world_frame_refiner.registration_alignment_estimate.return_value = _estimate(
        confidence=0.85,
        yaw_observable=True,
    )
    sent.clear()

    asyncio.run(session._maybe_finish_tag_registration())

    assert registry.state.is_committed is True
    assert registry.state.method == RegistrationMode.APRIL_TAG
    assert registry.state.approximate is True
    assert registry.state.odom_scale == 1.2
    transform = registry.state.current_transform()
    assert transform is not None
    assert transform[0, 3] == 1.5
    assert transform[2, 3] == -0.5
    assert any(json.loads(payload)["phase"] == "succeeded" for payload in sent)
    assert tag_tracker.active is False


def test_maybe_finish_tag_registration_fails_on_scan_timeout() -> None:
    session, sent, registry, tag_tracker = _make_session()
    session.on_registration_command(
        RegistrationCommandMessage(
            ts=1.0,
            robot_id="test_robot",
            command="start",
            mode="april_tag",
        ),
        MagicMock(),
    )
    session._session.april_tag_started_mono = time.monotonic() - TAG_REGISTRATION_WINDOW_S - 1.0
    session._world_frame_refiner.registration_alignment_estimate.return_value = _estimate(
        confidence=0.2,
    )
    sent.clear()

    asyncio.run(session._maybe_finish_tag_registration())

    assert registry.state.is_committed is False
    assert tag_tracker.active is False
    assert any(json.loads(payload)["phase"] == "failed" for payload in sent)


def test_broadcast_status_marks_refining_after_provisional_commit() -> None:
    session, sent, registry, tag_tracker = _make_session()
    registry.state.commit(np.eye(4, dtype=np.float64), method="april_tag", approximate=True)
    tag_tracker.active = False
    session._session.mode = RegistrationMode.APRIL_TAG
    sent.clear()

    session._broadcast_status()

    payload = json.loads(sent[-1])
    assert payload["alignment_confidence"] == 0.4
    assert payload["refining"] is True


def test_registration_start_clears_post_success_state() -> None:
    session, _sent, registry, tag_tracker = _make_session()
    registry.state.commit(np.eye(4, dtype=np.float64), method="april_tag", approximate=True)
    tag_tracker.active = False
    session._session.mode = RegistrationMode.APRIL_TAG
    session._frame_in_flight = True
    tag_tracker.reset_window.reset_mock()

    session.on_registration_command(
        RegistrationCommandMessage(
            ts=2.0,
            robot_id="test_robot",
            command="start",
            mode="april_tag",
        ),
        MagicMock(),
    )

    assert session._frame_in_flight is False
    tag_tracker.reset_window.assert_called()
    assert registry.state.is_committed is False
    assert session._session.mode == RegistrationMode.APRIL_TAG


def test_finish_april_tag_registration_clears_session() -> None:
    session, sent, registry, tag_tracker = _make_session()
    session.on_registration_command(
        RegistrationCommandMessage(
            ts=1.0,
            robot_id="test_robot",
            command="start",
            mode="april_tag",
        ),
        MagicMock(),
    )
    session._world_frame_refiner.registration_alignment_estimate.return_value = _estimate(
        confidence=0.85,
        yaw_observable=True,
    )
    session._odom.latest.return_value = MagicMock()
    sent.clear()

    asyncio.run(session._maybe_finish_tag_registration())

    assert registry.state.is_committed is True
    assert session._session.mode is None
    assert any(json.loads(payload)["phase"] == "succeeded" for payload in sent)
