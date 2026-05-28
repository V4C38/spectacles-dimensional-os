from __future__ import annotations

import numpy as np
import pytest

from dimos_ar.filters import LidarFilter, LidarFilterConfig, RateLimiter


def test_empty_points() -> None:
    filt = LidarFilter()
    pts, colors = filt.filter(np.zeros((0, 3), dtype=np.float32))
    assert len(pts) == 0
    assert colors is None


def test_range_and_height_filter() -> None:
    config = LidarFilterConfig(
        max_range_m=2.0,
        min_height_m=0.1,
        max_height_m=1.0,
        target_points=100,
        color_by_distance=False,
    )
    filt = LidarFilter(config)
    points = np.array(
        [
            [0.5, 0.0, 0.5],   # in range and height
            [5.0, 0.0, 0.5],   # out of range
            [0.5, 0.0, 0.05],  # below height band
            [0.5, 0.0, 2.0],   # above height band
        ],
        dtype=np.float32,
    )
    filtered, colors = filt.filter(points)
    assert len(filtered) == 1
    assert np.allclose(filtered[0], [0.5, 0.0, 0.5])
    assert colors is None


def test_optional_filters_allow_full_pointcloud() -> None:
    config = LidarFilterConfig(
        max_range_m=None,
        min_height_m=None,
        max_height_m=None,
        target_points=100,
        color_by_distance=False,
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
    filtered, colors = filt.filter(points)
    assert len(filtered) == len(points)
    assert colors is None


def test_height_class_colors_mark_ground_and_obstacles() -> None:
    config = LidarFilterConfig(
        max_range_m=None,
        min_height_m=None,
        max_height_m=None,
        target_points=100,
        color_by_distance=False,
        color_by_height_class=True,
        obstacle_height_threshold_m=0.08,
    )
    filt = LidarFilter(config)
    points = np.array(
        [
            [0.5, 0.0, -0.1],
            [0.5, 0.0, 0.08],
            [0.5, 0.0, 0.3],
        ],
        dtype=np.float32,
    )

    _, colors = filt.filter(points)

    assert colors is not None
    assert np.allclose(colors[0], [0.22, 0.78, 0.34])
    assert np.allclose(colors[1], [0.22, 0.78, 0.34])
    assert np.allclose(colors[2], [1.0, 0.45, 0.12])


def test_subsample_stride_when_over_target(monkeypatch: pytest.MonkeyPatch) -> None:
    import dimos_ar.filters as filters_mod

    monkeypatch.setattr(filters_mod, "_HAS_OPEN3D", False)
    config = LidarFilterConfig(
        max_range_m=100.0,
        min_height_m=-1.0,
        max_height_m=10.0,
        target_points=10,
        color_by_distance=False,
    )
    filt = LidarFilter(config)
    points = np.array([[float(i), 0.0, 0.5] for i in range(100)], dtype=np.float32)
    filtered, _ = filt.filter(points)
    assert len(filtered) <= config.target_points


def test_invalid_shape_raises() -> None:
    filt = LidarFilter()
    with pytest.raises(ValueError):
        filt.filter(np.array([1.0, 2.0, 3.0], dtype=np.float32))


def test_rate_limiter() -> None:
    limiter = RateLimiter(max_hz=10.0)
    assert limiter.allow() is True
    assert limiter.allow() is False


def test_rate_limiter_zero_hz_always_allows() -> None:
    limiter = RateLimiter(max_hz=0.0)
    assert limiter.allow() is True
    assert limiter.allow() is True
