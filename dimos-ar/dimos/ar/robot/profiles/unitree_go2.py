from __future__ import annotations

import numpy as np
from scipy.spatial.transform import Rotation

from dimos.ar.robot.capabilities import CapabilityName
from dimos.ar.robot.profiles.profile import FiducialMarkerMount, RobotProfile
from dimos.robot.unitree.go2.dds.extrinsics import BASE_TO_CAMERA

ODOM_SCALE_CORRECTION_FACTOR = 1.25

_FIDUCIAL_DICTIONARY = "DICT_APRILTAG_36h11"
_FIDUCIAL_BLACK_SIZE_M = 0.056
_DEFAULT_FIDUCIAL_MARKER_ID = 0

_FIDUCIAL_YAW_DEG = -90.0
_FIDUCIAL_PITCH_DEG = -15.0
_FIDUCIAL_QUAT: tuple[float, float, float, float] = tuple(
    (
        Rotation.from_euler("y", _FIDUCIAL_PITCH_DEG, degrees=True)
        * Rotation.from_euler("z", _FIDUCIAL_YAW_DEG, degrees=True)
    ).as_quat()
)

UNITREE_GO2_PROFILE = RobotProfile(
    display_name="Unitree Go2",
    body_bounds_m=(0.70, 0.50, 0.55),
    footprint_m=(0.70, 0.50),
    base_height_m=0.33,
    odom_scale_correction_factor=ODOM_SCALE_CORRECTION_FACTOR,
    fiducial_dictionary=_FIDUCIAL_DICTIONARY,
    fiducial_marker_mounts=(
        FiducialMarkerMount(
            marker_id=_DEFAULT_FIDUCIAL_MARKER_ID,
            size_m=_FIDUCIAL_BLACK_SIZE_M,
            position=(0.18, 0.0, 0.06),
            orientation=_FIDUCIAL_QUAT,
        ),
    ),
    T_base_camera_optical=np.asarray(BASE_TO_CAMERA.to_matrix(), dtype=np.float64),
    supported_capabilities=frozenset(
        {
            CapabilityName.LIDAR,
            CapabilityName.NAVIGATION,
            CapabilityName.ESTOP,
        }
    ),
)
