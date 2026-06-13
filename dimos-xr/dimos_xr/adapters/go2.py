"""Go2 adapter: handshake data, tag geometry, and nav stream routing for Go2.

Stream-name reconciliation (lidar/pointcloud/registered_scan → xr_lidar, etc.)
is handled in the blueprint via .remappings([...]) — not here.
"""

from __future__ import annotations

from dimos.core.core import rpc
from dimos.core.module import Module, ModuleConfig
from dimos.core.stream import In, Out
from dimos.msgs.geometry_msgs.PointStamped import PointStamped
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.nav_msgs.OccupancyGrid import OccupancyGrid
from dimos.msgs.nav_msgs.Path import Path
from dimos.msgs.sensor_msgs.PointCloud2 import PointCloud2
from dimos.robot.unitree.go2.connection_spec import GO2ConnectionSpec
from dimos.utils.logging_config import setup_logger
from dimos_lcm.std_msgs import Bool, String
from unitree_webrtc_connect.constants import RTC_TOPIC, SPORT_CMD

from dimos_xr.adapters.base import CapabilityState, RobotHandshake, XRRobotAdapterSpec
from dimos_xr.tracking.tag_tracker import DEFAULT_MARKER_ID, TAG_TOTAL_SIZE_M, TagMount

logger = setup_logger()

GO2_CAPABILITIES: dict[str, CapabilityState] = {
    "lidar": CapabilityState(True),
    "odom": CapabilityState(True),
    "align": CapabilityState(True),
    "align_manual": CapabilityState(True),
    "align_assist": CapabilityState(True),
    "nav": CapabilityState(True),
    "path": CapabilityState(True),
    "plan_preview": CapabilityState(True),
    "cancel_goal": CapabilityState(True),
    "emergency_stop": CapabilityState(True),
}

