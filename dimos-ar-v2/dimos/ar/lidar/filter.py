from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from dimos.ar.lidar.settings import LidarSettings

DEFAULT_TARGET_POINTS = 2500

# Near-robot annulus budgets (min_m, max_m, point budget). AR-specific: keep
# dense floor geometry close to the robot; DimOS has no equivalent helper.
_ANNULUS_RINGS: tuple[tuple[float, float, int], ...] = (
    (0.0, 1.0, 500),
    (1.0, 2.5, 350),
    (2.5, 4.0, 150),
)


@dataclass(frozen=True)
class LidarFilterSettings:
    min_height_m: float
    max_height_m: float
    max_range_m: float
    target_points: int = DEFAULT_TARGET_POINTS

    @classmethod
    def from_lidar_settings(
        cls, lidar: LidarSettings, *, target_points: int = DEFAULT_TARGET_POINTS
    ) -> LidarFilterSettings:
        return cls(
            min_height_m=lidar.min_height_m,
            max_height_m=lidar.max_height_m,
            max_range_m=lidar.max_range_m,
            target_points=target_points,
        )


def filter_points(
    points: NDArray[np.floating],
    *,
    settings: LidarFilterSettings,
    robot_position: tuple[float, float, float] | None = None,
) -> NDArray[np.float32]:
    """Height band, plus horizontal range around the robot when its pose is known."""
    if points.size == 0:
        return np.zeros((0, 3), dtype=np.float32)
    pts = np.asarray(points, dtype=np.float32)
    if pts.ndim != 2 or pts.shape[1] != 3:
        raise ValueError(f"Expected Nx3 points, got shape {pts.shape}")

    mask = (pts[:, 2] >= settings.min_height_m) & (pts[:, 2] <= settings.max_height_m)
    if robot_position is not None:
        robot = np.asarray(robot_position, dtype=np.float32)
        if robot.shape != (3,):
            raise ValueError(f"Expected robot_position shape (3,), got {robot.shape}")
        dx = pts[:, 0] - robot[0]
        dy = pts[:, 1] - robot[1]
        mask &= np.sqrt(dx * dx + dy * dy) <= settings.max_range_m
    return pts[mask]


def subsample_near_robot(
    points: NDArray[np.floating],
    robot_position: tuple[float, float, float] | None,
    *,
    target_points: int = DEFAULT_TARGET_POINTS,
    rng: np.random.Generator | None = None,
) -> NDArray[np.float32]:
    """Cap point count with more samples near the robot in the ground plane (X/Y)."""
    if points.size == 0:
        return np.zeros((0, 3), dtype=np.float32)
    pts = np.asarray(points, dtype=np.float32)
    if pts.ndim != 2 or pts.shape[1] != 3:
        raise ValueError(f"Expected Nx3 points, got shape {pts.shape}")

    if robot_position is None:
        if len(pts) <= target_points:
            return pts
        stride = max(1, len(pts) // target_points)
        return pts[::stride][:target_points]

    robot = np.asarray(robot_position, dtype=np.float32)
    if robot.shape != (3,):
        raise ValueError(f"Expected robot_position shape (3,), got {robot.shape}")

    dx = pts[:, 0] - robot[0]
    dy = pts[:, 1] - robot[1]
    horiz_dist = np.sqrt(dx * dx + dy * dy)

    scale = target_points / sum(budget for _, _, budget in _ANNULUS_RINGS)
    ring_budgets = [max(0, round(budget * scale)) for _, _, budget in _ANNULUS_RINGS]
    ring_budgets[0] += target_points - sum(ring_budgets)

    generator = rng if rng is not None else np.random.default_rng()
    selected: list[int] = []
    for (min_m, max_m, _), budget in zip(_ANNULUS_RINGS, ring_budgets, strict=True):
        if budget <= 0:
            continue
        mask = (horiz_dist >= min_m) & (horiz_dist < max_m)
        ring_indices = np.flatnonzero(mask)
        if len(ring_indices) == 0:
            continue
        if len(ring_indices) <= budget:
            selected.extend(ring_indices.tolist())
        else:
            chosen = generator.choice(ring_indices, size=budget, replace=False)
            selected.extend(int(i) for i in chosen)

    if not selected:
        stride = max(1, len(pts) // target_points)
        return pts[::stride][:target_points]

    if len(selected) < target_points:
        remaining = np.setdiff1d(
            np.arange(len(pts), dtype=np.int64),
            np.asarray(selected, dtype=np.int64),
        )
        need = target_points - len(selected)
        if len(remaining) > 0:
            extra = generator.choice(remaining, size=min(need, len(remaining)), replace=False)
            selected.extend(int(i) for i in extra)

    if len(selected) > target_points:
        chosen = generator.choice(
            np.asarray(selected, dtype=np.int64),
            size=target_points,
            replace=False,
        )
        return np.asarray(pts[chosen], dtype=np.float32)

    return pts[np.asarray(selected, dtype=np.int64)].astype(np.float32)


def prepare_lidar_points(
    points: NDArray[np.floating],
    *,
    settings: LidarFilterSettings,
    robot_position: tuple[float, float, float] | None,
) -> NDArray[np.float32]:
    """Band-filter then subsample. ``robot_position`` must be raw odom, not display-scaled."""
    filtered = filter_points(points, settings=settings, robot_position=robot_position)
    return subsample_near_robot(
        filtered,
        robot_position,
        target_points=settings.target_points,
    )
