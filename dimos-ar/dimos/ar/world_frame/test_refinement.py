"""Regression tests for WorldFrameRefiner runtime correction semantics."""

from __future__ import annotations

import json
import math
from unittest.mock import MagicMock

import pytest

from dimos.ar.adapters.base import TagTrackingProfile
from dimos.ar.bridge.odom_buffer import OdomBuffer
from dimos.ar.bridge.sender import BridgeSender
from dimos.ar.bridge.telemetry import TelemetryPublisher
from dimos.ar.lidar.filters import LidarFilter, LidarFilterConfig
from dimos.ar.tag_tracking.solve import (
    TagSolve,
    _yaw_from_T,
    build_T_world_odom,
)
from dimos.ar.tag_tracking.tracker import RobotAprilTagTracker, RobotAprilTagTrackerConfig
from dimos.ar.world_frame.refinement import WorldFrameRefiner
from dimos.ar.world_frame.registry import WorldRegistry
from dimos.ar.world_frame.state import WorldFrameState
from dimos.ar.world_frame.transforms import OdomSample


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
    state.commit(T, method="april_odom_baseline", approximate=False)  # type: ignore[arg-type]


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

    refiner.apply_tracker_update(ts=123.456)

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
    tag_tracker.current_solve = MagicMock(return_value=solve)  # type: ignore[method-assign]

    refiner.apply_tracker_update()

    assert _yaw_from_T(refiner.refinement_baseline) == pytest.approx(theta, abs=1e-6)


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
