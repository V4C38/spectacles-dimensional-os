"""Robot-mounted AprilTag tracking for the AR bridge."""

from dimos.ar.tag_tracking.fiducial_helpers import create_aruco_detector
from dimos.ar.tag_tracking.solve import (
    CAMERA_FRAME_MAGIC,
    DEFAULT_APRILTAG_DICT,
    DEFAULT_MARKER_ID,
    FLIP_YZ,
    MAX_HEADER_BYTES,
    R_ALIGN,
    TAG_BLACK_SIZE_M,
    TAG_TOTAL_SIZE_M,
    TagMount,
    TagObservation,
    _yaw_from_T,
    build_camera_info,
    build_T_world_odom,
    orientation_yaw_deg,
    parse_camera_frame,
    reprojection_error_px,
)

__all__ = [
    "CAMERA_FRAME_MAGIC",
    "DEFAULT_APRILTAG_DICT",
    "DEFAULT_MARKER_ID",
    "FLIP_YZ",
    "MAX_HEADER_BYTES",
    "R_ALIGN",
    "TAG_BLACK_SIZE_M",
    "TAG_TOTAL_SIZE_M",
    "TagMount",
    "TagObservation",
    "_yaw_from_T",
    "build_T_world_odom",
    "build_camera_info",
    "create_aruco_detector",
    "orientation_yaw_deg",
    "parse_camera_frame",
    "reprojection_error_px",
]
