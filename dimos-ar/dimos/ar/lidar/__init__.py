"""LiDAR filtering for WebSocket broadcast."""

from dimos.ar.lidar.filters import (
    DEFAULT_ROBOT_BODY_HEIGHT_M,
    LIDAR_FLOOR_CLEARANCE_M,
    LIDAR_MAX_HEIGHT_ABOVE_BODY_M,
    LidarFilter,
    LidarFilterConfig,
    LidarObstacleDistanceConfig,
    filter_obstacle_points,
    lidar_height_band_m,
    subsample_points_near_robot,
)

__all__ = [
    "DEFAULT_ROBOT_BODY_HEIGHT_M",
    "LIDAR_FLOOR_CLEARANCE_M",
    "LIDAR_MAX_HEIGHT_ABOVE_BODY_M",
    "LidarFilter",
    "LidarFilterConfig",
    "LidarObstacleDistanceConfig",
    "filter_obstacle_points",
    "lidar_height_band_m",
    "subsample_points_near_robot",
]
