"""Regression tests for WorldFrameRefiner runtime correction semantics."""

from __future__ import annotations

import json
import math
from unittest.mock import MagicMock

import numpy as np
import pytest

from dimos.ar.bridge.odom_buffer import OdomBuffer
from dimos.ar.bridge.sender import BridgeSender
from dimos.ar.bridge.telemetry import TelemetryPublisher
from dimos.ar.lidar.filters import LidarFilter, LidarFilterConfig
from dimos.ar.robot_profile.base import TagTrackingProfile
from dimos.ar.tag_tracking.solve import (
    TagObservation,
    TagSolve,
    _yaw_from_T,
    build_T_world_odom,
)
from dimos.ar.tag_tracking.tracker import RobotAprilTagTracker, RobotAprilTagTrackerConfig
from dimos.ar.world_frame.refinement import WorldFrameRefiner
from dimos.ar.world_frame.registry import WorldRegistry
from dimos.ar.world_frame.state import ODOM_SCALE_INITIAL, WorldFrameState
from dimos.ar.world_frame.transforms import OdomSample, pose_to_matrix


def _make_world_frame_refiner(
    *,
    record_tf: list[object] | None = None,
) -> tuple[
    WorldFrameRefiner,
    RobotAprilTagTracker,
    WorldFrameState,
    OdomBuffer,
    list[str],
    WorldRegistry,
]:
    sent: list[str] = []
    mock_server = MagicMock()
    mock_server.schedule_send.side_effect = lambda msg: sent.append(msg)

    sender = BridgeSender()
    sender.bind(mock_server)

    tf_log: list[object] = record_tf if record_tf is not None else []
    state = WorldFrameState()
    registry = WorldRegistry(state, tf_log.append if record_tf is not None else lambda _tf: None)
    odom = OdomBuffer()
    tag_tracker = RobotAprilTagTracker([], config=RobotAprilTagTrackerConfig())
    telemetry = TelemetryPublisher(
        robot_id="test_robot",
        sender=sender,
        world_frame=state,
        odom=odom,
        lidar_filter=LidarFilter(
            LidarFilterConfig(
                max_range_m=None,
                min_height_m=-1.0,
                max_height_m=2.0,
                target_points=100,
                max_hz=0.0,
            )
        ),
        target_points=100,
        obstacle_target_points=20,
        lidar_voxel_size_m=0.05,
        pose_max_hz=30.0,
    )

    refiner = WorldFrameRefiner(
        registry=registry,
        telemetry=telemetry,
        robot_id="test_robot",
        sender=sender,
        odom=odom,
        tag_tracker=tag_tracker,
        runtime_profile=TagTrackingProfile(),
        runtime_correction_enabled=True,
    )
    registry.attach_refiner(refiner)
    odom.speed_windowed = MagicMock(return_value=0.0)  # type: ignore[method-assign]
    return refiner, tag_tracker, state, odom, sent, registry


def _commit_state(state: WorldFrameState, T: object) -> None:
    state.commit(T, method="april_tag", approximate=False)  # type: ignore[arg-type]


def test_bootstrap_initializes_baseline_via_registry() -> None:
    """Committed state without refiner baseline bootstraps via registry (TF + baseline)."""
    published_tf: list[object] = []
    refiner, tag_tracker, state, _odom, sent, _registry = _make_world_frame_refiner(
        record_tf=published_tf,
    )

    theta = math.radians(10.0)
    T_committed = build_T_world_odom(theta, (0.0, 0.0, 0.0))
    _commit_state(state, T_committed)

    T_target = build_T_world_odom(theta, (0.5, 0.0, -0.5))
    solve = TagSolve(
        T_world_odom=T_target.copy(),
        method="apriltag_translation",
        quality=0.9,
        observation_count=1,
        baseline_m=0.0,
    )
    tag_tracker.current_solve = MagicMock(return_value=None)  # type: ignore[method-assign]
    tag_tracker.current_translation_solve = MagicMock(return_value=solve)  # type: ignore[method-assign]

    refiner.apply_tracker_update()

    assert refiner.refinement_baseline is not None
    assert len(published_tf) == 1
    corrections = [
        json.loads(payload)
        for payload in sent
        if json.loads(payload).get("type") == "world_frame_correction"
    ]
    assert len(corrections) == 0
    pose_payloads = [
        json.loads(payload) for payload in sent if json.loads(payload).get("type") == "pose"
    ]
    assert len(pose_payloads) == 0


