from __future__ import annotations

from dimos_xr.adapters.base import CapabilityState, RobotHandshake
from dimos_xr.marker_contract import DEFAULT_MARKER_ID, TAG_TOTAL_SIZE_M
from dimos_xr.tag_tracker import TagMount

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

# Shoulder plate above/between front legs (approximate; verify with ruler on robot).
GO2_DEFAULT_TAG_MOUNTS = [
    TagMount(
        tag_id=DEFAULT_MARKER_ID,
        size_m=0.056,
        position=(0.19, 0.0, 0.07),
        orientation=(0.0, 0.0, -0.70710678, 0.70710678),
    ),
]


def go2_tag_mounts() -> list[TagMount]:
    return list(GO2_DEFAULT_TAG_MOUNTS)


def go2_handshake(robot_id: str) -> RobotHandshake:
    tag_ids = [m.tag_id for m in GO2_DEFAULT_TAG_MOUNTS]
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
        alignment_profile={
            "method": "tag",
            "tag_ids": tag_ids,
            "tag_total_size_m": TAG_TOTAL_SIZE_M,
        },
    )
