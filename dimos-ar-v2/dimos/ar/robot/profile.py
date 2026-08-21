from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RobotProfile:
    display_name: str
    body_bounds_m: tuple[float, float, float]
    footprint_m: tuple[float, float]
    base_height_m: float
    odom_correction_factor: float
