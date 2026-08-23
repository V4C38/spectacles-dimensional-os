from __future__ import annotations

import numpy as np
import pytest

from dimos.ar.robot.lidar_filter import (
    LidarFilterSettings,
    filter_points,
    prepare_lidar_points,
    subsample_near_robot,
)
from dimos.ar.websocket.protocol import LidarSettings


def _settings(**overrides: float) -> LidarFilterSettings:
    defaults = {
        "min_height_m": 0.1,
        "max_height_m": 1.5,
        "max_range_m": 5.0,
        "target_points": 100.0,
    }
    defaults.update(overrides)
    return LidarFilterSettings(
        min_height_m=defaults["min_height_m"],
        max_height_m=defaults["max_height_m"],
        max_range_m=defaults["max_range_m"],
        target_points=int(defaults["target_points"]),
    )


def test_filter_points_empty() -> None:
    assert len(filter_points(np.zeros((0, 3), dtype=np.float32), settings=_settings())) == 0


def test_filter_points_height_and_range() -> None:
    points = np.array(
        [
            [0.5, 0.0, 0.5],
            [6.0, 0.0, 0.5],
            [0.5, 0.0, 0.05],
            [0.5, 0.0, 2.0],
        ],
        dtype=np.float32,
    )
    filtered = filter_points(points, settings=_settings(max_range_m=5.0))
    assert len(filtered) == 1
    assert np.allclose(filtered[0], [0.5, 0.0, 0.5])


def test_filter_points_does_not_subsample() -> None:
    points = np.array([[float(i), 0.0, 0.5] for i in range(100)], dtype=np.float32)
    filtered = filter_points(
        points,
        settings=_settings(max_range_m=200.0, min_height_m=-1.0, max_height_m=10.0),
    )
    assert len(filtered) == 100


def test_subsample_without_robot_uses_stride() -> None:
    points = np.array([[float(i), 0.0, 0.5] for i in range(5000)], dtype=np.float32)
    result = subsample_near_robot(points, None, target_points=1000)
    assert len(result) == 1000


def test_subsample_prefers_near_robot_in_xy_plane() -> None:
    rng = np.random.default_rng(42)
    near_theta = rng.uniform(0.0, 2.0 * np.pi, size=2000)
    near_r = rng.uniform(0.1, 0.9, size=2000)
    near = np.column_stack(
        [
            near_r * np.cos(near_theta),
            near_r * np.sin(near_theta),
            np.full(2000, 0.5, dtype=np.float32),
        ]
    ).astype(np.float32)
    far_theta = rng.uniform(0.0, 2.0 * np.pi, size=2000)
    far_r = rng.uniform(2.6, 3.8, size=2000)
    far = np.column_stack(
        [
            far_r * np.cos(far_theta),
            far_r * np.sin(far_theta),
            np.full(2000, 0.5, dtype=np.float32),
        ]
    ).astype(np.float32)
    points = np.vstack([near, far])
    result = subsample_near_robot(points, (0.0, 0.0, 0.33), target_points=1000, rng=rng)

    assert len(result) == 1000
    horiz = np.sqrt(result[:, 0] ** 2 + result[:, 1] ** 2)
    assert int(np.sum(horiz < 1.0)) >= 400


def test_band_filter_independent_of_odom_scale() -> None:
    """Height/range band does not use robot position — scale factor is irrelevant."""
    points = np.array(
        [[9.0, 0.0, 0.5], [10.0, 0.0, 0.5], [11.0, 0.0, 0.5]],
        dtype=np.float32,
    )
    settings = _settings(max_range_m=10.5)
    assert np.array_equal(
        filter_points(points, settings=settings),
        np.array([[9.0, 0.0, 0.5], [10.0, 0.0, 0.5]], dtype=np.float32),
    )


def test_subsample_uses_raw_robot_position_not_corrected() -> None:
    points = np.array([[8.2, 0.0, 0.5], [10.2, 0.0, 0.5]], dtype=np.float32)
    settings = _settings(target_points=1, max_range_m=15.0)

    raw = prepare_lidar_points(points, settings=settings, robot_position=(8.0, 0.0, 0.33))
    wrong = prepare_lidar_points(points, settings=settings, robot_position=(10.0, 0.0, 0.33))

    assert np.allclose(raw[0], [8.2, 0.0, 0.5])
    assert np.allclose(wrong[0], [10.2, 0.0, 0.5])


def test_from_settings_reads_lidar_settings() -> None:
    settings_input = LidarSettings(enabled=True, min_height_m=0.2, max_height_m=1.2, max_range_m=4.0)
    settings = LidarFilterSettings.from_settings(settings_input, target_points=500)
    assert settings.min_height_m == 0.2
    assert settings.max_range_m == 4.0
    assert settings.target_points == 500


def test_invalid_shape_raises() -> None:
    with pytest.raises(ValueError, match="Nx3"):
        filter_points(np.array([1.0, 2.0, 3.0], dtype=np.float32), settings=_settings())
