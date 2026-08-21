from __future__ import annotations

from dimos.ar.robot.profile import RobotProfile

ODOM_CORRECTION_FACTOR = 1.25

GO2_PROFILE = RobotProfile(
    display_name="Unitree Go2",
    body_bounds_m=(0.70, 0.50, 0.55),
    footprint_m=(0.70, 0.50),
    base_height_m=0.33,
    odom_correction_factor=ODOM_CORRECTION_FACTOR,
)
