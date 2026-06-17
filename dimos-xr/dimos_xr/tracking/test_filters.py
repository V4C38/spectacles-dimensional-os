from __future__ import annotations

import numpy as np
import pytest

from dimos_xr.adapters.go2 import go2_handshake
from dimos_xr.tracking.filters import (
    LidarFilter,
    LidarFilterConfig,
    LidarObstacleDistanceConfig,
    filter_obstacle_points,
    lidar_height_band_m,
    subsample_points_near_robot,
)


def test_empty_points() -> None:
    filt = LidarFilter()
    pts = filt.filter(np.zeros((0, 3), dtype=np.float32))
    assert len(pts) == 0


def test_range_and_height_filter() -> None:
    config = LidarFilterConfig(
        max_range_m=2.0,
        min_height_m=0.1,
        max_height_m=1.0,
        target_points=100,
    )
    filt = LidarFilter(config)
    points = np.array(
        [
            [0.5, 0.0, 0.5],  # in range and height
            [5.0, 0.0, 0.5],  # out of range
            [0.5, 0.0, 0.05],  # below height band
            [0.5, 0.0, 2.0],  # above height band
        ],
        dtype=np.float32,
    )
    filtered = filt.filter(points)
    assert len(filtered) == 1
    assert np.allclose(filtered[0], [0.5, 0.0, 0.5])


def test_optional_filters_allow_full_pointcloud() -> None:
    config = LidarFilterConfig(
        max_range_m=None,
        min_height_m=None,
        max_height_m=None,
        target_points=100,
    )
    filt = LidarFilter(config)
    points = np.array(
        [
            [0.5, 0.0, 0.5],
            [5.0, 0.0, 0.5],
            [0.5, 0.0, -2.0],
            [0.5, 0.0, 2.0],
        ],
        dtype=np.float32,
    )
    filtered = filt.filter(points)
    assert len(filtered) == len(points)


def test_filter_does_not_subsample() -> None:
    config = LidarFilterConfig(
        max_range_m=100.0,
        min_height_m=-1.0,
        max_height_m=10.0,
        target_points=10,
    )
    filt = LidarFilter(config)
    points = np.array([[float(i), 0.0, 0.5] for i in range(100)], dtype=np.float32)
    filtered = filt.filter(points)
    assert len(filtered) == 100


def test_filter_obstacle_points_keeps_annulus_only() -> None:
    config = LidarObstacleDistanceConfig(
        min_distance_m=0.1,
        opaque_distance_m=0.4,
        max_distance_m=0.6,
    )
    points = np.array(
        [
            [0.05, 0.0, 0.5],  # too close
            [0.10, 0.0, 0.5],  # min boundary
            [0.40, 0.0, 0.5],  # opaque boundary
            [0.60, 0.0, 0.5],  # max boundary
            [0.61, 0.0, 0.5],  # too far
        ],
        dtype=np.float32,
    )
    filtered = filter_obstacle_points(points, config)
    assert len(filtered) == 3
    assert np.allclose(
        filtered,
        np.array(
            [
                [0.10, 0.0, 0.5],
                [0.40, 0.0, 0.5],
                [0.60, 0.0, 0.5],
            ],
            dtype=np.float32,
        ),
    )


def test_filter_obstacle_points_can_use_robot_center_and_world_up() -> None:
    config = LidarObstacleDistanceConfig(
        min_distance_m=0.1,
        opaque_distance_m=0.4,
        max_distance_m=0.6,
    )
    points = np.array(
        [
            [2.05, 0.70, -1.00],  # too close to robot center
            [2.20, 0.70, -1.00],  # keep
            [2.55, 0.70, -1.00],  # keep
            [2.61, 0.70, -1.00],  # too far
            [2.20, 0.55, -1.00],  # below height band
            [2.20, 1.25, -1.00],  # above height band
        ],
        dtype=np.float32,
    )
    filtered = filter_obstacle_points(
        points,
        config,
        robot_position=(2.0, 0.7, -1.0),
        vertical_axis=1,
        min_height_m=-0.1,
        max_height_m=0.5,
    )
    assert len(filtered) == 2
    assert np.allclose(
        filtered,
        np.array(
            [
                [2.20, 0.70, -1.00],
                [2.55, 0.70, -1.00],
            ],
            dtype=np.float32,
        ),
    )