def test_runtime_smoothing_preserves_heading() -> None:
    """Regression guard: one smoothing step on an identical solve must not flip the yaw."""
    refiner, tag_tracker, state, _odom, _sent, _registry = _make_world_frame_refiner()

    theta = math.radians(30.0)
    T_committed = build_T_world_odom(theta, (1.0, 0.0, -2.0))

    refiner.set_refinement_baseline(T_committed)
    _commit_state(state, T_committed)

    solve = TagSolve(
        T_world_odom=T_committed.copy(),
        method="apriltag_full",
        quality=1.0,
        observation_count=8,
        baseline_m=0.40,
    )
    tag_tracker.current_solve = MagicMock(return_value=solve)  # type: ignore[method-assign]
    tag_tracker.current_translation_solve = MagicMock(return_value=solve)  # type: ignore[method-assign]

    refiner.apply_tracker_update()

    committed_yaw = _yaw_from_T(refiner.refinement_baseline)
    assert committed_yaw == pytest.approx(theta, abs=1e-6), (
        f"Heading flipped: expected {math.degrees(theta):.1f}°, "
        f"got {math.degrees(committed_yaw):.1f}°"
    )


def test_runtime_translation_solve_corrects_stationary_robot() -> None:
    """When baseline solve is unavailable, runtime translation solve must still update."""
    refiner, tag_tracker, state, _odom, sent, _registry = _make_world_frame_refiner()

    theta = math.radians(20.0)
    T_committed = build_T_world_odom(theta, (0.0, 0.0, 0.0))
    refiner.set_refinement_baseline(T_committed)
    _commit_state(state, T_committed)

    T_target = build_T_world_odom(theta, (1.0, 0.0, -1.0))
    solve = TagSolve(
        T_world_odom=T_target.copy(),
        method="apriltag_translation",
        quality=0.95,
        observation_count=1,
        baseline_m=0.0,
    )
    tag_tracker.current_solve = MagicMock(return_value=None)  # type: ignore[method-assign]
    tag_tracker.current_translation_solve = MagicMock(return_value=solve)  # type: ignore[method-assign]

    refiner.apply_tracker_update()

    committed_yaw = _yaw_from_T(refiner.refinement_baseline)
    assert committed_yaw == pytest.approx(theta, abs=1e-6)
    assert refiner.refinement_baseline[0, 3] == pytest.approx(1.0, abs=1e-3)
    assert refiner.refinement_baseline[2, 3] == pytest.approx(-1.0, abs=1e-3)
    corrections = [
        json.loads(payload)
        for payload in sent
        if json.loads(payload).get("type") == "world_frame_correction"
    ]
    assert len(corrections) == 1
    assert corrections[0]["solve_method"] == "apriltag_translation"


