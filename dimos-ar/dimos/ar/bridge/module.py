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

from dimos.ar.adapters.base import ARRobotAdapterSpec
from dimos.ar.bridge.calibration_session import CalibrationSessionController
from dimos.ar.bridge.navigation import NavController
from dimos.ar.bridge.odom_buffer import OdomBuffer
from dimos.ar.bridge.pose_refinement import RegisteredPoseRefiner
from dimos.ar.bridge.preview import PreviewService
from dimos.ar.bridge.sender import BridgeSender
from dimos.ar.bridge.status_service import StatusService
from dimos.ar.bridge.telemetry import TelemetryPublisher
from dimos.ar.network.protocol import EmergencyStopMessage, SetLidarModeMessage
from dimos.ar.network.websocket_server import ARWebSocketServer
from dimos.ar.preview_planner import PreviewPlanner
from dimos.ar.tracking.filters import LidarFilter, LidarFilterConfig, lidar_height_band_m
from dimos.ar.tracking.robot_tag_tracker import RobotAprilTagTracker, RobotAprilTagTrackerConfig
from dimos.ar.tracking.transforms import Calibration
from dimos.core.core import rpc
from dimos.core.global_config import global_config
from dimos.core.module import Module, ModuleConfig
from dimos.core.stream import In
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.nav_msgs.OccupancyGrid import OccupancyGrid
from dimos.msgs.nav_msgs.Odometry import Odometry
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
    min_height_m: float | None = -0.35
    max_height_m: float | None = 1.2
    obstacle_height_threshold_m: float = 0.08
    target_points: int = 1000
    obstacle_target_points: int = 200
    lidar_binary: bool = True
    lidar_max_hz: float = 1.0
    # Voxel grid size for coarse LiDAR downsampling before the height-band filter.
    # The DimOS default is 0.025 m; 0.05 m is chosen deliberately for XR payload budget.
    lidar_voxel_size_m: float = 0.05
    pose_max_hz: float = 30.0
    stream_stale_timeout_s: float = 10.0
    manual_alignment_quality: float = 0.35
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
    ar_odometry: In[Odometry]
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
    _alignment: CalibrationSessionController
    _nav: NavController
    _preview: PreviewService
    _telemetry: TelemetryPublisher
    _ws_server: ARWebSocketServer

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        # Adapter-independent shared objects created eagerly.
        self._calibration = Calibration()
        self._preview_planner = PreviewPlanner(global_config)

    @rpc
    def build(self) -> None:
        # Runs after the coordinator wires self._adapter (set_module_ref).
        super().build()

        robot_id = self._adapter.robot_id()
        handshake = self._adapter.handshake_payload()
        runtime_profile = self._adapter.runtime_alignment_profile()

        # Build LidarFilter with adapter-derived height bounds.
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
        pose_refiner = RegisteredPoseRefiner(
            robot_id=robot_id,
            sender=sender,
            calibration=self._calibration,
            odom=odom,
            tag_tracker=tag_tracker,
            runtime_profile=runtime_profile,
            runtime_correction_enabled=self.config.runtime_correction_enabled,
        )
        alignment = CalibrationSessionController(
            robot_id=robot_id,
            sender=sender,
            calibration=self._calibration,
            odom=odom,
            status=status,
            tag_tracker=tag_tracker,
            frame_max_age_s=self.config.frame_max_age_s,
            manual_alignment_quality=self.config.manual_alignment_quality,
            tf_publish_static=self.tf.publish_static,
            pose_refiner=pose_refiner,
            adapter=self._adapter,
            runtime_profile=runtime_profile,
        )

        nav = NavController(
            robot_id=robot_id,
            sender=sender,
            calibration=self._calibration,
            adapter=self._adapter,
        )

        preview = PreviewService(
            robot_id=robot_id,
            sender=sender,
            calibration=self._calibration,
            odom=odom,
            planner=self._preview_planner,
        )

        telemetry = TelemetryPublisher(
            robot_id=robot_id,
            sender=sender,
            calibration=self._calibration,
            odom=odom,
            lidar_filter=lidar_filter,
            target_points=self.config.target_points,
            obstacle_target_points=self.config.obstacle_target_points,
            lidar_voxel_size_m=self.config.lidar_voxel_size_m,
            pose_max_hz=self.config.pose_max_hz,
            lidar_binary=self.config.lidar_binary,
            speed_horizon_s=runtime_profile.runtime_speed_horizon_s,
        )

        assert self._loop is not None, "build() called before Module loop is assigned"

        def _on_emergency_stop(msg: EmergencyStopMessage) -> None:
            nav.on_emergency_stop(msg.ts)
            alignment.on_emergency_stop()

        ws_server = ARWebSocketServer(
            port=self.config.port,
            hello_supplier=self._adapter.handshake_payload,
            max_message_bytes=self.config.max_message_bytes,
            loop=self._loop,
            on_align_start=alignment.on_align_start,
            on_align_stop=alignment.on_align_stop,
            on_align_commit=alignment.on_align_commit,
            on_assist_confirm=alignment.on_assist_confirm,
            on_camera_info=alignment.on_camera_info,
            on_camera_frame=alignment.on_camera_frame,
            on_align_manual_pose=alignment.on_align_manual_pose,
            on_nav_goal=nav.on_nav_goal,
            on_plan_path=preview.on_plan_path,
            on_cancel_goal=lambda msg: nav.on_cancel_goal(msg.ts),
            on_emergency_stop=_on_emergency_stop,
            on_get_status=self._on_get_status,
            on_set_lidar_mode=self._on_set_lidar_mode,
            on_status_connect=self._send_status_to,
            on_disconnect=self._on_client_disconnect,
        )
        sender.bind(ws_server)

        self._sender = sender
        self._odom = odom
        self._status = status
        self._alignment = alignment
        self._nav = nav
        self._preview = preview
        self._telemetry = telemetry
        self._ws_server = ws_server

    @rpc
    def start(self) -> None:
        super().start()
        self._preview.start()
        self._nav.start()
        self._ws_server.start()
        self._status.start()
        host = global_config.listen_host
        logger.info("ARBridge started", websocket=f"ws://{host}:{self.config.port}")
        self._status.broadcast()

    @rpc
    def stop(self) -> None:
        nav = getattr(self, "_nav", None)
        if nav is not None:
            nav.stop()
        alignment = getattr(self, "_alignment", None)
        if alignment is not None:
            alignment.stop()
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

    async def handle_ar_odometry(self, msg: Odometry) -> None:
        self._odom.update(msg)
        self._status.mark_odom()
        self._status.refresh()
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
        self._telemetry.publish_pose(pose)

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
        self._sender.send_to(websocket, self._status.status_payload())
        self._sender.send_to(websocket, self._nav.nav_status_payload())
        last_path = self._nav.last_executing_path_payload
        if last_path is not None:
            self._sender.send_to(websocket, last_path)

    def _send_status_to(self, websocket: ServerConnection) -> None:
        self._send_runtime_sync_to(websocket)

    def _on_get_status(self, _msg: GetStatusMessage, websocket: ServerConnection) -> None:
        self._send_status_to(websocket)

    def _on_set_lidar_mode(
        self,
        msg: SetLidarModeMessage,
        _websocket: ServerConnection,
    ) -> None:
        self._telemetry.set_lidar_mode(
            mode=msg.mode,
            obstacle_min_distance_m=msg.obstacle_min_distance_m,
            obstacle_opaque_distance_m=msg.obstacle_opaque_distance_m,
            obstacle_max_distance_m=msg.obstacle_max_distance_m,
        )

    # ------------------------------------------------------------------
    # Disconnect handler
    # ------------------------------------------------------------------

    def _on_client_disconnect(self, _websocket: ServerConnection) -> None:
        self._nav.reset_on_disconnect()
        self._alignment.clear_on_disconnect()
        if self._ws_server.connection_count == 0:
            self._telemetry.reset_lidar_mode()
