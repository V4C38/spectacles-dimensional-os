from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LidarSettings:
    enabled: bool
    min_height_m: float
    max_height_m: float
    max_range_m: float


DEFAULT_LIDAR_SETTINGS = LidarSettings(
    enabled=False,
    min_height_m=0.1,
    max_height_m=1.5,
    max_range_m=5.0,
)
