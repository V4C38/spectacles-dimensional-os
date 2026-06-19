"""Regression tests for RegisteredPoseRefiner runtime correction semantics."""

from __future__ import annotations

import json
import math
from unittest.mock import MagicMock

import pytest

from dimos.ar.adapters.base import RuntimeAlignmentProfile
from dimos.ar.bridge.odom_buffer import OdomBuffer
from dimos.ar.bridge.pose_refinement import RegisteredPoseRefiner
from dimos.ar.bridge.sender import BridgeSender
from dimos.ar.tracking.robot_tag_tracker import (
    RobotAprilTagTracker,
    RobotAprilTagTrackerConfig,
    TagSolve,
    _yaw_from_T,
    build_T_world_odom,
)
from dimos.ar.tracking.transforms import Calibration, OdomSample


def _make_pose_refiner() -> tuple[
    RegisteredPoseRefiner,
    RobotAprilTagTracker,
    Calibration,
    OdomBuffer,
    list[str],
]:
    sent: list[str] = []
    mock_server = MagicMock()
    mock_server.schedule_send.side_effect = lambda msg: sent.append(msg)

    sender = BridgeSender()
    sender.bind(mock_server)

    calibration = Calibration()
    odom = OdomBuffer()
    tag_tracker = RobotAprilTagTracker([], config=RobotAprilTagTrackerConfig())

    refiner = RegisteredPoseRefiner(
        robot_id="test_robot",
        sender=sender,
        calibration=calibration,
        odom=odom,
        tag_tracker=tag_tracker,
        runtime_profile=RuntimeAlignmentProfile(),
        runtime_correction_enabled=True,
    )
    odom.speed_windowed = MagicMock(return_value=0.0)  # type: ignore[method-assign]
    return refiner, tag_tracker, calibration, odom, sent


def test_runtime_smoothing_preserves_heading() -> None:
    """Regression guard: one smoothing step on an identical solve must not flip the yaw."""
    refiner, tag_tracker, calibration, _odom, _sent = _make_pose_refiner()

    theta = math.radians(30.0)
    T_committed = build_T_world_odom(theta, (1.0, 0.0, -2.0))

    refiner.set_T_committed(T_committed)
    calibration.register_from_alignment(T_committed)

    solve = TagSolve(
        T_world_odom=T_committed.copy(),
        method="tag",
        quality=1.0,
        observation_count=8,
        baseline_m=0.40,
    )
    tag_tracker.current_solve = MagicMock(return_value=solve)  # type: ignore[method-assign]
    tag_tracker.current_translation_solve = MagicMock(return_value=solve)  # type: ignore[method-assign]

    refiner.apply_tracker_update()

    committed_yaw = _yaw_from_T(refiner.T_committed)
    assert committed_yaw == pytest.approx(theta, abs=1e-6), (
        f"Heading flipped: expected {math.degrees(theta):.1f}°, "
        f"got {math.degrees(committed_yaw):.1f}°"
    )


def test_runtime_translation_solve_corrects_stationary_robot() -> None:
    """When baseline solve is unavailable, runtime translation solve must still update."""
    refiner, tag_tracker, calibration, _odom, sent = _make_pose_refiner()

    theta = math.radians(20.0)
    T_committed = build_T_world_odom(theta, (0.0, 0.0, 0.0))
    refiner.set_T_committed(T_committed)
    calibration.register_from_alignment(T_committed)

    T_target = build_T_world_odom(theta, (1.0, 0.0, -1.0))
    solve = TagSolve(
        T_world_odom=T_target.copy(),
        method="tag_translation",
        quality=0.95,
        observation_count=1,
        baseline_m=0.0,
    )
    tag_tracker.current_solve = MagicMock(return_value=None)  # type: ignore[method-assign]
    tag_tracker.current_translation_solve = MagicMock(return_value=solve)  # type: ignore[method-assign]

    refiner.apply_tracker_update()

    committed_yaw = _yaw_from_T(refiner.T_committed)
    assert committed_yaw == pytest.approx(theta, abs=1e-6)
    assert refiner.T_committed[0, 3] == pytest.approx(1.0, abs=1e-3)
    assert refiner.T_committed[2, 3] == pytest.approx(-1.0, abs=1e-3)
    pose_corrections = [
        json.loads(payload)
        for payload in sent
        if json.loads(payload).get("type") == "pose_correction"
    ]
    assert len(pose_corrections) == 1
    assert pose_corrections[0]["solve_method"] == "tag_translation"


