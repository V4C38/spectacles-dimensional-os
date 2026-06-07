from __future__ import annotations

from dimos_xr.adapters.base import CameraAlignmentConfig, CapabilityState, RobotHandshake
from dimos_xr.alignment import (
    DEFAULT_CAMERA_ORIENTATION,
    DEFAULT_CAMERA_POSITION,
    DEFAULT_GO2_FRONT_CAMERA_INFO,
    DEFAULT_MARKER_LENGTH_M,
    DEFAULT_TIMESTAMP_TOLERANCE_S,
)

GO2_CAPABILITIES = {
    "lidar": CapabilityState(True),
    "odom": CapabilityState(True),
    "align": CapabilityState(True),
    "align_manual": CapabilityState(True),
    "nav": CapabilityState(True),
    "path": CapabilityState(True),
    "plan_preview": CapabilityState(True),
    "cancel_goal": CapabilityState(True),
    "emergency_stop": CapabilityState(True),
}


def go2_camera_alignment_config() -> CameraAlignmentConfig:
    return CameraAlignmentConfig(
        position=DEFAULT_CAMERA_POSITION,
        orientation=DEFAULT_CAMERA_ORIENTATION,
        marker_length_m=DEFAULT_MARKER_LENGTH_M,
        timestamp_tolerance_s=DEFAULT_TIMESTAMP_TOLERANCE_S,
        camera_info=DEFAULT_GO2_FRONT_CAMERA_INFO,
    )


def go2_handshake(robot_id: str) -> RobotHandshake:
    return RobotHandshake(
        robot_id=robot_id,
        robot_model="unitree_go2",
        display_name="Unitree Go2",
        capabilities=list(GO2_CAPABILITIES.keys()),
        capability_states=GO2_CAPABILITIES,
        body_bounds_m=(0.70, 0.50, 0.55),
        footprint_m=(0.70, 0.50),
        visual_origin_frame="base_link",
        base_height_m=0.33,
        default_render_offset_m=(0.0, 0.0, 0.0),
        alignment_profile={"camera": "front_rgb"},
    )
