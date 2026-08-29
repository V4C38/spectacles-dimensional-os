from __future__ import annotations

import math

import numpy as np
import pytest

from dimos.ar.localization.transforms import (
    fuse_pose_estimates,
    matrix_from_position_and_yaw,
    normalize_pose_estimate,
    yaw_from_transform,
)
from dimos.msgs.geometry_msgs.Pose import Pose
from dimos.utils.transform_utils import pose_to_matrix


def test_normalize_pose_estimate_removes_small_tilt() -> None:
    half_roll = math.radians(2.0)
    tilted = pose_to_matrix(Pose(1.0, 2.0, 3.0, math.sin(half_roll), 0.0, 0.0, math.cos(half_roll)))
    normalized = normalize_pose_estimate(
        tilted,
        max_tilt_rad=math.radians(5.0),
    )

    assert normalized is not None
    up = normalized[:3, 2]
    assert up[0] == pytest.approx(0.0, abs=1e-6)
    assert up[1] == pytest.approx(0.0, abs=1e-6)
    assert up[2] == pytest.approx(1.0, abs=1e-6)
    assert normalized[:3, 3] == pytest.approx([1.0, 2.0, 3.0])


def test_normalize_pose_estimate_rejects_excessive_tilt() -> None:
    half_roll = math.radians(10.0)
    tilted = pose_to_matrix(Pose(0.0, 0.0, 0.0, math.sin(half_roll), 0.0, 0.0, math.cos(half_roll)))

    assert (
        normalize_pose_estimate(
            tilted,
            max_tilt_rad=math.radians(5.0),
        )
        is None
    )


def test_fuse_pose_estimates_rejects_position_outlier() -> None:
    close_a = matrix_from_position_and_yaw((1.0, 0.0, 0.0), 0.0)
    close_b = matrix_from_position_and_yaw((1.05, 0.02, 0.0), 0.05)
    outlier = matrix_from_position_and_yaw((4.0, 0.0, 0.0), 0.0)

    fused = fuse_pose_estimates(
        [close_a, close_b, outlier],
        max_tilt_rad=math.radians(5.0),
        max_position_residual_m=0.35,
        max_yaw_residual_rad=math.radians(12.0),
    )

    assert fused is not None
    assert fused.transform[0, 3] == pytest.approx(1.025, abs=0.05)
    assert fused.transform[1, 3] == pytest.approx(0.01, abs=0.05)
    assert fused.inlier_indices == (0, 1)
    assert fused.max_position_residual_m > 0.0
    assert fused.max_yaw_residual_rad > 0.0


def test_fuse_pose_estimates_returns_none_when_all_rejected() -> None:
    transforms = [
        matrix_from_position_and_yaw((0.0, 0.0, 0.0), 0.0),
        matrix_from_position_and_yaw((5.0, 0.0, 0.0), 0.0),
    ]

    assert (
        fuse_pose_estimates(
            transforms,
            max_tilt_rad=math.radians(5.0),
            max_position_residual_m=0.1,
            max_yaw_residual_rad=math.radians(5.0),
        )
        is None
    )


def test_fuse_pose_estimates_accepts_one_estimate() -> None:
    half_roll = math.radians(2.0)
    estimate = pose_to_matrix(
        Pose(1.0, 2.0, 3.0, math.sin(half_roll), 0.0, 0.0, math.cos(half_roll))
    )

    fused = fuse_pose_estimates(
        [estimate],
        max_tilt_rad=math.radians(5.0),
        max_position_residual_m=0.1,
        max_yaw_residual_rad=math.radians(5.0),
    )

    assert fused is not None
    assert np.allclose(fused.transform, matrix_from_position_and_yaw((1.0, 2.0, 3.0), 0.0))
    assert fused.inlier_indices == (0,)
    assert fused.max_position_residual_m == 0.0
    assert fused.max_yaw_residual_rad == 0.0


def test_yaw_from_transform_matches_pose_yaw() -> None:
    yaw = math.radians(40.0)
    transform = matrix_from_position_and_yaw((0.0, 0.0, 0.0), yaw)

    assert yaw_from_transform(transform) == pytest.approx(yaw, abs=1e-6)