def test_runtime_correction_emits_fresh_pose_for_stationary_robot() -> None:
    """A runtime correction must push an updated pose even without new odom traffic."""
    refiner, tag_tracker, calibration, odom, sent = _make_pose_refiner()

    theta = math.radians(20.0)
    T_committed = build_T_world_odom(theta, (0.0, 0.0, 0.0))
    refiner.set_T_committed(T_committed)
    calibration.register_from_alignment(T_committed)
    odom._latest = OdomSample(  # type: ignore[attr-defined]
        position=(0.0, 0.0, 0.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
    )

    T_target = build_T_world_odom(theta, (1.0, 0.0, -1.0))
    solve = TagSolve(
        T_world_odom=T_target.copy(),
        method="tag_translation",
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


def test_runtime_correction_below_deadband_emits_no_pose_correction() -> None:
    """A correction below the notification deadband must update T_world_odom
    without emitting a pose_correction message."""
    refiner, tag_tracker, calibration, _odom, sent = _make_pose_refiner()

    theta = math.radians(20.0)
    T_committed = build_T_world_odom(theta, (0.0, 0.0, 0.0))
    refiner.set_T_committed(T_committed)
    calibration.register_from_alignment(T_committed)

    # 2 cm translation, 0.5° yaw — both below the MIN_REPORTED thresholds.
    T_target = build_T_world_odom(theta + math.radians(0.5), (0.02, 0.0, 0.0))
    solve = TagSolve(
        T_world_odom=T_target.copy(),
        method="tag_translation",
        quality=0.95,
        observation_count=1,
        baseline_m=0.0,
    )
    tag_tracker.current_solve = MagicMock(return_value=None)  # type: ignore[method-assign]
    tag_tracker.current_translation_solve = MagicMock(return_value=solve)  # type: ignore[method-assign]

    refiner.apply_tracker_update()

    pose_corrections = [
        json.loads(payload)
        for payload in sent
        if json.loads(payload).get("type") == "pose_correction"
    ]
    assert len(pose_corrections) == 0, (
        "pose_correction should not fire for sub-threshold corrections"
    )
    assert refiner.T_committed is not None


def test_runtime_correction_above_deadband_emits_pose_correction() -> None:
    """A correction that exceeds the notification deadband must emit pose_correction."""
    refiner, tag_tracker, calibration, _odom, sent = _make_pose_refiner()

    theta = math.radians(20.0)
    T_committed = build_T_world_odom(theta, (0.0, 0.0, 0.0))
    refiner.set_T_committed(T_committed)
    calibration.register_from_alignment(T_committed)

    # 25 cm translation — above the pose_correction notification threshold.
    T_target = build_T_world_odom(theta, (0.25, 0.0, 0.0))
    solve = TagSolve(
        T_world_odom=T_target.copy(),
        method="tag_translation",
        quality=0.95,
        observation_count=1,
        baseline_m=0.0,
    )
    tag_tracker.current_solve = MagicMock(return_value=None)  # type: ignore[method-assign]
    tag_tracker.current_translation_solve = MagicMock(return_value=solve)  # type: ignore[method-assign]

    refiner.apply_tracker_update()

    pose_corrections = [
        json.loads(payload)
        for payload in sent
        if json.loads(payload).get("type") == "pose_correction"
    ]
    assert len(pose_corrections) == 1
    assert pose_corrections[0]["solve_method"] == "tag_translation"


def test_runtime_yaw_gate_holds_on_curve() -> None:
    refiner, tag_tracker, calibration, odom, _sent = _make_pose_refiner()
    odom.speed_windowed = MagicMock(return_value=0.5)  # type: ignore[method-assign]

    theta = math.radians(15.0)
    T_committed = build_T_world_odom(theta, (0.0, 0.0, 0.0))
    refiner.set_T_committed(T_committed)
    calibration.register_from_alignment(T_committed)

    T_target = build_T_world_odom(theta + math.radians(5.0), (0.2, 0.0, -0.2))
    solve = TagSolve(
        T_world_odom=T_target.copy(),
        method="tag",
        quality=0.9,
        observation_count=6,
        baseline_m=0.5,
        straightness=0.8,
    )
    tag_tracker.current_solve = MagicMock(return_value=solve)  # type: ignore[method-assign]

    refiner.apply_tracker_update()

    assert _yaw_from_T(refiner.T_committed) == pytest.approx(theta, abs=1e-6)


def test_runtime_yaw_gate_allows_straight_run() -> None:
    refiner, tag_tracker, calibration, odom, _sent = _make_pose_refiner()
    odom.speed_windowed = MagicMock(return_value=0.5)  # type: ignore[method-assign]

    theta = math.radians(15.0)
    T_committed = build_T_world_odom(theta, (0.0, 0.0, 0.0))
    refiner.set_T_committed(T_committed)
    calibration.register_from_alignment(T_committed)

    T_target = build_T_world_odom(theta + math.radians(5.0), (0.2, 0.0, -0.2))
    solve = TagSolve(
        T_world_odom=T_target.copy(),
        method="tag",
        quality=0.9,
        observation_count=6,
        baseline_m=0.5,
        straightness=0.1,
    )
    tag_tracker.current_solve = MagicMock(return_value=solve)  # type: ignore[method-assign]

    refiner.apply_tracker_update()

    assert _yaw_from_T(refiner.T_committed) != pytest.approx(theta, abs=1e-6)