# Shoulder plate above/between front legs (approximate; verify with ruler on robot).
GO2_DEFAULT_TAG_MOUNTS: list[TagMount] = [
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
        capability_states=dict(GO2_CAPABILITIES),
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


class Go2AdapterConfig(ModuleConfig):  # type: ignore[misc]
    robot_id: str = "unitree_go2"


class Go2AdapterModule(Module, XRRobotAdapterSpec):  # type: ignore[misc]
    """Go2-specific adapter: stream fan-in + nav routing; no G1 code imported."""

    # Stream inputs — names match Go2 smart blueprint stream names.
    # Additional aliases (pointcloud, registered_scan, odometry, path_active)
    # are wired via .remappings([...]) in the blueprint.
    xr_lidar_in: In[PointCloud2]
    xr_odom_in: In[PoseStamped]
    xr_global_costmap_in: In[OccupancyGrid]
    xr_path_in: In[Path]
    xr_goal_reached_in: In[Bool]
    xr_navigation_state_in: In[String]

    xr_lidar: Out[PointCloud2]
    xr_odom: Out[PoseStamped]
    xr_global_costmap: Out[OccupancyGrid]
    xr_path: Out[Path]
    xr_goal_reached: Out[Bool]
    xr_navigation_state: Out[String]

    goal_request: Out[PoseStamped]
    goal_req: Out[PoseStamped]
    clicked_point: Out[PointStamped]
    stop_movement: Out[Bool]
    cancel_goal_signal: Out[Bool]

    config: Go2AdapterConfig
    _go2_connection: GO2ConnectionSpec | None = None

    async def handle_xr_lidar_in(self, msg: PointCloud2) -> None:
        self.xr_lidar.publish(msg)

    async def handle_xr_odom_in(self, msg: PoseStamped) -> None:
        self.xr_odom.publish(msg)

    async def handle_xr_global_costmap_in(self, msg: OccupancyGrid) -> None:
        self.xr_global_costmap.publish(msg)

    async def handle_xr_path_in(self, msg: Path) -> None:
        self.xr_path.publish(msg)

    async def handle_xr_goal_reached_in(self, msg: Bool) -> None:
        self.xr_goal_reached.publish(msg)

    async def handle_xr_navigation_state_in(self, msg: String) -> None:
        self.xr_navigation_state.publish(msg)

    def _nav_available(self) -> bool:
        return (
            self.goal_request.transport is not None
            or self.goal_req.transport is not None
            or self.clicked_point.transport is not None
        )

    def _path_available(self) -> bool:
        return self.xr_path_in.transport is not None

    def _plan_preview_available(self) -> bool:
        return self.xr_global_costmap_in.transport is not None

    def _cancel_goal_available(self) -> bool:
        return (
            self.stop_movement.transport is not None
            or self.cancel_goal_signal.transport is not None
        )

    def _emergency_stop_available(self) -> bool:
        return self._go2_connection is not None or self.stop_movement.transport is not None

    @rpc
    def robot_id(self) -> str:
        return self.config.robot_id

    @rpc
    def robot_model(self) -> str:
        return "unitree_go2"

    @rpc
    def capabilities(self) -> dict[str, CapabilityState]:
        capability_states = dict(GO2_CAPABILITIES)
        if not self._nav_available():
            capability_states["nav"] = CapabilityState(
                False, "Navigation stack is not present for this runtime."
            )
        if not self._path_available():
            capability_states["path"] = CapabilityState(
                False, "Path output is not present for this runtime."
            )
        if not self._plan_preview_available():
            capability_states["plan_preview"] = CapabilityState(
                False, "Global costmap is not present for preview planning in this runtime."
            )
        if not self._cancel_goal_available():
            capability_states["cancel_goal"] = CapabilityState(
                False, "Goal cancellation is not available for this runtime."
            )
        if not self._emergency_stop_available():
            capability_states["emergency_stop"] = CapabilityState(
                False, "No safe stop transport is present for this runtime."
            )
        if self._go2_connection is None:
            capability_states["align_assist"] = CapabilityState(
                False, "WebRTC connection is not present for this runtime."
            )
        return capability_states

    @rpc
    def handshake_payload(self) -> RobotHandshake:
        capability_states = self.capabilities()
        handshake = go2_handshake(self.robot_id())
        return RobotHandshake(
            robot_id=handshake.robot_id,
            robot_model=handshake.robot_model,
            display_name=handshake.display_name,
            capabilities=handshake.capabilities,
            capability_states=capability_states,
            body_bounds_m=handshake.body_bounds_m,
            footprint_m=handshake.footprint_m,
            visual_origin_frame=handshake.visual_origin_frame,
            base_height_m=handshake.base_height_m,
            default_render_offset_m=handshake.default_render_offset_m,
            alignment_profile=handshake.alignment_profile,
        )

    @rpc
    def send_nav_goal(self, goal: PoseStamped) -> bool:
        if self.goal_request.transport is not None:
            self.goal_request.publish(goal)
            return True
        if self.goal_req.transport is not None:
            self.goal_req.publish(goal)
            return True
        if self.clicked_point.transport is not None:
            self.clicked_point.publish(
                PointStamped(x=goal.x, y=goal.y, z=goal.z, ts=goal.ts, frame_id=goal.frame_id)
            )
            return True
        logger.warning("Go2 nav_goal rejected: no navigation transport is available")
        return False

    @rpc
    def cancel_goal(self) -> bool:
        cancelled = False
        if self.stop_movement.transport is not None:
            self.stop_movement.publish(Bool(data=True))
            cancelled = True
        if self.cancel_goal_signal.transport is not None:
            self.cancel_goal_signal.publish(Bool(data=True))
            cancelled = True
        if not cancelled:
            logger.warning("Go2 cancel_goal rejected: no navigation cancel path is available")
        return cancelled

    @rpc
    def emergency_stop(self) -> bool:
        if self.stop_movement.transport is not None:
            self.stop_movement.publish(Bool(data=True))
        if self._go2_connection is not None:
            self._go2_connection.publish_request(
                RTC_TOPIC["SPORT_MOD"],
                {"api_id": SPORT_CMD["StopMove"]},
            )
            return True
        if self.stop_movement.transport is not None:
            return True
        logger.warning("Go2 emergency_stop rejected: no safe stop path is available")
        return False

    @rpc
    def supports_goal_orientation(self) -> bool:
        return self._nav_available()

    @rpc
    def tag_mounts(self) -> list[TagMount]:
        return go2_tag_mounts()

    @rpc
    def assist_motion_available(self) -> bool:
        return self._go2_connection is not None

    @rpc
    def assist_set_lateral_velocity(self, vy_m_s: float) -> bool:
        if self._go2_connection is None:
            return False
        if vy_m_s == 0.0:
            self._go2_connection.publish_request(
                RTC_TOPIC["SPORT_MOD"],
                {"api_id": SPORT_CMD["StopMove"]},
            )
            return True
        vy = max(-0.20, min(0.20, float(vy_m_s)))
        self._go2_connection.publish_request(
            RTC_TOPIC["SPORT_MOD"],
            {"api_id": SPORT_CMD["Move"], "parameter": {"x": 0.0, "y": vy, "z": 0.0}},
        )
        return True
