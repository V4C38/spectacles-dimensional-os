from __future__ import annotations

from dimos.ar.robot.go2 import GO2_PROFILE, ODOM_CORRECTION_FACTOR


def test_go2_odom_correction_factor() -> None:
    assert ODOM_CORRECTION_FACTOR == 1.25
    assert GO2_PROFILE.odom_correction_factor == ODOM_CORRECTION_FACTOR


def test_go2_hello_geometry() -> None:
    assert GO2_PROFILE.display_name == "Unitree Go2"
    assert GO2_PROFILE.body_bounds_m == (0.70, 0.50, 0.55)
    assert GO2_PROFILE.footprint_m == (0.70, 0.50)
    assert GO2_PROFILE.base_height_m == 0.33