def test_runtime_correction_emits_fresh_pose_for_stationary_robot() -> None:
    """A runtime correction must push an updated pose even without new odom traffic."""
    refiner, tag_tracker, state, odom, sent, _registry = _make_world_frame_refiner()

    theta = math.radians(20.0)
    T_committed = build_T_world_odom(theta, (0.0, 0.0, 0.0))
    refiner.set_refinement_baseline(T_committed)
    _commit_state(state, T_committed)
    odom._latest = OdomSample(  # type: ignore[attr-defined]
        position=(0.0, 0.0, 0.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
        source_ts=123.456,
    )

    T_target = build_T_world_odom(theta, (1.0, 0.0, -1.0))
    solve = TagSolve(
        T_world_odom=T_target.copy(),
        method="apriltag_translation",
        quality=0.95,
        observation_count=1,
        baseline_m=0.0,
    )
    tag_tracker.current_solve = MagicMock(return_value=None)  # type: ignore[method-assign]
    tag_tracker.current_translation_solve = MagicMock(return_value=solve)  # type: ignore[method-assign]

    refiner.apply_tracker_update()

    payloads = [json.loads(m) for m in sent]
    pose_payloads = [m for m in payloads if m["type"] == "pose"]
    assert pose_payloads, "runtime correction should emit an immediate pose snapshot"
    latest_pose = pose_payloads[-1]
    assert latest_pose["ts"] == pytest.approx(123.456, abs=1e-3)
    assert latest_pose["position"] == pytest.approx([1.0, 0.0, -1.0], abs=1e-3)


def test_runtime_correction_below_deadband_emits_no_world_frame_correction() -> None:
    """A correction below the notification deadband must update T_world_odom
    without emitting a world_frame_correction message."""
    refiner, tag_tracker, state, _odom, sent, _registry = _make_world_frame_refiner()

    theta = math.radians(20.0)
    T_committed = build_T_world_odom(theta, (0.0, 0.0, 0.0))
    refiner.set_refinement_baseline(T_committed)
    _commit_state(state, T_committed)

    T_target = build_T_world_odom(theta + math.radians(0.5), (0.02, 0.0, 0.0))
    solve = TagSolve(
        T_world_odom=T_target.copy(),
        method="apriltag_translation",
        quality=0.95,
        observation_count=1,
        baseline_m=0.0,
    )
    tag_tracker.current_solve = MagicMock(return_value=None)  # type: ignore[method-assign]
    tag_tracker.current_translation_solve = MagicMock(return_value=solve)  # type: ignore[method-assign]

    refiner.apply_tracker_update()

    corrections = [
        json.loads(payload)
        for payload in sent
        if json.loads(payload).get("type") == "world_frame_correction"
    ]
    assert len(corrections) == 0, (
        "world_frame_correction should not fire for sub-threshold corrections"
    )
    assert refiner.refinement_baseline is not None


def test_runtime_correction_above_deadband_emits_world_frame_correction() -> None:
    """A correction that exceeds the notification deadband must emit world_frame_correction."""
    refiner, tag_tracker, state, _odom, sent, _registry = _make_world_frame_refiner()

    theta = math.radians(20.0)
    T_committed = build_T_world_odom(theta, (0.0, 0.0, 0.0))
    refiner.set_refinement_baseline(T_committed)
    _commit_state(state, T_committed)

    T_target = build_T_world_odom(theta, (0.25, 0.0, 0.0))
    solve = TagSolve(
        T_world_odom=T_target.copy(),
        method="apriltag_translation",
        quality=0.95,
        observation_count=1,
        baseline_m=0.0,
    )
    tag_tracker.current_solve = MagicMock(return_value=None)  # type: ignore[method-assign]
    tag_tracker.current_translation_solve = MagicMock(return_value=solve)  # type: ignore[method-assign]

    refiner.apply_tracker_update()

    corrections = [
        json.loads(payload)
        for payload in sent
        if json.loads(payload).get("type") == "world_frame_correction"
    ]
    assert len(corrections) == 1
    assert corrections[0]["solve_method"] == "apriltag_translation"


def test_runtime_yaw_gate_holds_on_curve() -> None:
    refiner, tag_tracker, state, odom, _sent, _registry = _make_world_frame_refiner()
    odom.speed_windowed = MagicMock(return_value=0.5)  # type: ignore[method-assign]

    theta = math.radians(15.0)
    T_committed = build_T_world_odom(theta, (0.0, 0.0, 0.0))
    refiner.set_refinement_baseline(T_committed)
    _commit_state(state, T_committed)

    T_target = build_T_world_odom(theta + math.radians(5.0), (0.2, 0.0, -0.2))
    solve = TagSolve(
        T_world_odom=T_target.copy(),
        method="apriltag_full",
        quality=0.9,
        observation_count=6,
        baseline_m=0.5,
        straightness=0.8,
    )
    translation_solve = TagSolve(
        T_world_odom=build_T_world_odom(theta, (0.2, 0.0, -0.2)),
        method="apriltag_translation",
        quality=0.9,
        observation_count=1,
        baseline_m=0.0,
    )
    tag_tracker.current_solve = MagicMock(return_value=solve)  # type: ignore[method-assign]
    tag_tracker.current_translation_solve = MagicMock(  # type: ignore[method-assign]
        return_value=translation_solve,
    )

    refiner.apply_tracker_update()

    assert _yaw_from_T(refiner.refinement_baseline) == pytest.approx(theta, abs=1e-6)
    assert refiner.refinement_baseline[0, 3] == pytest.approx(0.2, abs=1e-3)


def test_cruise_yaw_gate_failure_uses_translation_solve_far_from_origin() -> None:
    """When cruise yaw gate fails, translation solve under committed yaw must not
    accumulate distance-scaled error from a Kabsch translation hybrid."""
    refiner, tag_tracker, state, odom, _sent, _registry = _make_world_frame_refiner()
    odom.speed_windowed = MagicMock(return_value=0.5)  # type: ignore[method-assign]

    theta_committed = math.radians(2.0)
    T_committed = build_T_world_odom(theta_committed, (0.0, 0.0, 0.0))
    refiner.set_refinement_baseline(T_committed)
    _commit_state(state, T_committed)
    state.set_odom_anchor_xy(10.0, 0.0)
    odom._latest = OdomSample(  # type: ignore[attr-defined]
        position=(10.0, 0.0, 0.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )

    # Kabsch full solve: yaw 5° ahead of committed; translation consistent with that yaw.
    kabsch_yaw = theta_committed + math.radians(5.0)
    odom_pos = np.array([10.0, 0.0, 0.0])
    translation_T = build_T_world_odom(theta_committed, (0.15, 0.0, -0.1))
    true_world = translation_T[:3, :3] @ odom_pos + translation_T[:3, 3]
    kabsch_t = true_world - build_T_world_odom(kabsch_yaw, (0.0, 0.0, 0.0))[:3, :3] @ odom_pos
    kabsch_T = build_T_world_odom(kabsch_yaw, tuple(kabsch_t))
    full_solve = TagSolve(
        T_world_odom=kabsch_T.copy(),
        method="apriltag_full",
        quality=0.9,
        observation_count=6,
        baseline_m=0.5,
        straightness=0.8,
    )
    translation_solve = TagSolve(
        T_world_odom=translation_T.copy(),
        method="apriltag_translation",
        quality=0.9,
        observation_count=1,
        baseline_m=0.0,
    )
    tag_tracker.current_solve = MagicMock(return_value=full_solve)  # type: ignore[method-assign]
    tag_tracker.current_translation_solve = MagicMock(  # type: ignore[method-assign]
        return_value=translation_solve,
    )

    refiner.apply_tracker_update()

    assert _yaw_from_T(refiner.refinement_baseline) == pytest.approx(theta_committed, abs=1e-6)

    true_world_pose, _ = state.transform_pose((10.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))
    assert list(true_world_pose) == pytest.approx(list(true_world), abs=0.05)

    # Pre-fix hybrid: committed yaw + Kabsch translation vector.
    hybrid_T = build_T_world_odom(theta_committed, tuple(kabsch_t))
    hybrid_world = hybrid_T[:3, :3] @ odom_pos + hybrid_T[:3, 3]
    hybrid_error = float(np.linalg.norm(hybrid_world - true_world))
    assert hybrid_error > 0.2


def test_runtime_yaw_gate_allows_straight_run() -> None:
    refiner, tag_tracker, state, odom, _sent, _registry = _make_world_frame_refiner()
    odom.speed_windowed = MagicMock(return_value=0.5)  # type: ignore[method-assign]

    theta = math.radians(15.0)
    T_committed = build_T_world_odom(theta, (0.0, 0.0, 0.0))
    refiner.set_refinement_baseline(T_committed)
    _commit_state(state, T_committed)

    T_target = build_T_world_odom(theta + math.radians(5.0), (0.2, 0.0, -0.2))
    solve = TagSolve(
        T_world_odom=T_target.copy(),
        method="apriltag_full",
        quality=0.9,
        observation_count=6,
        baseline_m=0.5,
        straightness=0.1,
    )
    tag_tracker.current_solve = MagicMock(return_value=solve)  # type: ignore[method-assign]

    refiner.apply_tracker_update()

    assert _yaw_from_T(refiner.refinement_baseline) != pytest.approx(theta, abs=1e-6)


def test_floor_lock_overrides_low_tag_y_on_translation_solve() -> None:
    refiner, tag_tracker, state, odom, _sent, _registry = _make_world_frame_refiner()

    theta = math.radians(10.0)
    T_committed = build_T_world_odom(theta, (0.0, 0.5, 0.0))
    refiner.set_refinement_baseline(T_committed)
    refiner.set_floor_lock(0.5)
    _commit_state(state, T_committed)
    odom._latest = OdomSample(  # type: ignore[attr-defined]
        position=(0.0, 0.0, 0.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )

    T_target = build_T_world_odom(theta, (1.0, 0.1, -1.0))
    solve = TagSolve(
        T_world_odom=T_target.copy(),
        method="apriltag_translation",
        quality=0.95,
        observation_count=1,
        baseline_m=0.0,
    )
    tag_tracker.current_solve = MagicMock(return_value=None)  # type: ignore[method-assign]
    tag_tracker.current_translation_solve = MagicMock(return_value=solve)  # type: ignore[method-assign]

    refiner.apply_tracker_update()

    base_world = refiner._robot_base_world_position(odom._latest)  # type: ignore[arg-type]
    assert base_world is not None
    assert base_world[1] == pytest.approx(0.5, abs=1e-3)


def test_stop_yaw_solve_on_static_transition() -> None:
    refiner, tag_tracker, state, odom, sent, _registry = _make_world_frame_refiner()
    odom.speed_windowed = MagicMock(side_effect=[0.5, 0.0])  # type: ignore[method-assign]

    theta_committed = math.radians(0.0)
    true_yaw = math.radians(5.0)
    T_committed = build_T_world_odom(theta_committed, (0.0, 0.0, 0.0))
    refiner.set_refinement_baseline(T_committed)
    _commit_state(state, T_committed)

    stop_yaw_solve = TagSolve(
        T_world_odom=build_T_world_odom(true_yaw, (0.2, 0.0, -0.2)),
        method="apriltag_full",
        quality=0.9,
        observation_count=8,
        baseline_m=0.5,
        straightness=0.1,
    )

    def solve_side_effect(**kwargs: object) -> TagSolve | None:
        if kwargs.get("max_age_s") == 30.0:
            return stop_yaw_solve
        return None

    tag_tracker.current_solve = MagicMock(side_effect=solve_side_effect)  # type: ignore[method-assign]
    tag_tracker.current_translation_solve = MagicMock(return_value=None)  # type: ignore[method-assign]

    refiner.apply_tracker_update()
    refiner.apply_tracker_update()

    assert _yaw_from_T(refiner.refinement_baseline) == pytest.approx(true_yaw, abs=1e-3)
    corrections = [
        json.loads(payload)
        for payload in sent
        if json.loads(payload).get("type") == "world_frame_correction"
    ]
    assert any(c.get("yaw_corrected") is True for c in corrections)


def _scale_pair_observation(
    *,
    mono_ts: float,
    p_odom_xy: tuple[float, float],
    p_world_xz: tuple[float, float],
    dist_cam_m: float = 1.0,
) -> TagObservation:
    T_world = np.eye(4, dtype=np.float64)
    T_world[:3, 3] = (p_world_xz[0], 0.0, p_world_xz[1])
    T_odom_base = np.eye(4, dtype=np.float64)
    T_odom_base[0, 3] = p_odom_xy[0]
    T_odom_base[1, 3] = p_odom_xy[1]
    return TagObservation(
        mono_ts=mono_ts,
        tag_id=0,
        p_world_tag=(p_world_xz[0], 0.0, p_world_xz[1]),
        p_odom_tag=(p_odom_xy[0], p_odom_xy[1], 0.0),
        T_world_tag=T_world,
        T_odom_tag=T_world,
        T_odom_base=T_odom_base,
        quality=0.95,
        reprojection_error_px=0.5,
        dist_cam_m=dist_cam_m,
    )


def test_odom_scale_estimator_converges_from_valid_pairs() -> None:
    refiner, tag_tracker, state, _odom, _sent, _registry = _make_world_frame_refiner()
    state.commit(np.eye(4, dtype=np.float64), method="april_tag", approximate=False)
    refiner.set_refinement_baseline(np.eye(4, dtype=np.float64))

    tag_tracker._observations.append(
        _scale_pair_observation(mono_ts=0.0, p_odom_xy=(0.0, 0.0), p_world_xz=(0.0, 0.0))
    )
    tag_tracker._observations.append(
        _scale_pair_observation(mono_ts=1.0, p_odom_xy=(1.5, 0.0), p_world_xz=(1.74, 0.0))
    )
    refiner._maybe_update_odom_scale(resolved_odom=None)
    tag_tracker._observations.append(
        _scale_pair_observation(mono_ts=2.0, p_odom_xy=(3.0, 0.0), p_world_xz=(3.48, 0.0))
    )
    refiner._maybe_update_odom_scale(resolved_odom=None)

    assert 1.05 <= state.odom_scale <= 1.18
    assert state.odom_scale >= ODOM_SCALE_INITIAL


def test_odom_scale_estimator_rejects_bad_pairs() -> None:
    refiner, tag_tracker, state, _odom, _sent, _registry = _make_world_frame_refiner()
    state.commit(np.eye(4, dtype=np.float64), method="april_tag", approximate=False)

    tag_tracker._observations.append(_scale_pair_observation(mono_ts=0.0, p_odom_xy=(0.0, 0.0), p_world_xz=(0.0, 0.0)))
    tag_tracker._observations.append(
        _scale_pair_observation(mono_ts=1.0, p_odom_xy=(0.3, 0.0), p_world_xz=(0.35, 0.0))
    )
    refiner._maybe_update_odom_scale(resolved_odom=None)
    assert state.odom_scale == pytest.approx(ODOM_SCALE_INITIAL)

    tag_tracker._observations.clear()
    tag_tracker._observations.append(_scale_pair_observation(mono_ts=0.0, p_odom_xy=(0.0, 0.0), p_world_xz=(0.0, 0.0)))
    tag_tracker._observations.append(
        _scale_pair_observation(mono_ts=1.0, p_odom_xy=(1.0, 0.0), p_world_xz=(-1.0, 0.0))
    )
    refiner._maybe_update_odom_scale(resolved_odom=None)
    assert state.odom_scale == pytest.approx(ODOM_SCALE_INITIAL)


def test_odom_scale_estimator_apply_deadband() -> None:
    refiner, tag_tracker, state, _odom, _sent, _registry = _make_world_frame_refiner()
    state.commit(np.eye(4, dtype=np.float64), method="april_tag", approximate=False)
    state.set_odom_scale(1.16)

    tag_tracker._observations.append(_scale_pair_observation(mono_ts=0.0, p_odom_xy=(0.0, 0.0), p_world_xz=(0.0, 0.0)))
    tag_tracker._observations.append(
        _scale_pair_observation(mono_ts=1.0, p_odom_xy=(1.5, 0.0), p_world_xz=(1.5 * 1.168, 0.0))
    )
    refiner._maybe_update_odom_scale(resolved_odom=None)
    assert state.odom_scale == pytest.approx(1.16)

    tag_tracker._observations.clear()
    tag_tracker._observations.append(_scale_pair_observation(mono_ts=0.0, p_odom_xy=(0.0, 0.0), p_world_xz=(0.0, 0.0)))
    tag_tracker._observations.append(
        _scale_pair_observation(mono_ts=1.0, p_odom_xy=(1.5, 0.0), p_world_xz=(1.5 * 1.25, 0.0))
    )
    refiner._maybe_update_odom_scale(resolved_odom=None)
    assert state.odom_scale > 1.16 + 0.01


def test_odom_scale_resets_on_clear_and_reconverges() -> None:
    refiner, tag_tracker, state, _odom, _sent, registry = _make_world_frame_refiner()
    state.commit(np.eye(4, dtype=np.float64), method="april_tag", approximate=False)
    state.set_odom_scale(1.15)
    registry.clear()
    assert state.odom_scale == pytest.approx(1.0)

    state.commit(np.eye(4, dtype=np.float64), method="april_tag", approximate=False)
    assert state.odom_scale == pytest.approx(ODOM_SCALE_INITIAL)
    tag_tracker._observations.append(_scale_pair_observation(mono_ts=0.0, p_odom_xy=(0.0, 0.0), p_world_xz=(0.0, 0.0)))
    tag_tracker._observations.append(
        _scale_pair_observation(mono_ts=1.0, p_odom_xy=(1.5, 0.0), p_world_xz=(1.74, 0.0))
    )
    for _ in range(8):
        refiner._maybe_update_odom_scale(resolved_odom=None)
    assert state.odom_scale > 1.10


def test_odom_scale_change_does_not_jump_registration_pose() -> None:
    refiner, tag_tracker, state, _odom, _sent, _registry = _make_world_frame_refiner()
    odom_reg = (5.0, 0.0, 0.0)
    world_reg = (1.0, 0.0, -2.0)
    ori = (0.0, 0.0, 0.0, 1.0)
    T_world_odom = pose_to_matrix(world_reg, ori) @ np.linalg.inv(
        pose_to_matrix(odom_reg, ori)
    )
    state.commit(T_world_odom, method="april_tag", approximate=False)
    state.set_odom_anchor_xy(odom_reg[0], odom_reg[1])
    refiner.set_refinement_baseline(T_world_odom)

    world_before, _ = state.transform_pose(odom_reg, ori)

    tag_tracker._observations.append(
        _scale_pair_observation(mono_ts=0.0, p_odom_xy=(5.0, 0.0), p_world_xz=(1.0, -2.0))
    )
    tag_tracker._observations.append(
        _scale_pair_observation(mono_ts=1.0, p_odom_xy=(6.5, 0.0), p_world_xz=(2.74, -2.0))
    )
    refiner._maybe_update_odom_scale(resolved_odom=None)

    world_after, _ = state.transform_pose(odom_reg, ori)
    assert np.linalg.norm(np.asarray(world_after) - np.asarray(world_before)) < 0.01
