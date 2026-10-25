from __future__ import annotations

import numpy as np
import pytest

from tools.check_go2_registration import compare_clouds


def test_repeated_world_geometry_rejects_time_varying_packet_translation() -> None:
    axes = np.arange(0, 2, 0.1)
    cloud = np.asarray(np.meshgrid(axes, axes, axes)).reshape(3, -1).T
    metrics = compare_clouds(cloud, cloud.copy(), np.array([0.918, 0.0]), factor=1.25)
    assert metrics["unchanged_overlap_2cm"] == 1
    assert metrics["candidate_overlap_2cm"] == 0
    assert metrics["candidate_median_m"] > 0.02
    assert metrics["fixed_scale_overlap_2cm"] == 1
    assert metrics["fixed_scale_median_m"] == 0


def test_check_does_not_invent_errors_for_identity_factor() -> None:
    cloud = np.array([[0.0, 0, 0], [1.0, 0, 0]])
    metrics = compare_clouds(cloud, cloud.copy(), np.array([1.0, 0]), factor=1)
    assert metrics["candidate_overlap_2cm"] == 1


def test_invalid_cloud_is_rejected() -> None:
    with pytest.raises(ValueError):
        compare_clouds(np.array([[float("nan"), 0, 0]]), np.zeros((1, 3)), np.zeros(2), factor=1.25)
