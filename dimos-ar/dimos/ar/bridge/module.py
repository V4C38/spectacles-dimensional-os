"""ARBridge — DimOS Module that wires collaborators and owns stream handlers.

This file contains only the DimOS-facing surface:
  - In[...] stream field declarations (DimOS auto-binds handle_ar_* by name)
  - @rpc build / start / stop (collaborator construction and lifecycle)
  - handle_ar_* delegators (thin fan-out to collaborators)
  - Runtime-sync helpers (_send_runtime_sync_to, _send_status_to)
  - Client-disconnect handler

All business logic lives in the bridge/ collaborator classes.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, ClassVar

from dimos_lcm.std_msgs import Bool, String

from dimos.ar.bridge.motion_router import MotionRouter
from dimos.ar.bridge.odom_buffer import OdomBuffer
from dimos.ar.bridge.profile_rpc_dispatch import dispatch_profile_nowait
from dimos.ar.bridge.safety import BridgeSafetyCoordinator
from dimos.ar.bridge.sender import BridgeSender
from dimos.ar.bridge.status_service import StatusService
from dimos.ar.bridge.telemetry import TelemetryPublisher
from dimos.ar.lidar.filters import LidarFilter, LidarFilterConfig, lidar_height_band_m
from dimos.ar.navigation.navigate import NavigateGoalHandler
from dimos.ar.network.protocol import (
    JoystickCommandMessage,
    NavGoalMessage,
    SetLidarModeMessage,
    encode_runtime_snapshot,
)
from dimos.ar.network.websocket_server import ARWebSocketServer
from dimos.ar.registration.session import RegistrationSession
from dimos.ar.robot_profile.base import (
    ARRobotProfileSpec,
    RobotHandshake,
    merge_capability_availability,
)
from dimos.ar.tag_tracking.tracker import RobotAprilTagTracker, RobotAprilTagTrackerConfig
from dimos.ar.utils.console import console_divider
from dimos.ar.utils.network import detect_lan_ip
from dimos.ar.world_frame.aligner import SimilarityAligner
from dimos.ar.world_frame.refinement import WorldFrameRefiner
from dimos.ar.world_frame.registry import WorldRegistry
from dimos.ar.world_frame.state import WorldFrameState
from dimos.core.core import rpc
from dimos.core.global_config import global_config
from dimos.core.module import Module, ModuleConfig
from dimos.core.stream import In, Out
from dimos.msgs.geometry_msgs.PointStamped import PointStamped
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.geometry_msgs.Twist import Twist
from dimos.msgs.nav_msgs.OccupancyGrid import OccupancyGrid
from dimos.msgs.nav_msgs.Odometry import Odometry
from dimos.msgs.nav_msgs.Path import Path
from dimos.msgs.sensor_msgs.PointCloud2 import PointCloud2
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from websockets.asyncio.server import ServerConnection

    from dimos.ar.network.protocol import GetStatusMessage

logger = setup_logger()


def _pose_stamped_from_odometry(msg: Odometry) -> PoseStamped:
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
    pose.vx = msg.vx  # type: ignore[attr-defined]
    pose.vy = msg.vy  # type: ignore[attr-defined]
    return pose


class ARBridgeConfig(ModuleConfig):  # type: ignore[misc]
    port: int = 8787
    # max_message_bytes: Spectacles IntermediateQuality stills are 0.3-1.5 MB (see
    # scripts/frame_probe.py). 4 MB is a comfortable upper bound.
    max_message_bytes: int = 4_194_304
    max_range_m: float | None = None
    obstacle_height_threshold_m: float = 0.08
    target_points: int = 1000
    obstacle_target_points: int = 200
    lidar_max_hz: float = 1.0
    # Voxel grid size for coarse LiDAR downsampling before the height-band filter.
    # The DimOS default is 0.025 m; 0.05 m is chosen deliberately for AR payload budget.
    lidar_voxel_size_m: float = 0.05
    pose_max_hz: float = 15.0
    stream_stale_timeout_s: float = 10.0
    manual_registration_quality: float = 0.35
    # still-capture + JPEG-encode on device can take 2-4 s; this gate must be
    # wider than that or frames are discarded before reaching the detector.
    # Geometrically safe: process_frame looks up odom at recv_mono - frame_age
    # and the camera pose in the header is sampled at true capture time.
    frame_max_age_s: float = 4.0
    # Tag geometry — defaults match scripts/generate_marker.py output (70 mm total,
    # 56 mm black detection square, AprilTag 36h11, tag ID 0 on top of robot body).
    tag_aruco_dictionary: str = "DICT_APRILTAG_36h11"
    tag_total_size_m: float = 0.070
    tag_black_size_m: float = 0.056
    tag_max_distance_m: float = 6.0
    tag_min_baseline_m: float = 0.15
    tag_window_max_obs: int = 40
    tag_window_max_age_s: float = 120.0
    tag_max_reprojection_error_px: float = 3.0
    tag_max_mount_residual_m: float = 0.15
    tag_max_up_axis_tilt_deg: float = 20.0
    runtime_correction_enabled: bool = True
    ALIGN_RECENCY_TAU_S: float = 4.0
    ALIGN_MAX_DIST_CAM_M: float = 4.0
    ALIGN_AMBIGUITY_MIN: float = 1.5
    ALIGN_AMBIGUITY_PENALTY: float = 0.3
    ALIGN_MAX_PAIR_SKEW_S: float = 0.25
    ALIGN_DIAG_LATEST_OBS: int = 1
    ALIGN_WINDOW_MAX_AGE_S: float = 8.0
    ALIGN_WINDOW_MAX_OBS: int = 24
    ALIGN_MIN_OBS: int = 3
    ALIGN_REG_MIN_OBS: int = 4
    ALIGN_REG_CONF_MIN: float = 0.7
    ALIGN_HUBER_K: float = 1.5
    ALIGN_OUTLIER_K: float = 3.0
    ALIGN_SCALE_PLAUSIBLE_MIN: float = 1.0
    ALIGN_SCALE_PLAUSIBLE_MAX: float = 1.6
    ODOM_SCALE_HARD_MIN: float = 0.5
    ODOM_SCALE_HARD_MAX: float = 2.0
    ALIGN_YAW_BASELINE_B0: float = 0.15
    ALIGN_YAW_BASELINE_B1: float = 0.35
    ALIGN_SCALE_BASELINE_B0: float = 0.45
    ALIGN_SCALE_BASELINE_B1: float = 0.90
    ALIGN_LEARN_LR: float = 0.5
    ALIGN_LEARN_LR_MAX: float = 0.5
    ALIGN_CONF_DECAY: float = 0.02
    ALIGN_SCALE_JUMP_FRAC: float = 0.15
    ALIGN_SCALE_LOCK_CONF: float = 0.6
    ALIGN_SCALE_REGIME_N: int = 3
    ALIGN_SCALE_JUMP_DAMP: float = 0.15
    ALIGN_SCALE_PRIOR: float = 1.25
    ALIGN_REG_YAW_CONF: float = 0.3
    ALIGN_RESID_REF_M: float = 0.20
    ALIGN_REBASE_RESID_M: float = 0.30
    ALIGN_REBASE_FRAC: float = 0.6
    ALIGN_REBASE_DIR_STD_RAD: float = 0.5
    ALIGN_REBASE_KEEP: int = 2
    ALIGN_UI_CONFIDENT: float = 0.7


class ARBridge(Module):  # type: ignore[misc]
    dedicated_worker: ClassVar[bool] = True

    ar_lidar: In[PointCloud2]
    ar_odom: In[PoseStamped]
    ar_odometry: In[Odometry]
    ar_global_costmap: In[OccupancyGrid]
    ar_path: In[Path]
    ar_goal_reached: In[Bool]
    ar_navigation_state: In[String]
    cmd_vel: Out[Twist]
    goal_request: Out[PoseStamped]
    goal_point_request: Out[PointStamped]
    stop_movement: Out[Bool]
    cancel_goal_signal: Out[Bool]

    config: ARBridgeConfig
    _profile: ARRobotProfileSpec

    # Collaborators (set in build())
    _sender: BridgeSender
    _odom: OdomBuffer
    _status: StatusService
    _registration: RegistrationSession
    _nav: NavigateGoalHandler
    _motion_router: MotionRouter
    _telemetry: TelemetryPublisher
    _ws_server: ARWebSocketServer
    _robot_id: str
    _connect_handshake: RobotHandshake

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        # Adapter-independent shared objects created eagerly.
        self._world_frame = WorldFrameState()

    @rpc
    def build(self) -> None:
        # Runs after the coordinator wires self._profile (set_module_ref).
        super().build()

        robot_id = self._profile.robot_id()
        self._robot_id = robot_id
        handshake = merge_capability_availability(
            self._profile.handshake_payload(),
            {
                "path": self.ar_path.transport is not None,
                "nav": (
                    self.goal_request.transport is not None
                    or self.goal_point_request.transport is not None
                ),
                "cancel_nav_goal": (
                    self.stop_movement.transport is not None
                    or self.cancel_goal_signal.transport is not None
                ),
                "registration_april_tag": len(self._profile.tag_mounts()) > 0,
            },
        )
        self._connect_handshake = handshake
        runtime_profile = self._profile.runtime_tag_tracking_profile()

        # LiDAR height band comes from the adapter handshake only (not ARBridgeConfig).
        min_height_m, max_height_m = lidar_height_band_m(
            body_bounds_m=handshake.body_bounds_m,
            base_height_m=handshake.base_height_m,
        )
        filter_config = LidarFilterConfig(
            max_range_m=self.config.max_range_m,
            min_height_m=min_height_m,
            max_height_m=max_height_m,
            obstacle_height_threshold_m=self.config.obstacle_height_threshold_m,
            target_points=self.config.target_points,
            max_hz=self.config.lidar_max_hz,
        )
        lidar_filter = LidarFilter(filter_config)

        # Shared sender (bound to ws_server after construction).
        sender = BridgeSender()

        odom = OdomBuffer()

        status = StatusService(
            robot_id=robot_id,
            sender=sender,
            world_frame=self._world_frame,
            stream_stale_timeout_s=self.config.stream_stale_timeout_s,
        )

        tracker_config = RobotAprilTagTrackerConfig(
            max_reprojection_error_px=self.config.tag_max_reprojection_error_px,
            max_pair_skew_s=self.config.ALIGN_MAX_PAIR_SKEW_S,
            max_distance_m=self.config.tag_max_distance_m,
            min_baseline_m=self.config.tag_min_baseline_m,
            window_max_obs=self.config.tag_window_max_obs,
            window_max_age_s=self.config.tag_window_max_age_s,
            max_mount_residual_m=self.config.tag_max_mount_residual_m,
            max_up_axis_tilt_deg=self.config.tag_max_up_axis_tilt_deg,
        )
        tag_tracker = RobotAprilTagTracker(
            self._profile.tag_mounts(),
            config=tracker_config,
        )
        telemetry = TelemetryPublisher(
            robot_id=robot_id,
            sender=sender,
            world_frame=self._world_frame,
            odom=odom,
            lidar_filter=lidar_filter,
            target_points=self.config.target_points,
            obstacle_target_points=self.config.obstacle_target_points,
            lidar_voxel_size_m=self.config.lidar_voxel_size_m,
            pose_max_hz=self.config.pose_max_hz,
            speed_horizon_s=runtime_profile.runtime_speed_horizon_s,
        )
        registry = WorldRegistry(self._world_frame, self.tf.publish_static, odom_latest=odom.latest)
        self._world_frame.configure_odom_scale_limits(
            hard_min=self.config.ODOM_SCALE_HARD_MIN,
            hard_max=self.config.ODOM_SCALE_HARD_MAX,
        )
        assert self._loop is not None, "build() called before Module loop is assigned"
        nav_ref: NavigateGoalHandler | None = None

        def _on_world_frame_corrected() -> None:
            assert nav_ref is not None
            nav_ref.on_world_frame_corrected()

        world_frame_refiner = WorldFrameRefiner(
            registry=registry,
            telemetry=telemetry,
            odom=odom,
            tag_tracker=tag_tracker,
            runtime_profile=runtime_profile,
            runtime_correction_enabled=self.config.runtime_correction_enabled,
            diag_latest_observations=self.config.ALIGN_DIAG_LATEST_OBS,
        )
        similarity_aligner = SimilarityAligner(
            registry=registry,
            telemetry=telemetry,
            sender=sender,
            odom=odom,
            tag_tracker=tag_tracker,
            config=self.config,
            apply_floor_y_lock=world_frame_refiner._apply_floor_y_lock,
            on_correction_committed=_on_world_frame_corrected,
        )
        world_frame_refiner.attach_aligner(similarity_aligner)
        registry.attach_refiner(world_frame_refiner)
        telemetry._floor_y_drift_check = world_frame_refiner.check_floor_y_drift

        def _on_nav_preempted() -> None:
            assert nav_ref is not None
            nav_ref.on_preempted()

        motion_router = MotionRouter(
            publish_cmd_vel=self.cmd_vel.publish,
            publish_nav_goal=self.goal_request.publish,
            publish_nav_point_goal=self.goal_point_request.publish,
            publish_stop_movement=self.stop_movement.publish,
            publish_cancel_goal=self.cancel_goal_signal.publish,
            hard_stop=lambda: dispatch_profile_nowait(self._profile.emergency_stop),
            on_nav_preempted=_on_nav_preempted,
        )
        registration = RegistrationSession(
            robot_id=robot_id,
            sender=sender,
            registry=registry,
            odom=odom,
            status=status,
            tag_tracker=tag_tracker,
            loop=self._loop,
            frame_max_age_s=self.config.frame_max_age_s,
            manual_registration_quality=self.config.manual_registration_quality,
            world_frame_refiner=world_frame_refiner,
            runtime_profile=runtime_profile,
        )

        nav = NavigateGoalHandler(
            robot_id=robot_id,
            sender=sender,
            world_frame=self._world_frame,
            motion_router=motion_router,
            odom_latest=odom.latest,
            robot_connected=lambda: status.snapshot().robot_connected,
        )
        nav_ref = nav

        safety = BridgeSafetyCoordinator(
            nav=nav,
            registration=registration,
            motion_router=motion_router,
        )

        ws_server = ARWebSocketServer(
            port=self.config.port,
            hello_supplier=self._connect_hello,
            max_message_bytes=self.config.max_message_bytes,
            loop=self._loop,
            on_registration_command=registration.on_registration_command,
            on_camera_info=registration.on_camera_info,
            on_camera_frame=registration.on_camera_frame,
            on_registration_pose=registration.on_registration_pose,
            on_nav_goal=self._route_nav_goal_message,
            on_cancel_nav_goal=lambda msg: nav.on_cancel_nav_goal(msg.ts),
            on_joystick_command=self._on_joystick_command,
            on_emergency_stop=safety.on_emergency_stop,
            on_get_status=self._on_get_status,
            on_set_lidar_mode=self._on_set_lidar_mode,
            on_status_connect=self._send_status_to,
            on_disconnect=self._on_client_disconnect,
        )
        sender.bind(ws_server)

        self._sender = sender
        self._odom = odom
        self._status = status
        self._registration = registration
        self._nav = nav
        self._motion_router = motion_router
        self._safety = safety
        self._telemetry = telemetry
        self._ws_server = ws_server

    def _connect_hello(self) -> RobotHandshake:
        """Return the handshake cached at build() — must not RPC from the WS loop."""
        return self._connect_handshake

    @rpc
    def start(self) -> None:
        super().start()
        self._motion_router.validate_transports(
            has_pose_goal=self.goal_request.transport is not None,
            has_point_goal=self.goal_point_request.transport is not None,
            has_cancel=(
                self.stop_movement.transport is not None
                or self.cancel_goal_signal.transport is not None
            ),
        )
        self._ws_server.start()
        self._status.start()
        self._nav.start()
        host = global_config.listen_host
        logger.info("ARBridge started", websocket=f"ws://{host}:{self.config.port}")
        lan_ip = detect_lan_ip()
        subtitle = f"Spectacles: enter {lan_ip} in the lens" if lan_ip else None
        console_divider(
            f"Bridge ready — ws://{host}:{self.config.port}",
            subtitle=subtitle,
        )
        self._status.broadcast()

    @rpc
    def stop(self) -> None:
        nav = getattr(self, "_nav", None)
        if nav is not None:
            nav.stop()
        registration = getattr(self, "_registration", None)
        if registration is not None:
            registration.stop()
        motion_router = getattr(self, "_motion_router", None)
        if motion_router is not None:
            motion_router.emergency_stop()
        status = getattr(self, "_status", None)
        if status is not None:
            status.stop()
        ws_server = getattr(self, "_ws_server", None)
        if ws_server is not None:
            ws_server.stop()
        logger.info("ARBridge stopping")
        super().stop()

    # ------------------------------------------------------------------
    # Stream handlers — DimOS auto-binds these by name
    # ------------------------------------------------------------------

    async def handle_ar_lidar(self, msg: PointCloud2) -> None:
        self._status.mark_lidar()
        self._status.refresh()
        self._telemetry.publish_lidar(msg)

    async def handle_ar_odom(self, msg: PoseStamped) -> None:
        self._odom.update(msg)
        self._status.mark_odom()
        self._status.refresh()
        self._telemetry.publish_pose(msg)

    async def handle_ar_odometry(self, msg: Odometry) -> None:
        await self.handle_ar_odom(_pose_stamped_from_odometry(msg))

    async def handle_ar_path(self, msg: Path) -> None:
        self._nav.on_path(msg)

    async def handle_ar_global_costmap(self, msg: OccupancyGrid) -> None:
        del msg  # costmap no longer consumed by AR bridge

    async def handle_ar_goal_reached(self, msg: Bool) -> None:
        self._nav.on_goal_reached(msg)

    async def handle_ar_navigation_state(self, msg: String) -> None:
        self._nav.on_navigation_state(msg.data)

    # ------------------------------------------------------------------
    # Status / runtime-sync helpers
    # ------------------------------------------------------------------

    def _send_runtime_sync_to(self, websocket: ServerConnection) -> None:
        """Resend authoritative bridge + nav lifecycle state after connect or get_status."""
        path = self._nav.runtime_snapshot_path()
        self._sender.send_to(
            websocket,
            encode_runtime_snapshot(
                robot_id=self._robot_id,
                bridge=self._status.merged_bridge_snapshot(),
                nav=self._nav.nav_phase_dict(),
                path=path,
            ),
        )

    def _send_status_to(self, websocket: ServerConnection) -> None:
        self._send_runtime_sync_to(websocket)

    def _on_get_status(self, _msg: GetStatusMessage, websocket: ServerConnection) -> None:
        self._send_status_to(websocket)

    def _on_set_lidar_mode(
        self,
        msg: SetLidarModeMessage,
        _websocket: ServerConnection,
    ) -> None:
        self._telemetry.apply_set_lidar_mode(msg)

    # ------------------------------------------------------------------
    # Disconnect handler
    # ------------------------------------------------------------------

    def _route_nav_goal_message(self, msg: NavGoalMessage) -> None:
        self._nav.on_navigate_goal(msg)

    def _on_joystick_command(self, msg: JoystickCommandMessage) -> None:
        self._motion_router.send_joystick_command(msg.vx, msg.vy, msg.wz)

    def _on_client_disconnect(self, _websocket: ServerConnection) -> None:
        remaining = self._ws_server.connection_count
        if remaining == 0:
            self._safety.on_client_disconnect()
            logger.info("dimos-ar bridge last client disconnected lidar_mode_reset=true")
            self._telemetry.reset_lidar_mode()
        else:
            logger.info("AR client disconnected", remaining_connections=remaining)
