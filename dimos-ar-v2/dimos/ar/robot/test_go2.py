from __future__ import annotations

import numpy as np
import pytest

from dimos.ar.robot.go2 import (
    GO2_FIDUCIAL_BLACK_SIZE_M,
    GO2_FIDUCIAL_MARKER_MOUNTS,
    GO2_FIDUCIAL_PRINT_SIZE_M,
    GO2_PROFILE,
    GO2_T_BASE_CAMERA_OPTICAL,
    ODOM_CORRECTION_FACTOR,
)


def test_go2_odom_correction_factor() -> None:
    assert ODOM_CORRECTION_FACTOR == 1.25
    assert GO2_PROFILE.odom_correction_factor == ODOM_CORRECTION_FACTOR


def test_go2_hello_geometry() -> None:
    assert GO2_PROFILE.display_name == "Unitree Go2"
    assert GO2_PROFILE.body_bounds_m == (0.70, 0.50, 0.55)
    assert GO2_PROFILE.footprint_m == (0.70, 0.50)
    assert GO2_PROFILE.base_height_m == 0.33


def test_go2_camera_optical_extrinsic_is_rigid() -> None:
    assert GO2_T_BASE_CAMERA_OPTICAL.shape == (4, 4)
    assert np.isfinite(GO2_T_BASE_CAMERA_OPTICAL).all()
    assert GO2_T_BASE_CAMERA_OPTICAL[0, 3] == pytest.approx(0.3)


def test_go2_fiducial_marker_mount_constants() -> None:
    assert GO2_FIDUCIAL_PRINT_SIZE_M == pytest.approx(0.070)
    assert GO2_FIDUCIAL_BLACK_SIZE_M == pytest.approx(0.056)
    assert len(GO2_FIDUCIAL_MARKER_MOUNTS) == 1
    assert GO2_FIDUCIAL_MARKER_MOUNTS[0].marker_id == 0
