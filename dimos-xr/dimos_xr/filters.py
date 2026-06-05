"""Lidar filtering and subsampling before WebSocket broadcast."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import cast

import numpy as np
from numpy.typing import NDArray


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
        """Apply height/range band filter (no subsampling)."""
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

        return pts


# Annulus quotas for subsample_points_near_robot (must sum to target_points).
_ANNULUS_RINGS: tuple[tuple[float, float, int], ...] = (
    (0.0, 1.0, 500),
    (1.0, 2.5, 350),
    (2.5, 4.0, 150),
)


def subsample_points_near_robot(
    points_world: NDArray[np.floating],
    robot_world_position: tuple[float, float, float] | None,
    *,
    target_points: int = 1000,
) -> NDArray[np.float32]:
    """Cap world-frame LiDAR with more points near the robot."""
    if points_world.size == 0:
        return np.zeros((0, 3), dtype=np.float32)

    pts = np.asarray(points_world, dtype=np.float32)
    if pts.ndim != 2 or pts.shape[1] != 3:
        raise ValueError(f"Expected Nx3 points, got shape {pts.shape}")

    if robot_world_position is None:
        if len(pts) <= target_points:
            return pts
        stride = max(1, len(pts) // target_points)
        return pts[::stride][:target_points]

    robot = np.asarray(robot_world_position, dtype=np.float32)
    dx = pts[:, 0] - robot[0]
    dz = pts[:, 2] - robot[2]
    horiz_dist = np.sqrt(dx * dx + dz * dz)

    scale = target_points / sum(budget for _, _, budget in _ANNULUS_RINGS)
    ring_budgets = [
        max(0, int(round(budget * scale))) for _, _, budget in _ANNULUS_RINGS
    ]
    remainder = target_points - sum(ring_budgets)
    ring_budgets[0] += remainder

    rng = np.random.default_rng()
    selected_indices: list[int] = []
    for (min_m, max_m, _), budget in zip(_ANNULUS_RINGS, ring_budgets, strict=True):
        if budget <= 0:
            continue
        if max_m == float("inf"):
            mask = horiz_dist >= min_m
        else:
            mask = (horiz_dist >= min_m) & (horiz_dist < max_m)
        ring_indices = np.flatnonzero(mask)
        if len(ring_indices) == 0:
            continue
        if len(ring_indices) <= budget:
            selected_indices.extend(ring_indices.tolist())
        else:
            chosen = rng.choice(ring_indices, size=budget, replace=False)
            selected_indices.extend(chosen.tolist())

    if not selected_indices:
        stride = max(1, len(pts) // target_points)
        return pts[::stride][:target_points]

    if len(selected_indices) < target_points:
        remaining = np.setdiff1d(
            np.arange(len(pts), dtype=np.int64),
            np.asarray(selected_indices, dtype=np.int64),
        )
        need = target_points - len(selected_indices)
        if len(remaining) > 0:
            extra = rng.choice(remaining, size=min(need, len(remaining)), replace=False)
            selected_indices.extend(int(i) for i in extra)

    if len(selected_indices) > target_points:
        chosen = cast(
            NDArray[np.int64],
            rng.choice(
            np.asarray(selected_indices, dtype=np.int64),
            size=target_points,
            replace=False,
            ),
        )
        return pts[chosen].astype(np.float32)

    return pts[np.asarray(selected_indices, dtype=np.int64)].astype(np.float32)

