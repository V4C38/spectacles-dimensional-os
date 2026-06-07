from __future__ import annotations

from dimos.core.core import rpc
from dimos.core.global_config import global_config
from dimos.core.module import Module, ModuleConfig
from dimos.core.stream import In, Out
from dimos.msgs.geometry_msgs.PointStamped import PointStamped
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.geometry_msgs.Twist import Twist
from dimos.msgs.geometry_msgs.Vector3 import Vector3
from dimos.msgs.nav_msgs.OccupancyGrid import OccupancyGrid
from dimos.msgs.nav_msgs.Odometry import Odometry
from dimos.msgs.nav_msgs.Path import Path
from dimos.msgs.sensor_msgs.CameraInfo import CameraInfo
from dimos.msgs.sensor_msgs.Image import Image
from dimos.msgs.sensor_msgs.PointCloud2 import PointCloud2
from dimos.navigation.navigation_spec import NavigationInterfaceSpec
from dimos.robot.unitree.g1.connection_spec import G1ConnectionSpec
from dimos.robot.unitree.g1.effectors.high_level.high_level_spec import HighLevelG1Spec
from dimos.robot.unitree.go2.connection_spec import GO2ConnectionSpec
from dimos.utils.logging_config import setup_logger
from dimos_lcm.std_msgs import Bool, String
from unitree_webrtc_connect.constants import RTC_TOPIC, SPORT_CMD

from dimos_xr.adapters.base import (
    CameraAlignmentConfig,
    CapabilityState,
    RobotHandshake,
    XRRobotAdapterSpec,
)
from dimos_xr.adapters.g1 import g1_camera_alignment_config, g1_handshake
from dimos_xr.adapters.go2 import GO2_CAPABILITIES, go2_camera_alignment_config, go2_handshake

logger = setup_logger()


class XRRobotAdapterConfig(ModuleConfig):
    robot_id: str = "robot"
    robot_model_override: str | None = None


