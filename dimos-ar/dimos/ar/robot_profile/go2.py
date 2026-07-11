"""Go2 robot profile: handshake data, tag geometry, and hard e-stop for Go2.

Stream-name reconciliation (lidar/pointcloud/registered_scan → ar_lidar, etc.)
is handled in the blueprint via .remappings([...]) — not here.
"""

from __future__ import annotations

from scipy.spatial.transform import Rotation as _Rotation

from dimos.ar.robot_profile.base import (
    ARRobotProfileSpec,
    CapabilityState,
    RobotHandshake,
    TagTrackingProfile,
)
from dimos.ar.tag_tracking.solve import DEFAULT_MARKER_ID, TAG_TOTAL_SIZE_M, TagMount
from dimos.core.core import rpc
from dimos.core.module import Module, ModuleConfig
from dimos.robot.unitree.go2.connection_spec import GO2ConnectionSpec
from dimos.utils.logging_config import setup_logger

logger = setup_logger()

GO2_CAPABILITIES: dict[str, CapabilityState] = {
    "lidar": CapabilityState(True),
    "odom": CapabilityState(True),
    "nav": CapabilityState(True),
    "path": CapabilityState(True),
    "cancel_nav_goal": CapabilityState(True),
    "emergency_stop": CapabilityState(True),
}

_GO2_TAG_YAW_DEG: float = -90.0
_GO2_TAG_PITCH_DEG: float = -15.0
_GO2_TAG_QUAT: tuple[float, float, float, float] = tuple(  # type: ignore[assignment]
    (
        _Rotation.from_euler("y", _GO2_TAG_PITCH_DEG, degrees=True)
        * _Rotation.from_euler("z", _GO2_TAG_YAW_DEG, degrees=True)
    ).as_quat()
)

GO2_DEFAULT_TAG_MOUNTS: list[TagMount] = [
    TagMount(
        tag_id=DEFAULT_MARKER_ID,
        size_m=0.056,
        position=(0.18, 0.0, 0.06),
        orientation=_GO2_TAG_QUAT,
    ),
    # Uncomment and set the real pose to enable per-frame yaw observability.
    # TagMount(tag_id=1, size_m=0.056, position=(0.0, 0.0, 0.0), orientation=_GO2_TAG_QUAT),
]


def go2_tag_mounts() -> list[TagMount]:
    return list(GO2_DEFAULT_TAG_MOUNTS)


def go2_runtime_tag_tracking_profile() -> TagTrackingProfile:
    return TagTrackingProfile()


def go2_handshake(robot_id: str) -> RobotHandshake:
    tag_ids = [m.tag_id for m in GO2_DEFAULT_TAG_MOUNTS]
    return RobotHandshake(
        robot_id=robot_id,
        display_name="Unitree Go2",
        capability_states=dict(GO2_CAPABILITIES),
        body_bounds_m=(0.70, 0.50, 0.55),
        footprint_m=(0.70, 0.50),
        visual_origin_frame="base_link",
        base_height_m=0.33,
        default_render_offset_m=(0.0, 0.0, 0.0),
        tag_tracking_profile={
            "tag_ids": tag_ids,
            "tag_total_size_m": TAG_TOTAL_SIZE_M,
        },
    )


class Go2RobotProfileConfig(ModuleConfig):  # type: ignore[misc]
    robot_id: str = "unitree_go2"


class Go2RobotProfileModule(Module, ARRobotProfileSpec):  # type: ignore[misc]
    """Go2-specific profile: cold-path robot metadata and hard-stop RPC."""

    config: Go2RobotProfileConfig
    _go2_connection: GO2ConnectionSpec | None = None

    def _emergency_stop_available(self) -> bool:
        return self._go2_connection is not None

    @rpc
    def robot_id(self) -> str:
        return self.config.robot_id

    @rpc
    def robot_model(self) -> str:
        return "unitree_go2"

    @rpc
    def capabilities(self) -> dict[str, CapabilityState]:
        capability_states = dict(GO2_CAPABILITIES)
        if not self._emergency_stop_available():
            capability_states["emergency_stop"] = CapabilityState(
                False, "No safe stop transport is present for this runtime."
            )
        return capability_states

    @rpc
    def handshake_payload(self) -> RobotHandshake:
        capability_states = self.capabilities()
        handshake = go2_handshake(self.robot_id())
        return RobotHandshake(
            robot_id=handshake.robot_id,
            display_name=handshake.display_name,
            capability_states=capability_states,
            body_bounds_m=handshake.body_bounds_m,
            footprint_m=handshake.footprint_m,
            visual_origin_frame=handshake.visual_origin_frame,
            base_height_m=handshake.base_height_m,
            default_render_offset_m=handshake.default_render_offset_m,
            tag_tracking_profile=handshake.tag_tracking_profile,
        )

    @rpc
    def emergency_stop(self) -> bool:
        """Optional belt-and-suspenders SPORT StopMove; hot path uses bridge cmd_vel zero."""
        if self._go2_connection is not None:
            from unitree_webrtc_connect.constants import RTC_TOPIC, SPORT_CMD

            self._go2_connection.publish_request(
                RTC_TOPIC["SPORT_MOD"],
                {"api_id": SPORT_CMD["StopMove"]},
            )
            return True
        logger.warning("Go2 emergency_stop rejected: no safe stop path is available")
        return False

    @rpc
    def supports_goal_orientation(self) -> bool:
        return True

    @rpc
    def tag_mounts(self) -> list[TagMount]:
        return go2_tag_mounts()

    @rpc
    def runtime_tag_tracking_profile(self) -> TagTrackingProfile:
        return go2_runtime_tag_tracking_profile()
