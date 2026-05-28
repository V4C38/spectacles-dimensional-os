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
    color_by_distance: bool = True
    color_by_height_class: bool = False
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

    def filter(
        self, points: NDArray[np.floating]
    ) -> tuple[NDArray[np.float32], NDArray[np.float32] | None]:
        """Filter and subsample points. Returns (points, optional colors)."""
        if points.size == 0:
            return np.zeros((0, 3), dtype=np.float32), None

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
            return np.zeros((0, 3), dtype=np.float32), None

        pts = self._subsample(pts)
        colors = None
        if self.config.color_by_height_class:
            colors = self._obstacle_ground_colors(pts)
        elif self.config.color_by_distance:
            colors = self._distance_colors(pts)
        return pts, colors

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

    def _distance_colors(self, pts: NDArray[np.float32]) -> NDArray[np.float32]:
        dist = np.linalg.norm(pts[:, :2], axis=1)
        max_range = (
            self.config.max_range_m if self.config.max_range_m is not None else float(np.max(dist))
        )
        max_d = max(max_range, 1e-6)
        t = np.clip(dist / max_d, 0.0, 1.0)
        # near = cyan, far = blue
        r = t * 0.2
        g = 1.0 - 0.5 * t
        b = np.ones_like(t)
        return np.stack([r, g, b], axis=1).astype(np.float32)

    def _obstacle_ground_colors(self, pts: NDArray[np.float32]) -> NDArray[np.float32]:
        colors = np.zeros((len(pts), 3), dtype=np.float32)
        ground_mask = pts[:, 2] <= self.config.obstacle_height_threshold_m
        colors[ground_mask] = np.array([0.22, 0.78, 0.34], dtype=np.float32)
        colors[~ground_mask] = np.array([1.0, 0.45, 0.12], dtype=np.float32)
        return colors
