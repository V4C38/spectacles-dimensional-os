from __future__ import annotations

import numpy as np
import pytest

from dimos_ar.filters import LidarFilter, LidarFilterConfig, RateLimiter


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
            [0.5, 0.0, 0.5],   # in range and height
            [5.0, 0.0, 0.5],   # out of range
            [0.5, 0.0, 0.05],  # below height band
            [0.5, 0.0, 2.0],   # above height band
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


def test_subsample_stride_when_over_target(monkeypatch: pytest.MonkeyPatch) -> None:
    import dimos_ar.filters as filters_mod

    monkeypatch.setattr(filters_mod, "_HAS_OPEN3D", False)
    config = LidarFilterConfig(
        max_range_m=100.0,
        min_height_m=-1.0,
        max_height_m=10.0,
        target_points=10,
    )
    filt = LidarFilter(config)
    points = np.array([[float(i), 0.0, 0.5] for i in range(100)], dtype=np.float32)
    filtered = filt.filter(points)
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