class XRRobotAdapterModule(Module, XRRobotAdapterSpec):
    lidar: In[PointCloud2]
    pointcloud: In[PointCloud2]
    registered_scan: In[PointCloud2]
    odom: In[PoseStamped]
    odometry: In[Odometry]
    color_image: In[Image]
    camera_info: In[CameraInfo]
    global_costmap: In[OccupancyGrid]
    path: In[Path]
    path_active: In[Path]
    goal_reached: In[Bool]
    navigation_state: In[String]

    xr_lidar: Out[PointCloud2]
    xr_odom: Out[PoseStamped]
    xr_color_image: Out[Image]
    xr_camera_info: Out[CameraInfo]
    xr_global_costmap: Out[OccupancyGrid]
    xr_path: Out[Path]
    xr_goal_reached: Out[Bool]
    xr_navigation_state: Out[String]

    clicked_point: Out[PointStamped]
    goal_request: Out[PoseStamped]
    goal_req: Out[PoseStamped]
    stop_movement: Out[Bool]
    cancel_goal_signal: Out[Bool]

    config: XRRobotAdapterConfig
    _navigation: NavigationInterfaceSpec
    _go2_connection: GO2ConnectionSpec
    _g1_connection: G1ConnectionSpec
    _g1_high_level: HighLevelG1Spec

    async def handle_lidar(self, msg: PointCloud2) -> None:
        self.xr_lidar.publish(msg)

    async def handle_pointcloud(self, msg: PointCloud2) -> None:
        self.xr_lidar.publish(msg)

    async def handle_registered_scan(self, msg: PointCloud2) -> None:
        self.xr_lidar.publish(msg)

    async def handle_odom(self, msg: PoseStamped) -> None:
        self.xr_odom.publish(msg)

    async def handle_odometry(self, msg: Odometry) -> None:
        self.xr_odom.publish(
            PoseStamped(
                position=[msg.x, msg.y, msg.z],
                orientation=[
                    msg.orientation.x,
                    msg.orientation.y,
                    msg.orientation.z,
                    msg.orientation.w,
                ],
                ts=msg.ts,
                frame_id=msg.frame_id or "odom",
            )
        )

    async def handle_color_image(self, msg: Image) -> None:
        self.xr_color_image.publish(msg)

    async def handle_camera_info(self, msg: CameraInfo) -> None:
        self.xr_camera_info.publish(msg)

    async def handle_global_costmap(self, msg: OccupancyGrid) -> None:
        self.xr_global_costmap.publish(msg)

    async def handle_path(self, msg: Path) -> None:
        self.xr_path.publish(msg)

    async def handle_path_active(self, msg: Path) -> None:
        self.xr_path.publish(msg)

    async def handle_goal_reached(self, msg: Bool) -> None:
        self.xr_goal_reached.publish(msg)

    async def handle_navigation_state(self, msg: String) -> None:
        self.xr_navigation_state.publish(msg)

    def _configured_model(self) -> str:
        if self.config.robot_model_override:
            return self.config.robot_model_override
        if global_config.robot_model:
            return str(global_config.robot_model)
        if self._is_g1_runtime():
            return "unitree_g1"
        return "unitree_go2"

    def _is_g1_runtime(self) -> bool:
        model = str(global_config.robot_model or self.config.robot_model_override or "").lower()
        return "g1" in model or self._g1_connection is not None or self._g1_high_level is not None

    def _nav_available(self) -> bool:
        return (
            self._navigation is not None
            or self.goal_request.transport is not None
            or self.goal_req.transport is not None
            or self.clicked_point.transport is not None
        )

    def _path_available(self) -> bool:
        return self.path.transport is not None or self.path_active.transport is not None

    def _plan_preview_available(self) -> bool:
        return self.global_costmap.transport is not None

    def _cancel_goal_available(self) -> bool:
        return (
            self._navigation is not None
            or self.stop_movement.transport is not None
            or self.cancel_goal_signal.transport is not None
        )

    def _marker_alignment_available(self) -> bool:
        if not self._is_g1_runtime():
            return True
        return False

    def _emergency_stop_available(self) -> bool:
        if self._is_g1_runtime():
            return self._g1_high_level is not None or self._g1_connection is not None
        return self._go2_connection is not None or self.stop_movement.transport is not None

    @rpc
    def robot_id(self) -> str:
        configured = self.config.robot_id.strip()
        if configured and configured != "robot":
            return configured
        return self._configured_model()

    @rpc
    def robot_model(self) -> str:
        return self._configured_model()

    @rpc
    def capabilities(self) -> dict[str, CapabilityState]:
        if self._is_g1_runtime():
            return g1_handshake(
                self.robot_id(),
                nav_available=self._nav_available(),
                path_available=self._path_available(),
                plan_preview_available=self._plan_preview_available(),
                cancel_goal_available=self._cancel_goal_available(),
                emergency_stop_available=self._emergency_stop_available(),
                marker_align_available=self._marker_alignment_available(),
            ).capability_states
        handshake = go2_handshake(self.robot_id())
        if not self._nav_available():
            handshake.capability_states["nav"] = CapabilityState(
                False, "Navigation stack is not present for this runtime."
            )
        if not self._path_available():
            handshake.capability_states["path"] = CapabilityState(
                False, "Path output is not present for this runtime."
            )
        if not self._plan_preview_available():
            handshake.capability_states["plan_preview"] = CapabilityState(
                False, "Global costmap is not present for preview planning in this runtime."
            )
        if not self._cancel_goal_available():
            handshake.capability_states["cancel_goal"] = CapabilityState(
                False, "Goal cancellation is not available for this runtime."
            )
        if not self._emergency_stop_available():
            handshake.capability_states["emergency_stop"] = CapabilityState(
                False, "No safe stop transport is present for this runtime."
            )
        return handshake.capability_states

    @rpc
    def handshake_payload(self) -> RobotHandshake:
        if self._is_g1_runtime():
            return g1_handshake(
                self.robot_id(),
                nav_available=self._nav_available(),
                path_available=self._path_available(),
                plan_preview_available=self._plan_preview_available(),
                cancel_goal_available=self._cancel_goal_available(),
                emergency_stop_available=self._emergency_stop_available(),
                marker_align_available=self._marker_alignment_available(),
            )
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
        if self._navigation is not None:
            return bool(self._navigation.set_goal(goal))
        if self.goal_request.transport is not None:
            self.goal_request.publish(goal)
            return True
        if self.goal_req.transport is not None:
            self.goal_req.publish(goal)
            return True
        if self.clicked_point.transport is not None:
            self.clicked_point.publish(
                PointStamped(
                    x=goal.x,
                    y=goal.y,
                    z=goal.z,
                    ts=goal.ts,
                    frame_id=goal.frame_id,
                )
            )
            return True
        logger.warning("XR nav_goal rejected: no navigation transport is available")
        return False

    @rpc
    def cancel_goal(self) -> bool:
        cancelled = False
        if self._navigation is not None:
            cancelled = bool(self._navigation.cancel_goal())
        if self.stop_movement.transport is not None:
            self.stop_movement.publish(Bool(data=True))
            cancelled = True
        if self.cancel_goal_signal.transport is not None:
            self.cancel_goal_signal.publish(Bool(data=True))
            cancelled = True
        if not cancelled:
            logger.warning("XR cancel_goal rejected: no navigation cancel path is available")
        return cancelled

    @rpc
    def emergency_stop(self) -> bool:
        if self._is_g1_runtime():
            stop_twist = Twist(
                linear=Vector3(0.0, 0.0, 0.0),
                angular=Vector3(0.0, 0.0, 0.0),
            )
            if self._g1_high_level is not None:
                return bool(self._g1_high_level.move(stop_twist, duration=0.0))
            if self._g1_connection is not None:
                self._g1_connection.move(stop_twist, duration=0.0)
                return True
        else:
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
        logger.warning("XR emergency_stop rejected: no safe stop path is available")
        return False

    @rpc
    def supports_goal_orientation(self) -> bool:
        return self._nav_available()

    @rpc
    def camera_alignment_config(self) -> CameraAlignmentConfig:
        if self._is_g1_runtime():
            return g1_camera_alignment_config()
        return go2_camera_alignment_config()
