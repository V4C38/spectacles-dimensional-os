"""G1 robot profile: handshake data, tag geometry, and hard e-stop for G1.

Stream-name reconciliation (lidar/pointcloud/registered_scan → ar_lidar, etc.)
is handled in the blueprint via .remappings([...]) — not here.
"""

from __future__ import annotations

from typing import Any

from dimos.ar.robot_profile.base import (
    ARRobotProfileSpec,
    CapabilityState,
    RobotHandshake,
    TagTrackingProfile,
)
from dimos.ar.tag_tracking.solve import DEFAULT_MARKER_ID, TAG_TOTAL_SIZE_M, TagMount
from dimos.core.core import rpc
from dimos.core.module import Module, ModuleConfig
from dimos.msgs.geometry_msgs.Twist import Twist
from dimos.msgs.geometry_msgs.Vector3 import Vector3
from dimos.robot.unitree.g1.connection_spec import G1ConnectionSpec
from dimos.utils.logging_config import setup_logger

logger = setup_logger()

G1_DEFAULT_TAG_MOUNTS: list[TagMount] = [
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
    cancel_goal_available: bool,
    emergency_stop_available: bool,
    tag_mount_available: bool,
) -> dict[str, CapabilityState]:
    return {
        "lidar": CapabilityState(True),
        "odom": CapabilityState(True),
        "registration_april_tag": CapabilityState(
            tag_mount_available,
            None
            if tag_mount_available
            else "AprilTag registration is not available for this G1 runtime.",
        ),
        "registration_manual_pose": CapabilityState(
            tag_mount_available,
            None
            if tag_mount_available
            else "Manual registration is not available for the active G1 runtime.",
        ),
        "nav": CapabilityState(
            nav_available,
            None if nav_available else "Navigation stack is not present for this G1 runtime.",
        ),
        "path": CapabilityState(
            path_available,
            None if path_available else "Active path output is not present for this G1 runtime.",
        ),
        "cancel_nav_goal": CapabilityState(
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


def g1_runtime_tag_tracking_profile() -> TagTrackingProfile:
    return TagTrackingProfile(
        runtime_static_speed_mps=0.08,
        runtime_max_correct_speed_mps=1.2,
        runtime_cruise_window_s=14.0,
        runtime_speed_horizon_s=0.9,
    )


def g1_handshake(
    robot_id: str,
    *,
    nav_available: bool,
    path_available: bool,
    cancel_goal_available: bool,
    emergency_stop_available: bool,
    tag_mount_available: bool,
) -> RobotHandshake:
    capability_states = g1_capabilities(
        nav_available=nav_available,
        path_available=path_available,
        cancel_goal_available=cancel_goal_available,
        emergency_stop_available=emergency_stop_available,
        tag_mount_available=tag_mount_available,
    )
    tag_ids = [m.tag_id for m in G1_DEFAULT_TAG_MOUNTS]
    return RobotHandshake(
        robot_id=robot_id,
        display_name="Unitree G1",
        capability_states=capability_states,
        body_bounds_m=(0.65, 0.45, 1.35),
        footprint_m=(0.32, 0.24),
        visual_origin_frame="base_link",
        base_height_m=0.95,
        default_render_offset_m=(0.0, 0.0, 0.0),
        tag_tracking_profile={
            "tag_ids": tag_ids,
            "tag_total_size_m": TAG_TOTAL_SIZE_M,
        },
    )


class G1RobotProfileConfig(ModuleConfig):  # type: ignore[misc]
    robot_id: str = "unitree_g1"


class G1RobotProfileModule(Module, ARRobotProfileSpec):  # type: ignore[misc]
    """G1-specific profile: cold-path robot metadata and hard-stop RPC."""

    config: G1RobotProfileConfig
    _g1_connection: G1ConnectionSpec | None = None
    _g1_high_level: Any = None

    def _emergency_stop_available(self) -> bool:
        return self._g1_high_level is not None or self._g1_connection is not None

    @rpc
    def robot_id(self) -> str:
        return self.config.robot_id

    @rpc
    def robot_model(self) -> str:
        return "unitree_g1"

    @rpc
    def capabilities(self) -> dict[str, CapabilityState]:
        return g1_capabilities(
            nav_available=True,
            path_available=True,
            cancel_goal_available=True,
            emergency_stop_available=self._emergency_stop_available(),
            tag_mount_available=len(self.tag_mounts()) > 0,
        )

    @rpc
    def handshake_payload(self) -> RobotHandshake:
        return g1_handshake(
            self.robot_id(),
            nav_available=True,
            path_available=True,
            cancel_goal_available=True,
            emergency_stop_available=self._emergency_stop_available(),
            tag_mount_available=len(self.tag_mounts()) > 0,
        )

    @rpc
    def emergency_stop(self) -> bool:
        """Optional belt-and-suspenders G1 stop; hot path uses bridge cmd_vel zero."""
        stop_twist = Twist(
            linear=Vector3(0.0, 0.0, 0.0),
            angular=Vector3(0.0, 0.0, 0.0),
        )
        if self._g1_high_level is not None:
            return bool(self._g1_high_level.move(stop_twist, duration=0.0))
        if self._g1_connection is not None:
            self._g1_connection.move(stop_twist, duration=0.0)
            return True
        logger.warning("G1 emergency_stop rejected: no safe stop path is available")
        return False

    @rpc
    def supports_goal_orientation(self) -> bool:
        return True

    @rpc
    def tag_mounts(self) -> list[TagMount]:
        return g1_tag_mounts()

    @rpc
    def runtime_tag_tracking_profile(self) -> TagTrackingProfile:
        return g1_runtime_tag_tracking_profile()
