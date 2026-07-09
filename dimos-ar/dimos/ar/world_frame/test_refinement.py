"""Regression tests for the similarity-aligner world-frame refiner path."""

from __future__ import annotations

import logging
from unittest.mock import MagicMock

import numpy as np

from dimos.ar.robot_profile.base import TagTrackingProfile
from dimos.ar.tag_tracking.tracker import FrameResult
from dimos.ar.world_frame.refinement import WorldFrameRefiner
from dimos.ar.world_frame.registry import WorldRegistry
from dimos.ar.world_frame.state import WorldFrameState
from dimos.ar.world_frame.transforms import OdomSample


def _make_refiner() -> tuple[WorldFrameRefiner, WorldFrameState, MagicMock]:
    state = WorldFrameState()
    registry = WorldRegistry(state, tf_publish_static=lambda _tf: None)
    telemetry = MagicMock()
    odom = MagicMock()
    odom.latest_mono.return_value = 10.0
    odom.speed_windowed.return_value = 0.4
    tag_tracker = MagicMock()
    refiner = WorldFrameRefiner(
        registry=registry,
        telemetry=telemetry,
        odom=odom,
        tag_tracker=tag_tracker,
        runtime_profile=TagTrackingProfile(),
        runtime_correction_enabled=True,
        diag_latest_observations=1,
    )
    registry.attach_refiner(refiner)
    return refiner, state, tag_tracker


def test_apply_tracker_update_delegates_to_similarity_aligner() -> None:
    refiner, state, _tag_tracker = _make_refiner()
    aligner = MagicMock()
    refiner.attach_aligner(aligner)
    state.commit(np.eye(4, dtype=np.float64), method="april_tag", approximate=True)

    sample = OdomSample(
        position=(0.0, 0.0, 0.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
        source_ts=1.0,
    )
    refiner.apply_tracker_update(resolved_odom=sample)

    aligner.update.assert_called_once()
    assert aligner.update.call_args.kwargs["resolved_odom"] == sample


def test_moving_robot_diag_logs_latest_and_centroid_residuals(caplog) -> None:
    refiner, state, tag_tracker = _make_refiner()
    state.commit(np.eye(4, dtype=np.float64), method="april_tag", approximate=True)
    tag_tracker.robot_world_pose_estimate.side_effect = [
        ((1.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0), 0.9),
        ((2.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0), 0.9),
    ]
    result = FrameResult(
        tag_detected=True,
        tag_ids=[0],
        quality=0.9,
        observations_added=1,
        rejections_reprojection=2,
        rejections_skew=3,
        rejections_distance=4,
        rejections_up_tilt=5,
        rejections_mount_residual=6,
        rejections_innovation=7,
    )
    sample = OdomSample(
        position=(0.0, 0.0, 0.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
        source_ts=10.0,
        measured_speed_mps=0.4,
    )

    with caplog.at_level(logging.INFO):
        refiner.maybe_log_moving_robot_diag(
            header={"seq": 1},
            receive_mono=10.0,
            frame_age=0.05,
            result=result,
            resolved_odom=sample,
            capture_ts_robot=10.0,
        )

    assert "moving_robot_diag" in caplog.text
    assert "latest_residual_m" in caplog.text
    assert "window_centroid_residual_m" in caplog.text
    assert "rej_skew" in caplog.text
