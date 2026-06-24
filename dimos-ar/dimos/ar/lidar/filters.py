"""LiDAR filtering and near-robot-weighted subsampling for WebSocket broadcast.

Rate-limiting is handled via ``time.monotonic()`` inside ``LidarFilter``;
the ``RateLimiter`` class has been removed in favour of inline monotonic checks.
Use ``PointCloud2.voxel_downsample`` for initial density reduction before the
near-robot weighting stage (which is XR-specific and has no DimOS equivalent).
"""

from __future__ import annotations

from dataclasses import dataclass, field
import time
from typing import TYPE_CHECKING, cast

import numpy as np

if TYPE_CHECKING:
    from numpy.typing import NDArray

DEFAULT_ROBOT_BODY_HEIGHT_M: float = 0.55
LIDAR_FLOOR_CLEARANCE_M: float = 0.005
LIDAR_MAX_HEIGHT_ABOVE_BODY_M: float = 1.0

_ANNULUS_RINGS: tuple[tuple[float, float, int], ...] = (
    (0.0, 1.0, 500),
    (1.0, 2.5, 350),
    (2.5, 4.0, 150),
)


def lidar_height_band_m(
    *,
    body_bounds_m: tuple[float, float, float] | None,
    base_height_m: float | None,
) -> tuple[float, float]:
    """Robot odom Z band equivalent to floor clearance through body height + 1 m."""
    body_h = (
        body_bounds_m[2]
        if body_bounds_m is not None
        else (base_height_m if base_height_m is not None else DEFAULT_ROBOT_BODY_HEIGHT_M)
    )
    base_h = base_height_m if base_height_m is not None else body_h
    min_height_m = -base_h + LIDAR_FLOOR_CLEARANCE_M
    max_height_m = (body_h + LIDAR_MAX_HEIGHT_ABOVE_BODY_M) - base_h
    return min_height_m, max_height_m


@dataclass
class LidarFilterConfig:
    max_range_m: float | None = 3.0
    min_height_m: float | None = 0.1
    max_height_m: float | None = 1.5
    target_points: int = 2500
    max_hz: float = 10.0
    obstacle_height_threshold_m: float = 0.08
    _last_emit: float = field(default=0.0, init=False, repr=False, compare=False)

    @property
    def min_interval_s(self) -> float:
        return 1.0 / self.max_hz if self.max_hz > 0 else 0.0

    def allow(self) -> bool:
        """Return True if enough time has elapsed since the last allowed message."""
        if self.min_interval_s <= 0:
            return True
        now = time.monotonic()
        if now - self._last_emit >= self.min_interval_s:
            self._last_emit = now
            return True
        return False


@dataclass(frozen=True)
class LidarObstacleDistanceConfig:
    min_distance_m: float = 0.10
    opaque_distance_m: float = 0.40
    max_distance_m: float = 0.60


class LidarFilter:
    def __init__(self, config: LidarFilterConfig | None = None) -> None:
        self.config = config or LidarFilterConfig()

    def filter(self, points: NDArray[np.floating]) -> NDArray[np.float32]:
        """Apply height/range band filter (vectorised; no loops over points)."""
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


def filter_obstacle_points(
    points: NDArray[np.floating],
    config: LidarObstacleDistanceConfig,
    *,
    robot_position: tuple[float, float, float] | None = None,
    vertical_axis: int = 2,
    min_height_m: float | None = None,
    max_height_m: float | None = None,
) -> NDArray[np.float32]:
    """Keep only obstacle points inside a robot-centred horizontal annulus.

    ``vertical_axis`` selects the up-axis for the supplied point frame:
    - ``2`` for odom-space clouds where +Z is up.
    - ``1`` for world-space clouds where +Y is up.
    """
    if points.size == 0:
        return np.zeros((0, 3), dtype=np.float32)
    pts = np.asarray(points, dtype=np.float32)
    if pts.ndim != 2 or pts.shape[1] != 3:
        raise ValueError(f"Expected Nx3 points, got shape {pts.shape}")
    if vertical_axis not in (0, 1, 2):
        raise ValueError(f"Expected vertical_axis in (0, 1, 2), got {vertical_axis}")
    origin = np.zeros(3, dtype=np.float32)
    if robot_position is not None:
        origin = np.asarray(robot_position, dtype=np.float32)
        if origin.shape != (3,):
            raise ValueError(f"Expected robot_position shape (3,), got {origin.shape}")
    horizontal_axes = [axis for axis in range(3) if axis != vertical_axis]
    horizontal = np.linalg.norm(pts[:, horizontal_axes] - origin[horizontal_axes], axis=1)
    mask = (
        (horizontal >= config.min_distance_m)
        & (horizontal <= config.max_distance_m)
    )
    if min_height_m is not None:
        mask &= pts[:, vertical_axis] >= origin[vertical_axis] + min_height_m
    if max_height_m is not None:
        mask &= pts[:, vertical_axis] <= origin[vertical_axis] + max_height_m
    pts = pts[mask]
    if len(pts) == 0:
        return np.zeros((0, 3), dtype=np.float32)
    return np.asarray(pts, dtype=np.float32)


def subsample_points_near_robot(
    points_world: NDArray[np.floating],
    robot_world_position: tuple[float, float, float] | None,
    *,
    target_points: int = 1000,
) -> NDArray[np.float32]:
    """Cap world-frame LiDAR with more points near the robot.

    XR-specific: preserves near-robot density so AR users see detailed floor
    geometry around the robot. Applies on top of PointCloud2.voxel_downsample
    output (see bridge.telemetry.TelemetryPublisher.publish_lidar).
    """
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
    ring_budgets = [max(0, round(budget * scale)) for _, _, budget in _ANNULUS_RINGS]
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
            "NDArray[np.int64]",
            rng.choice(
                np.asarray(selected_indices, dtype=np.int64),
                size=target_points,
                replace=False,
            ),
        )
        return pts[chosen].astype(np.float32)

    return pts[np.asarray(selected_indices, dtype=np.int64)].astype(np.float32)
