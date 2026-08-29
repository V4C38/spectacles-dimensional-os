from __future__ import annotations

import numpy as np
import pytest

from dimos.ar.robot.capabilities import CapabilityName
from dimos.ar.robot.go2 import GO2_PROFILE, ODOM_SCALE_CORRECTION_FACTOR


def test_go2_odom_scale_correction_factor() -> None:
    assert ODOM_SCALE_CORRECTION_FACTOR == 1.25
    assert GO2_PROFILE.odom_scale_correction_factor == ODOM_SCALE_CORRECTION_FACTOR


def test_go2_hello_geometry() -> None:
    assert GO2_PROFILE.display_name == "Unitree Go2"
    assert GO2_PROFILE.body_bounds_m == (0.70, 0.50, 0.55)
    assert GO2_PROFILE.footprint_m == (0.70, 0.50)
    assert GO2_PROFILE.base_height_m == 0.33


def test_go2_capabilities_enabled() -> None:
    assert GO2_PROFILE.supported_capabilities == frozenset(
        {
            CapabilityName.LIDAR,
            CapabilityName.NAVIGATION,
            CapabilityName.ESTOP,
        }
    )


def test_go2_camera_optical_extrinsic_is_rigid() -> None:
    camera = GO2_PROFILE.T_base_camera_optical
    assert camera is not None
    assert camera.shape == (4, 4)
    assert np.isfinite(camera).all()
    assert camera[0, 3] == pytest.approx(0.3)


def test_go2_fiducial_marker_mounts() -> None:
    assert GO2_PROFILE.fiducial_dictionary == "DICT_APRILTAG_36h11"
    assert len(GO2_PROFILE.fiducial_marker_mounts) == 1
    mount = GO2_PROFILE.fiducial_marker_mounts[0]
    assert mount.marker_id == 0
    assert mount.size_m == pytest.approx(0.056)
