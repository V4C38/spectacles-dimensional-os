"""Lidar filtering and subsampling before WebSocket broadcast."""

from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

try:
    import open3d as o3d

    _HAS_OPEN3D = True
except ImportError:
    _HAS_OPEN3D = False


@dataclass
class LidarFilterConfig:
    max_range_m: float | None = 3.0
    min_height_m: float | None = 0.1
    max_height_m: float | None = 1.5
    target_points: int = 2500
    max_hz: float = 10.0
    obstacle_height_threshold_m: float = 0.08


class RateLimiter:
    """Drop messages that arrive faster than max_hz."""

    def __init__(self, max_hz: float) -> None:
        self._min_interval = 1.0 / max_hz if max_hz > 0 else 0.0
        self._last_emit = 0.0

    def allow(self) -> bool:
        if self._min_interval <= 0:
            return True
        now = time.monotonic()
        if now - self._last_emit >= self._min_interval:
            self._last_emit = now
            return True
        return False


class LidarFilter:
    def __init__(self, config: LidarFilterConfig | None = None) -> None:
        self.config = config or LidarFilterConfig()
        self.rate_limiter = RateLimiter(self.config.max_hz)

    def filter(self, points: NDArray[np.floating]) -> NDArray[np.float32]:
        """Filter and subsample points."""
        if points.size == 0:
            return np.zeros((0, 3), dtype=np.float32)

        pts = np.asarray(points, dtype=np.float32)
        if pts.ndim != 2 or pts.shape[1] != 3:
            raise ValueError(f"Expected Nx3 points, got shape {pts.shape}")

        mask = np.ones(len(pts), dtype=bool)
        if self.config.max_range_m is not None:
            horizontal = np.linalg.norm(pts[:, :2], axis=1)
            mask &= horizontal <= self.config.max_range_m
        if self.config.min_height_m is not None:
            mask &= pts[:, 2] >= self.config.min_height_m
        if self.config.max_height_m is not None:
            mask &= pts[:, 2] <= self.config.max_height_m
        pts = pts[mask]
        if len(pts) == 0:
            return np.zeros((0, 3), dtype=np.float32)

        return self._subsample(pts)

    def _subsample(self, pts: NDArray[np.float32]) -> NDArray[np.float32]:
        target = self.config.target_points
        if len(pts) <= target:
            return pts

        if _HAS_OPEN3D:
            pcd = o3d.geometry.PointCloud()
            pcd.points = o3d.utility.Vector3dVector(pts.astype(np.float64))
            voxel_size = max(0.02, float(np.cbrt(np.prod(pts.max(axis=0) - pts.min(axis=0))) / 50))
            down = pcd.voxel_down_sample(voxel_size)
            result = np.asarray(down.points, dtype=np.float32)
            if len(result) > target:
                stride = max(1, len(result) // target)
                result = result[::stride]
            return result

        stride = max(1, len(pts) // target)
        return pts[::stride]


def filter_runtime_obstacles_world(
    points_world: NDArray[np.floating],
    robot_world_position: tuple[float, float, float] | None,
    *,
    min_height_m: float = 0.10,
    min_distance_m: float = 0.20,
    max_distance_m: float = 1.50,
    max_points: int = 200,
) -> NDArray[np.float32]:
    """Filter world-space LiDAR points down to nearby obstacle highlights."""
    if points_world.size == 0 or robot_world_position is None:
        return np.zeros((0, 3), dtype=np.float32)

    pts = np.asarray(points_world, dtype=np.float32)
    if pts.ndim != 2 or pts.shape[1] != 3:
        raise ValueError(f"Expected Nx3 points, got shape {pts.shape}")

    robot = np.asarray(robot_world_position, dtype=np.float32)
    dx = pts[:, 0] - robot[0]
    dz = pts[:, 2] - robot[2]
    horiz_dist = np.sqrt(dx * dx + dz * dz)

    mask = pts[:, 1] >= min_height_m
    mask &= horiz_dist >= min_distance_m
    mask &= horiz_dist <= max_distance_m
    filtered = pts[mask]
    if len(filtered) == 0:
        return np.zeros((0, 3), dtype=np.float32)

    if len(filtered) <= max_points:
        return filtered

    stride = max(1, len(filtered) // max_points)
    return filtered[::stride][:max_points]

