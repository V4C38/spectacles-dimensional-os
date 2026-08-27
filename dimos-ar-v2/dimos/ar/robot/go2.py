from __future__ import annotations

import numpy as np
from scipy.spatial.transform import Rotation

from dimos.ar.robot.profile import FiducialMarkerMount, RobotProfile
from dimos.robot.unitree.go2.dds.extrinsics import BASE_TO_CAMERA

ODOM_CORRECTION_FACTOR = 1.25

# Go2 ships an AprilTag-family 36h11 print; OpenCV dictionary name is vendor-specific.
GO2_FIDUCIAL_DICTIONARY = "DICT_APRILTAG_36h11"
GO2_FIDUCIAL_PRINT_SIZE_M = 0.070
GO2_FIDUCIAL_BLACK_SIZE_M = 0.056
GO2_DEFAULT_FIDUCIAL_MARKER_ID = 0

_GO2_FIDUCIAL_YAW_DEG = -90.0
_GO2_FIDUCIAL_PITCH_DEG = -15.0
_GO2_FIDUCIAL_QUAT: tuple[float, float, float, float] = tuple(
    (
        Rotation.from_euler("y", _GO2_FIDUCIAL_PITCH_DEG, degrees=True)
        * Rotation.from_euler("z", _GO2_FIDUCIAL_YAW_DEG, degrees=True)
    ).as_quat()
)


GO2_T_BASE_CAMERA_OPTICAL = np.asarray(BASE_TO_CAMERA.to_matrix(), dtype=np.float64)

GO2_FIDUCIAL_MARKER_MOUNTS: tuple[FiducialMarkerMount, ...] = (
    FiducialMarkerMount(
        marker_id=GO2_DEFAULT_FIDUCIAL_MARKER_ID,
        size_m=GO2_FIDUCIAL_BLACK_SIZE_M,
        position=(0.18, 0.0, 0.06),
        orientation=_GO2_FIDUCIAL_QUAT,
    ),
)

GO2_PROFILE = RobotProfile(
    display_name="Unitree Go2",
    body_bounds_m=(0.70, 0.50, 0.55),
    footprint_m=(0.70, 0.50),
    base_height_m=0.33,
    odom_correction_factor=ODOM_CORRECTION_FACTOR,
)