def test_subsample_without_robot_stride() -> None:
    points = np.array([[float(i), 0.0, 0.5] for i in range(5000)], dtype=np.float32)
    result = subsample_points_near_robot(points, None, target_points=1000)
    assert len(result) == 1000


def test_subsample_annulus_prefers_near_robot() -> None:
    rng = np.random.default_rng(42)
    near_theta = rng.uniform(0.0, 2.0 * np.pi, size=2000)
    near_r = rng.uniform(0.1, 0.9, size=2000)
    near = np.column_stack(
        [
            near_r * np.cos(near_theta),
            np.full(2000, 0.5, dtype=np.float32),
            near_r * np.sin(near_theta),
        ]
    ).astype(np.float32)
    far_theta = rng.uniform(0.0, 2.0 * np.pi, size=2000)
    far_r = rng.uniform(2.6, 3.8, size=2000)
    far = np.column_stack(
        [
            far_r * np.cos(far_theta),
            np.full(2000, 0.5, dtype=np.float32),
            far_r * np.sin(far_theta),
        ]
    ).astype(np.float32)
    points = np.vstack([near, far])
    robot = (0.0, 0.0, 0.0)
    result = subsample_points_near_robot(points, robot, target_points=1000)

    assert len(result) == 1000
    robot_arr = np.asarray(robot, dtype=np.float32)
    horiz = np.sqrt((result[:, 0] - robot_arr[0]) ** 2 + (result[:, 2] - robot_arr[2]) ** 2)
    near_count = int(np.sum(horiz < 1.0))
    assert near_count >= 400


def test_subsample_empty() -> None:
    result = subsample_points_near_robot(
        np.zeros((0, 3), dtype=np.float32),
        (0.0, 0.0, 0.0),
        target_points=1000,
    )
    assert len(result) == 0


def test_invalid_shape_raises() -> None:
    filt = LidarFilter()
    with pytest.raises(ValueError):
        filt.filter(np.array([1.0, 2.0, 3.0], dtype=np.float32))


def test_lidar_filter_rate_limits() -> None:
    config = LidarFilterConfig(max_hz=10.0)
    assert config.allow() is True
    assert config.allow() is False


def test_lidar_filter_zero_hz_always_allows() -> None:
    config = LidarFilterConfig(max_hz=0.0)
    assert config.allow() is True
    assert config.allow() is True


def test_lidar_height_band_go2() -> None:
    handshake = go2_handshake("unitree_go2")
    min_h, max_h = lidar_height_band_m(
        body_bounds_m=handshake.body_bounds_m,
        base_height_m=handshake.base_height_m,
    )
    assert min_h == pytest.approx(-0.325)
    assert max_h == pytest.approx(1.22)


def test_lidar_height_band_g1() -> None:
    min_h, max_h = lidar_height_band_m(
        body_bounds_m=(0.65, 0.45, 1.35),
        base_height_m=0.95,
    )
    assert min_h == pytest.approx(-0.945)
    assert max_h == pytest.approx(1.4)


def test_robot_aware_height_filter_go2() -> None:
    handshake = go2_handshake("unitree_go2")
    min_h, max_h = lidar_height_band_m(
        body_bounds_m=handshake.body_bounds_m,
        base_height_m=handshake.base_height_m,
    )
    filt = LidarFilter(
        LidarFilterConfig(
            max_range_m=None,
            min_height_m=min_h,
            max_height_m=max_h,
            target_points=100,
        )
    )
    points = np.array(
        [
            [0.5, 0.0, -0.32],  # just above floor clearance
            [0.5, 0.0, -0.34],  # below floor clearance
            [0.5, 0.0, 0.5],  # mid band
            [0.5, 0.0, 1.3],  # above max
        ],
        dtype=np.float32,
    )
    filtered = filt.filter(points)
    assert len(filtered) == 2
    assert np.allclose(filtered[0], [0.5, 0.0, -0.32])
    assert np.allclose(filtered[1], [0.5, 0.0, 0.5])
