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

from typing import TYPE_CHECKING, Any

from dimos_lcm.std_msgs import Bool, String

from dimos.ar.adapters.base import (
    ARRobotAdapterSpec,
    RobotHandshake,
    resolve_baseline_motion_recipe,
)
from dimos.ar.bridge.adapter_command_queue import AdapterCommandQueue
from dimos.ar.bridge.odom_buffer import OdomBuffer
from dimos.ar.navigation.navigate import NavigateGoalHandler
from dimos.ar.navigation.preview import PreviewGoalHandler
from dimos.ar.bridge.safety import BridgeSafetyCoordinator
from dimos.ar.bridge.sender import BridgeSender
from dimos.ar.bridge.status_service import StatusService
from dimos.ar.bridge.telemetry import TelemetryPublisher
from dimos.ar.network.protocol import (
    NavGoalMessage,
    SetLidarModeMessage,
    encode_runtime_snapshot,
)
from dimos.ar.network.websocket_server import ARWebSocketServer
from dimos.ar.preview_planner import PreviewPlanner
from dimos.ar.registration.session import RegistrationSession
from dimos.ar.tag_tracking.tracker import RobotAprilTagTracker, RobotAprilTagTrackerConfig
from dimos.ar.world_frame.refinement import WorldFrameRefiner
from dimos.ar.world_frame.registry import WorldRegistry
from dimos.ar.world_frame.state import WorldFrameState
from dimos.ar.lidar.filters import LidarFilter, LidarFilterConfig, lidar_height_band_m
from dimos.ar.utils.console import console_divider
from dimos.core.core import rpc
from dimos.core.global_config import global_config
from dimos.core.module import Module, ModuleConfig
from dimos.core.stream import In
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.nav_msgs.OccupancyGrid import OccupancyGrid
from dimos.msgs.nav_msgs.Path import Path
from dimos.msgs.sensor_msgs.PointCloud2 import PointCloud2
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from websockets.asyncio.server import ServerConnection

    from dimos.ar.network.protocol import GetStatusMessage

logger = setup_logger()


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
    # The DimOS default is 0.025 m; 0.05 m is chosen deliberately for XR payload budget.
    lidar_voxel_size_m: float = 0.05
    pose_max_hz: float = 30.0
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


class ARBridge(Module):  # type: ignore[misc]
    ar_lidar: In[PointCloud2]
    ar_odom: In[PoseStamped]
    ar_global_costmap: In[OccupancyGrid]
    ar_path: In[Path]
    ar_goal_reached: In[Bool]
    ar_navigation_state: In[String]

    config: ARBridgeConfig
    _adapter: ARRobotAdapterSpec

    # Collaborators (set in build())
    _sender: BridgeSender
    _odom: OdomBuffer
    _status: StatusService
    _registration: RegistrationSession
    _nav: NavigateGoalHandler
    _command_queue: AdapterCommandQueue
    _preview: PreviewGoalHandler
    _telemetry: TelemetryPublisher
    _ws_server: ARWebSocketServer
    _robot_id: str
    _connect_handshake: RobotHandshake

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        # Adapter-independent shared objects created eagerly.
        self._world_frame = WorldFrameState()
        self._preview_planner = PreviewPlanner(global_config)

    @rpc
    def build(self) -> None:
        # Runs after the coordinator wires self._adapter (set_module_ref).
        super().build()

        robot_id = self._adapter.robot_id()
        self._robot_id = robot_id
        handshake = self._adapter.handshake_payload()
        self._connect_handshake = handshake
        runtime_profile = self._adapter.runtime_tag_tracking_profile()

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
            max_distance_m=self.config.tag_max_distance_m,
            min_baseline_m=self.config.tag_min_baseline_m,
            window_max_obs=self.config.tag_window_max_obs,
            window_max_age_s=self.config.tag_window_max_age_s,
            max_mount_residual_m=self.config.tag_max_mount_residual_m,
            max_up_axis_tilt_deg=self.config.tag_max_up_axis_tilt_deg,
        )
        tag_tracker = RobotAprilTagTracker(
            self._adapter.tag_mounts(),
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
        registry = WorldRegistry(self._world_frame, self.tf.publish_static)
        world_frame_refiner = WorldFrameRefiner(
            registry=registry,
            telemetry=telemetry,
            robot_id=robot_id,
            sender=sender,
            odom=odom,
            tag_tracker=tag_tracker,
            runtime_profile=runtime_profile,
            runtime_correction_enabled=self.config.runtime_correction_enabled,
        )
        registry.attach_refiner(world_frame_refiner)
        baseline_cap = handshake.capability_states.get("registration_april_odom_baseline")
        baseline_motion_available = (
            baseline_cap.available if baseline_cap is not None else False
        )
        assert self._loop is not None, "build() called before Module loop is assigned"
        baseline_motion_recipe = resolve_baseline_motion_recipe(self._adapter)
        command_queue = AdapterCommandQueue(self._adapter)
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
            adapter=self._adapter,
            command_queue=command_queue,
            runtime_profile=runtime_profile,
            baseline_motion_available=baseline_motion_available,
            baseline_motion_recipe=baseline_motion_recipe,
        )

        nav = NavigateGoalHandler(
            robot_id=robot_id,
            sender=sender,
            world_frame=self._world_frame,
            command_queue=command_queue,
        )

        preview = PreviewGoalHandler(
            robot_id=robot_id,
            sender=sender,
            world_frame=self._world_frame,
            odom=odom,
            planner=self._preview_planner,
        )

        safety = BridgeSafetyCoordinator(
            nav=nav,
            registration=registration,
            command_queue=command_queue,
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
        self._command_queue = command_queue
        self._safety = safety
        self._preview = preview
        self._telemetry = telemetry
        self._ws_server = ws_server

    def _connect_hello(self) -> RobotHandshake:
        """Return the handshake cached at build() — must not RPC from the WS loop."""
        return self._connect_handshake

    @rpc
    def start(self) -> None:
        super().start()
        self._ws_server.start()
        self._status.start()
        self._preview.start()
        self._nav.start()
        host = global_config.listen_host
        logger.info("ARBridge started", websocket=f"ws://{host}:{self.config.port}")
        console_divider(f"Bridge ready — ws://{host}:{self.config.port}")
        self._status.broadcast()

    @rpc
    def stop(self) -> None:
        nav = getattr(self, "_nav", None)
        if nav is not None:
            nav.stop()
        registration = getattr(self, "_registration", None)
        if registration is not None:
            registration.stop()
        command_queue = getattr(self, "_command_queue", None)
        if command_queue is not None:
            command_queue.shutdown()
        status = getattr(self, "_status", None)
        if status is not None:
            status.stop()
        preview = getattr(self, "_preview", None)
        if preview is not None:
            preview.stop()
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

    async def handle_ar_path(self, msg: Path) -> None:
        self._nav.on_path(msg)

    async def handle_ar_global_costmap(self, msg: OccupancyGrid) -> None:
        self._preview.update_costmap(msg)

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
        if msg.intent == "navigate":
            self._nav.on_navigate_goal(msg)
        else:
            self._preview.on_preview_goal(msg)

    def _on_client_disconnect(self, _websocket: ServerConnection) -> None:
        remaining = self._ws_server.connection_count
        if remaining == 0:
            self._safety.on_client_disconnect()
            logger.info("XR bridge last client disconnected lidar_mode_reset=true")
            self._telemetry.reset_lidar_mode()
        else:
            logger.info("XR client disconnected", remaining_connections=remaining)
