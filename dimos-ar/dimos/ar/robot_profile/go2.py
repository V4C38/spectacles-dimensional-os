"""Go2 robot profile: handshake data, tag geometry, and telemetry fan-in for Go2.

Stream-name reconciliation (lidar/pointcloud/registered_scan → ar_lidar, etc.)
is handled in the blueprint via .remappings([...]) — not here.
"""

from __future__ import annotations

from dimos_lcm.std_msgs import Bool, String
from scipy.spatial.transform import Rotation as _Rotation

from dimos.ar.robot_profile.base import (
    DEFAULT_BASELINE_MOTION_RECIPE,
    ARRobotProfileSpec,
    BaselineMotionRecipe,
    CapabilityState,
    RobotHandshake,
    TagTrackingProfile,
)
from dimos.ar.robot_profile.sensor_conflation import LatestWinsGate
from dimos.ar.tag_tracking.solve import DEFAULT_MARKER_ID, TAG_TOTAL_SIZE_M, TagMount
from dimos.core.core import rpc
from dimos.core.module import Module, ModuleConfig
from dimos.core.stream import In, Out
from dimos.msgs.geometry_msgs.PointStamped import PointStamped
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.geometry_msgs.Twist import Twist
from dimos.msgs.nav_msgs.OccupancyGrid import OccupancyGrid
from dimos.msgs.nav_msgs.Path import Path
from dimos.msgs.sensor_msgs.PointCloud2 import PointCloud2
from dimos.robot.unitree.go2.connection_spec import GO2ConnectionSpec
from dimos.utils.logging_config import setup_logger

logger = setup_logger()

GO2_CAPABILITIES: dict[str, CapabilityState] = {
    "lidar": CapabilityState(True),
    "odom": CapabilityState(True),
    "registration_april_odom_baseline": CapabilityState(True),
    "registration_manual_pose": CapabilityState(True),
    "nav": CapabilityState(True),
    "path": CapabilityState(True),
    "plan_preview": CapabilityState(True),
    "cancel_nav_goal": CapabilityState(True),
    "emergency_stop": CapabilityState(True),
}

_GO2_TAG_YAW_DEG: float = -90.0
_GO2_TAG_PITCH_DEG: float = -5.0
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
    """Go2-specific profile: telemetry fan-in and cold-path robot metadata."""

    ar_lidar_in: In[PointCloud2]
    ar_odom_in: In[PoseStamped]
    ar_global_costmap_in: In[OccupancyGrid]
    ar_path_in: In[Path]
    ar_goal_reached_in: In[Bool]
    ar_navigation_state_in: In[String]

    ar_lidar: Out[PointCloud2]
    ar_odom: Out[PoseStamped]
    ar_global_costmap: Out[OccupancyGrid]
    ar_path: Out[Path]
    ar_goal_reached: Out[Bool]
    ar_navigation_state: Out[String]

    goal_request: Out[PoseStamped]
    goal_req: Out[PoseStamped]
    clicked_point: Out[PointStamped]
    stop_movement: Out[Bool]
    cancel_goal_signal: Out[Bool]
    cmd_vel: Out[Twist]

    config: Go2RobotProfileConfig
    _go2_connection: GO2ConnectionSpec | None = None
    _lidar_gate: LatestWinsGate
    _costmap_gate: LatestWinsGate
    _path_gate: LatestWinsGate

    def __init__(self, **kwargs: object) -> None:
        super().__init__(**kwargs)
        self._lidar_gate = LatestWinsGate()
        self._costmap_gate = LatestWinsGate()
        self._path_gate = LatestWinsGate()

    async def handle_ar_lidar_in(self, msg: PointCloud2) -> None:
        seq = self._lidar_gate.enter()
        await self._lidar_gate.yield_for_coalesce()
        if not self._lidar_gate.still_latest(seq):
            return
        self.ar_lidar.publish(msg)

    async def handle_ar_odom_in(self, msg: PoseStamped) -> None:
        self.ar_odom.publish(msg)

    async def handle_ar_global_costmap_in(self, msg: OccupancyGrid) -> None:
        seq = self._costmap_gate.enter()
        await self._costmap_gate.yield_for_coalesce()
        if not self._costmap_gate.still_latest(seq):
            return
        self.ar_global_costmap.publish(msg)

    async def handle_ar_path_in(self, msg: Path) -> None:
        seq = self._path_gate.enter()
        await self._path_gate.yield_for_coalesce()
        if not self._path_gate.still_latest(seq):
            return
        self.ar_path.publish(msg)

    async def handle_ar_goal_reached_in(self, msg: Bool) -> None:
        self.ar_goal_reached.publish(msg)

    async def handle_ar_navigation_state_in(self, msg: String) -> None:
        self.ar_navigation_state.publish(msg)

    def _nav_available(self) -> bool:
        return (
            self.goal_request.transport is not None
            or self.goal_req.transport is not None
            or self.clicked_point.transport is not None
        )

    def _path_available(self) -> bool:
        return self.ar_path_in.transport is not None

    def _plan_preview_available(self) -> bool:
        return self.ar_global_costmap_in.transport is not None

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
            capability_states["cancel_nav_goal"] = CapabilityState(
                False, "Goal cancellation is not available for this runtime."
            )
        if not self._emergency_stop_available():
            capability_states["emergency_stop"] = CapabilityState(
                False, "No safe stop transport is present for this runtime."
            )
        if self.cmd_vel.transport is None:
            capability_states["registration_april_odom_baseline"] = CapabilityState(
                False,
                "cmd_vel transport is not present for baseline registration motion in this runtime.",
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
        if self.stop_movement.transport is not None:
            self.stop_movement.publish(Bool(data=True))
        if self._go2_connection is not None:
            from unitree_webrtc_connect.constants import RTC_TOPIC, SPORT_CMD

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
    def baseline_motion_available(self) -> bool:
        return self.cmd_vel.transport is not None

    @rpc
    def baseline_motion_recipe(self) -> BaselineMotionRecipe:
        return DEFAULT_BASELINE_MOTION_RECIPE

    @rpc
    def runtime_tag_tracking_profile(self) -> TagTrackingProfile:
        return go2_runtime_tag_tracking_profile()
