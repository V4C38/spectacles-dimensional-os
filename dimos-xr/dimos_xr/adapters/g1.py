from __future__ import annotations

from dimos_xr.adapters.base import CapabilityState, RobotHandshake
from dimos_xr.marker_contract import DEFAULT_MARKER_ID, TAG_TOTAL_SIZE_M
from dimos_xr.tag_tracker import TagMount

G1_DEFAULT_TAG_MOUNTS = [
    TagMount(
        tag_id=DEFAULT_MARKER_ID,
        size_m=0.056,
        position=(0.10, 0.0, 0.35),
        orientation=(0.0, -0.70710678, 0.0, 0.70710678),
    ),
]


def g1_tag_mounts() -> list[TagMount]:
    return list(G1_DEFAULT_TAG_MOUNTS)


def g1_capabilities(
    *,
    nav_available: bool,
    path_available: bool,
    plan_preview_available: bool,
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
        "plan_preview": CapabilityState(
            plan_preview_available,
            None
            if plan_preview_available
            else "Global costmap is not present for preview planning in this G1 runtime.",
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


def g1_handshake(
    robot_id: str,
    *,
    nav_available: bool,
    path_available: bool,
    plan_preview_available: bool,
    cancel_goal_available: bool,
    emergency_stop_available: bool,
    marker_align_available: bool,
) -> RobotHandshake:
    capability_states = g1_capabilities(
        nav_available=nav_available,
        path_available=path_available,
        plan_preview_available=plan_preview_available,
        cancel_goal_available=cancel_goal_available,
        emergency_stop_available=emergency_stop_available,
        marker_align_available=marker_align_available,
    )
    tag_ids = [m.tag_id for m in G1_DEFAULT_TAG_MOUNTS]
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
            "method": "tag",
            "tag_ids": tag_ids,
            "tag_total_size_m": TAG_TOTAL_SIZE_M,
        },
    )
