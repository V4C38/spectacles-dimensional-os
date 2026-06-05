from __future__ import annotations

from dimos_xr.adapters.base import CameraAlignmentConfig, CapabilityState, RobotHandshake
from dimos_xr.alignment import DEFAULT_MARKER_LENGTH_M, DEFAULT_TIMESTAMP_TOLERANCE_S


def g1_capabilities(
    *,
    nav_available: bool,
    path_available: bool,
    cancel_goal_available: bool,
    emergency_stop_available: bool,
    marker_align_available: bool,
) -> dict[str, CapabilityState]:
    return {
        "lidar": CapabilityState(True),
        "odom": CapabilityState(True),
        "align": CapabilityState(
            marker_align_available,
            None
            if marker_align_available
            else "Marker alignment is not available for the active G1 runtime.",
        ),
        "align_manual": CapabilityState(True),
        "nav": CapabilityState(
            nav_available,
            None if nav_available else "Navigation stack is not present for this G1 runtime.",
        ),
        "path": CapabilityState(
            path_available,
            None if path_available else "Active path output is not present for this G1 runtime.",
        ),
        "cancel_goal": CapabilityState(
            cancel_goal_available,
            None
            if cancel_goal_available
            else "Goal cancellation is not available for this G1 runtime.",
        ),
        "emergency_stop": CapabilityState(
            emergency_stop_available,
            None
            if emergency_stop_available
            else "No safe G1 high-level stop interface is available in this runtime.",
        ),
    }


def g1_camera_alignment_config() -> CameraAlignmentConfig:
    return CameraAlignmentConfig(
        position=(0.0, 0.0, 0.0),
        orientation=(0.0, 0.0, 0.0, 1.0),
        marker_length_m=DEFAULT_MARKER_LENGTH_M,
        timestamp_tolerance_s=DEFAULT_TIMESTAMP_TOLERANCE_S,
        camera_info=None,
    )


def g1_handshake(
    robot_id: str,
    *,
    nav_available: bool,
    path_available: bool,
    cancel_goal_available: bool,
    emergency_stop_available: bool,
    marker_align_available: bool,
) -> RobotHandshake:
    capability_states = g1_capabilities(
        nav_available=nav_available,
        path_available=path_available,
        cancel_goal_available=cancel_goal_available,
        emergency_stop_available=emergency_stop_available,
        marker_align_available=marker_align_available,
    )
    return RobotHandshake(
        robot_id=robot_id,
        robot_model="unitree_g1",
        display_name="Unitree G1",
        capabilities=list(capability_states.keys()),
        capability_states=capability_states,
        body_bounds_m=(0.65, 0.45, 1.35),
        footprint_m=(0.32, 0.24),
        visual_origin_frame="base_link",
        base_height_m=0.95,
        default_render_offset_m=(0.0, 0.0, 0.0),
        alignment_profile={
            "camera": "head_rgb",
            "marker_alignment": "enabled" if marker_align_available else "manual_only",
        },
    )
