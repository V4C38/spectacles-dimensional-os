"""G1 adapter: handshake data, tag geometry, and nav stream routing for G1.

Stream-name reconciliation (lidar/pointcloud/registered_scan → ar_lidar, etc.)
is handled in the blueprint via .remappings([...]) — not here.
"""

from __future__ import annotations

import threading
import time
from typing import Any

from dimos_lcm.std_msgs import Bool, String

from dimos.ar.adapters.base import (
    ARRobotAdapterSpec,
    BaselineMotionRecipe,
    CapabilityState,
    DEFAULT_BASELINE_MOTION_RECIPE,
    RobotHandshake,
    TagTrackingProfile,
)
from dimos.ar.tag_tracking.solve import DEFAULT_MARKER_ID, TAG_TOTAL_SIZE_M, TagMount
from dimos.core.core import rpc
from dimos.core.module import Module, ModuleConfig
from dimos.core.stream import In, Out
from dimos.msgs.geometry_msgs.PointStamped import PointStamped
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.geometry_msgs.Twist import Twist
from dimos.msgs.geometry_msgs.Vector3 import Vector3
from dimos.msgs.nav_msgs.OccupancyGrid import OccupancyGrid
from dimos.msgs.nav_msgs.Odometry import Odometry
from dimos.msgs.nav_msgs.Path import Path
from dimos.msgs.sensor_msgs.PointCloud2 import PointCloud2
from dimos.msgs.std_msgs.Bool import Bool as NavBool
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
    plan_preview_available: bool,
    cancel_goal_available: bool,
    emergency_stop_available: bool,
    tag_mount_available: bool,
    baseline_motion_available: bool = False,
) -> dict[str, CapabilityState]:
    return {
        "lidar": CapabilityState(True),
        "odom": CapabilityState(True),
        "registration_april_odom_baseline": CapabilityState(
            baseline_motion_available and tag_mount_available,
            None
            if baseline_motion_available and tag_mount_available
            else "AprilTag baseline registration is not available for this G1 runtime.",
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
    plan_preview_available: bool,
    cancel_goal_available: bool,
    emergency_stop_available: bool,
    tag_mount_available: bool,
    baseline_motion_available: bool = False,
) -> RobotHandshake:
    capability_states = g1_capabilities(
        nav_available=nav_available,
        path_available=path_available,
        plan_preview_available=plan_preview_available,
        cancel_goal_available=cancel_goal_available,
        emergency_stop_available=emergency_stop_available,
        tag_mount_available=tag_mount_available,
        baseline_motion_available=baseline_motion_available,
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


class G1AdapterConfig(ModuleConfig):  # type: ignore[misc]
    robot_id: str = "unitree_g1"


class G1AdapterModule(Module, ARRobotAdapterSpec):  # type: ignore[misc]
    """G1-specific adapter: stream fan-in + nav routing; no Go2 code imported."""

    # Stream inputs — names match G1 nav-onboard blueprint stream names.
    # Additional aliases (pointcloud, registered_scan, odometry, path_active)
    # are wired via .remappings([...]) in the blueprint.
    ar_lidar_in: In[PointCloud2]
    ar_odom_in: In[Odometry]
    ar_global_costmap_in: In[OccupancyGrid]
    ar_path_in: In[Path]
    ar_goal_reached_in: In[NavBool]
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
    cancel_goal_signal: Out[NavBool]
    cmd_vel: Out[Twist]

    config: G1AdapterConfig
    _g1_connection: G1ConnectionSpec | None = None
    _g1_high_level: Any = None
    _baseline_vel_lock: threading.Lock
    _baseline_vel_thread: threading.Thread | None
    _baseline_vel_target: float

    def __init__(self, **kwargs: object) -> None:
        super().__init__(**kwargs)
        self._baseline_vel_lock = threading.Lock()
        self._baseline_vel_thread = None
        self._baseline_vel_target = 0.0

    async def handle_ar_lidar_in(self, msg: PointCloud2) -> None:
        self.ar_lidar.publish(msg)

    async def handle_ar_odom_in(self, msg: Odometry) -> None:
        pose = PoseStamped(
            ts=msg.ts,
            frame_id=msg.child_frame_id or msg.frame_id,
            position=(msg.x, msg.y, msg.z),
            orientation=(
                msg.orientation.x,
                msg.orientation.y,
                msg.orientation.z,
                msg.orientation.w,
            ),
        )
        # Preserve twist for OdomBuffer.sample_from_msg speed estimation (duck-typed).
        pose.vx = msg.vx  # type: ignore[attr-defined]
        pose.vy = msg.vy  # type: ignore[attr-defined]
        self.ar_odom.publish(pose)

    async def handle_ar_global_costmap_in(self, msg: OccupancyGrid) -> None:
        self.ar_global_costmap.publish(msg)

    async def handle_ar_path_in(self, msg: Path) -> None:
        self.ar_path.publish(msg)

    async def handle_ar_goal_reached_in(self, msg: NavBool) -> None:
        self.ar_goal_reached.publish(Bool(data=msg.data))

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
            tag_mount_available=len(self.tag_mounts()) > 0,
            baseline_motion_available=self.baseline_motion_available(),
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
            tag_mount_available=len(self.tag_mounts()) > 0,
            baseline_motion_available=self.baseline_motion_available(),
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
        logger.warning("G1 goal rejected: no navigation transport is available")
        return False

    @rpc
    def cancel_goal(self) -> bool:
        cancelled = False
        if self.stop_movement.transport is not None:
            self.stop_movement.publish(Bool(data=True))
            cancelled = True
        if self.cancel_goal_signal.transport is not None:
            self.cancel_goal_signal.publish(NavBool(data=True))
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
    def baseline_motion_available(self) -> bool:
        return self.cmd_vel.transport is not None

    @rpc
    def baseline_motion_recipe(self) -> BaselineMotionRecipe:
        return DEFAULT_BASELINE_MOTION_RECIPE

    @rpc
    def runtime_tag_tracking_profile(self) -> TagTrackingProfile:
        return g1_runtime_tag_tracking_profile()

    @rpc
    def baseline_set_lateral_velocity(self, vy_m_s: float) -> bool:
        with self._baseline_vel_lock:
            self._baseline_vel_target = float(vy_m_s)

        if vy_m_s == 0.0:
            self._publish_baseline_twist(0.0)
            return True

        with self._baseline_vel_lock:
            if self._baseline_vel_thread is None or not self._baseline_vel_thread.is_alive():
                t = threading.Thread(
                    target=self._baseline_vel_loop,
                    daemon=True,
                    name="ar-g1-assist-vel",
                )
                self._baseline_vel_thread = t
                t.start()
        return True

    def _baseline_vel_loop(self) -> None:
        while True:
            with self._baseline_vel_lock:
                vy = self._baseline_vel_target
            if vy == 0.0:
                break
            self._publish_baseline_twist(vy)
            time.sleep(1.0 / 50.0)

    def _publish_baseline_twist(self, vy: float) -> None:
        if self.cmd_vel.transport is None:
            logger.warning("G1 baseline_set_lateral_velocity: cmd_vel transport not available")
            return
        self.cmd_vel.publish(
            Twist(
                linear=Vector3(0.0, vy, 0.0),
                angular=Vector3(0.0, 0.0, 0.0),
            )
        )
