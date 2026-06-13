"""G1 adapter: handshake data, tag geometry, and nav stream routing for G1.

Stream-name reconciliation (lidar/pointcloud/registered_scan → xr_lidar, etc.)
is handled in the blueprint via .remappings([...]) — not here.
"""

from __future__ import annotations

from dimos.core.core import rpc
from dimos.core.module import Module, ModuleConfig
from dimos.core.stream import In, Out
from dimos.msgs.geometry_msgs.PointStamped import PointStamped
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.geometry_msgs.Twist import Twist
from dimos.msgs.geometry_msgs.Vector3 import Vector3
from dimos.msgs.nav_msgs.OccupancyGrid import OccupancyGrid
from dimos.msgs.nav_msgs.Path import Path
from dimos.msgs.sensor_msgs.PointCloud2 import PointCloud2
from dimos.robot.unitree.g1.connection_spec import G1ConnectionSpec
from dimos.robot.unitree.g1.effectors.high_level.high_level_spec import HighLevelG1Spec
from dimos.utils.logging_config import setup_logger
from dimos_lcm.std_msgs import Bool, String

from dimos_xr.adapters.base import CapabilityState, RobotHandshake, XRRobotAdapterSpec
from dimos_xr.tracking.tag_tracker import DEFAULT_MARKER_ID, TAG_TOTAL_SIZE_M, TagMount

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
        "align_assist": CapabilityState(
            False,
            "Assisted calibration motion is not available for this runtime.",
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


class G1AdapterConfig(ModuleConfig):  # type: ignore[misc]
    robot_id: str = "unitree_g1"


class G1AdapterModule(Module, XRRobotAdapterSpec):  # type: ignore[misc]
    """G1-specific adapter: stream fan-in + nav routing; no Go2 code imported."""

    # Stream inputs — names match G1 nav-onboard blueprint stream names.
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

    config: G1AdapterConfig
    _g1_connection: G1ConnectionSpec | None = None
    _g1_high_level: HighLevelG1Spec | None = None

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
            nav_available=self._nav_available(),
            path_available=self._path_available(),
            plan_preview_available=self._plan_preview_available(),
            cancel_goal_available=self._cancel_goal_available(),
            emergency_stop_available=self._emergency_stop_available(),
            marker_align_available=len(self.tag_mounts()) > 0,
        )

    @rpc
    def handshake_payload(self) -> RobotHandshake:
        return g1_handshake(
            self.robot_id(),
            nav_available=self._nav_available(),
            path_available=self._path_available(),
            plan_preview_available=self._plan_preview_available(),
            cancel_goal_available=self._cancel_goal_available(),
            emergency_stop_available=self._emergency_stop_available(),
            marker_align_available=len(self.tag_mounts()) > 0,
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
        logger.warning("G1 nav_goal rejected: no navigation transport is available")
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
            logger.warning("G1 cancel_goal rejected: no navigation cancel path is available")
        return cancelled

    @rpc
    def emergency_stop(self) -> bool:
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
        return self._nav_available()

    @rpc
    def tag_mounts(self) -> list[TagMount]:
        return g1_tag_mounts()

    @rpc
    def assist_motion_available(self) -> bool:
        return False

    @rpc
    def assist_set_lateral_velocity(self, vy_m_s: float) -> bool:
        return False
