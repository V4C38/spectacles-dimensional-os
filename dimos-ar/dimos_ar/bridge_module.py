from __future__ import annotations

import threading
import time
from typing import Any

from dimos.core.core import rpc
from dimos.core.global_config import global_config
from dimos.core.module import Module, ModuleConfig
from dimos.core.stream import In
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.sensor_msgs.CameraInfo import CameraInfo
from dimos.msgs.sensor_msgs.Image import Image
from dimos.msgs.sensor_msgs.PointCloud2 import PointCloud2
from dimos.utils.logging_config import setup_logger
from websockets.asyncio.server import ServerConnection

from dimos_ar.alignment import (
    AprilTagAligner,
    DEFAULT_CAMERA_ORIENTATION,
    DEFAULT_CAMERA_POSITION,
    DEFAULT_MARKER_LENGTH_M,
    DEFAULT_TIMESTAMP_TOLERANCE_S,
    AlignmentResult,
)
from dimos_ar.bridge_status import get_bridge_status_tracker
from dimos_ar.filters import LidarFilter, LidarFilterConfig, RateLimiter
from dimos_ar.protocol import (
    DEFAULT_CAPABILITIES,
    AlignCommitMessage,
    AlignMarkerMessage,
    AlignStartMessage,
    AlignStopMessage,
    GetStatusMessage,
    RegisterMessage,
    encode_align_status,
    encode_bridge_status,
    encode_lidar,
    encode_pose,
    encode_registered,
)
from dimos_ar.transforms import Calibration, OdomSample
from dimos_ar.websocket_server import ARWebSocketServer

logger = setup_logger()

# Spectacles sends align_marker ~every 200ms while tracking; treat as lost shortly after.
SPECTACLES_MARKER_TIMEOUT_S = 0.5
# Broadcast alignment status and retry attempts; must be <= robot detection timeout.
ALIGN_STATUS_BROADCAST_INTERVAL_S = 0.3
LIDAR_PAYLOAD_LOG_INTERVAL_S = 5.0
STREAM_STATUS_POLL_INTERVAL_S = 0.5


class ARBridgeConfig(ModuleConfig):
    port: int = 8765
    robot_id: str = "go2"
    max_message_bytes: int = 1_048_576
    max_range_m: float | None = 4.0
    min_height_m: float | None = -0.35
    max_height_m: float | None = 1.2
    obstacle_height_threshold_m: float = 0.08
    target_points: int = 1600
    lidar_max_hz: float = 1.0
    pose_max_hz: float = 20.0
    stream_stale_timeout_s: float = 10.0
    align_timestamp_tolerance_s: float = DEFAULT_TIMESTAMP_TOLERANCE_S
    marker_length_m: float = DEFAULT_MARKER_LENGTH_M
    camera_position: tuple[float, float, float] = DEFAULT_CAMERA_POSITION
    camera_orientation: tuple[float, float, float, float] = DEFAULT_CAMERA_ORIENTATION


class ARBridge(Module):
    lidar: In[PointCloud2]
    odom: In[PoseStamped]
    color_image: In[Image]
    camera_info: In[CameraInfo]

    config: ARBridgeConfig

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        filter_config = LidarFilterConfig(
            max_range_m=self.config.max_range_m,
            min_height_m=self.config.min_height_m,
            max_height_m=self.config.max_height_m,
            obstacle_height_threshold_m=self.config.obstacle_height_threshold_m,
            target_points=self.config.target_points,
            max_hz=self.config.lidar_max_hz,
            color_by_distance=False,
            color_by_height_class=True,
        )
        self._lidar_filter = LidarFilter(filter_config)
        self._pose_limiter = RateLimiter(self.config.pose_max_hz)
        self._calibration = Calibration()
        self._aligner = AprilTagAligner(
            marker_length_m=self.config.marker_length_m,
            timestamp_tolerance_s=self.config.align_timestamp_tolerance_s,
            camera_position=self.config.camera_position,
            camera_orientation=self.config.camera_orientation,
        )
        self._odom_lock = threading.Lock()
        self._latest_odom: OdomSample | None = None
        self._last_spectacles_marker_mono: float | None = None
        self._last_align_marker: AlignMarkerMessage | None = None
        self._last_align_marker_mono: float | None = None
        self._best_alignment: AlignmentResult | None = None
        self._best_alignment_ts: float | None = None
        self._latest_alignment_quality: float | None = None
        self._candidate_count = 0
        self._align_broadcast_stop = threading.Event()
        self._align_broadcast_thread: threading.Thread | None = None
        self._logged_align_video = False
        self._last_lidar_payload_log_mono = 0.0
        self._last_lidar_mono: float | None = None
        self._last_odom_mono: float | None = None
        self._stream_status_stop = threading.Event()
        self._stream_status_thread: threading.Thread | None = None
        tracker = get_bridge_status_tracker()
        if tracker is not None:
            tracker.set_on_change(self._broadcast_status)
        self._status_tracker = tracker
        self._ws_server = ARWebSocketServer(
            port=self.config.port,
            capabilities=DEFAULT_CAPABILITIES,
            robot_id=self.config.robot_id,
            max_message_bytes=self.config.max_message_bytes,
            on_register=self._on_register,
            on_align_start=self._on_align_start,
            on_align_stop=self._on_align_stop,
            on_align_commit=self._on_align_commit,
            on_align_marker=self._on_align_marker,
            on_get_status=self._on_get_status,
            on_status_connect=self._send_status_to,
        )

    @rpc
    def start(self) -> None:
        super().start()
        self._ws_server.start()
        self._start_stream_status_monitor()
        host = global_config.listen_host
        logger.info(
            "ARBridge started",
            websocket=f"ws://{host}:{self.config.port}",
        )
        self._broadcast_status()

    @rpc
    def stop(self) -> None:
        self._aligner.active = False
        self._stop_align_status_broadcast()
        self._stop_stream_status_monitor()
        self._ws_server.stop()
        logger.info("ARBridge stopping")
        super().stop()

    def _sample_odom(self, msg: PoseStamped) -> OdomSample:
        return OdomSample(
            position=(msg.x, msg.y, msg.z),
            orientation=(
                msg.orientation.x,
                msg.orientation.y,
                msg.orientation.z,
                msg.orientation.w,
            ),
        )

    def _update_latest_odom(self, msg: PoseStamped) -> None:
        with self._odom_lock:
            self._latest_odom = self._sample_odom(msg)

    def _get_latest_odom(self) -> OdomSample | None:
        with self._odom_lock:
            return self._latest_odom

    def _status_payload(self) -> str | None:
        if self._status_tracker is None:
            return None
        return encode_bridge_status(self._status_tracker.snapshot())

    def _send_status_to(self, websocket: ServerConnection) -> None:
        payload = self._status_payload()
        if payload is not None:
            self._ws_server.schedule_send_to(websocket, payload)

    def _broadcast_status(self) -> None:
        payload = self._status_payload()
        if payload is not None:
            self._ws_server.schedule_send(payload)

    def _refresh_streams_active(self) -> None:
        if self._status_tracker is None:
            return
        if self._last_lidar_mono is None or self._last_odom_mono is None:
            self._status_tracker.set_streams_active(False)
            return
        stale_for = time.monotonic() - min(self._last_lidar_mono, self._last_odom_mono)
        self._status_tracker.set_streams_active(
            stale_for < self.config.stream_stale_timeout_s
        )

    def _start_stream_status_monitor(self) -> None:
        self._stop_stream_status_monitor()
        self._stream_status_stop.clear()

        def loop() -> None:
            while not self._stream_status_stop.wait(STREAM_STATUS_POLL_INTERVAL_S):
                self._refresh_streams_active()

        self._stream_status_thread = threading.Thread(
            target=loop,
            name="ar-stream-status",
            daemon=True,
        )
        self._stream_status_thread.start()

    def _stop_stream_status_monitor(self) -> None:
        self._stream_status_stop.set()
        if self._stream_status_thread is not None and self._stream_status_thread.is_alive():
            self._stream_status_thread.join(timeout=1.0)
        self._stream_status_thread = None

    def _on_get_status(self, msg: GetStatusMessage, websocket: ServerConnection) -> None:
        self._send_status_to(websocket)

    def _spectacles_marker_detected(self) -> bool:
        if self._last_spectacles_marker_mono is None:
            return False
        return (
            time.monotonic() - self._last_spectacles_marker_mono
            <= SPECTACLES_MARKER_TIMEOUT_S
        )

    def _align_status_message(self) -> str:
        spec = self._spectacles_marker_detected()
        robot = self._aligner.robot_marker_detected
        if self._best_alignment is not None:
            best = round(self._best_alignment.quality * 100)
            return f"Tracking marker — best alignment {best}% ready"
        if spec and robot:
            return "Both see marker — aligning…"
        if spec:
            return "Spectacles sees marker — point phone at Go2 front camera"
        if robot:
            return "Robot sees marker — show marker to Spectacles"
        stats = self._aligner.debug_stats()
        if stats.frames == 0:
            return "Waiting for robot video frames…"
        if stats.no_camera_info > 0 and stats.detected == 0:
            return "Waiting for robot camera calibration…"
        return "Searching for marker on both devices…"

    def _start_align_status_broadcast(self) -> None:
        self._stop_align_status_broadcast()
        self._align_broadcast_stop.clear()

        def loop() -> None:
            while not self._align_broadcast_stop.wait(ALIGN_STATUS_BROADCAST_INTERVAL_S):
                if not self._aligner.active:
                    break
                self._broadcast_align_status()
                self._try_align_from_last_marker()

        self._align_broadcast_thread = threading.Thread(
            target=loop,
            name="ar-align-status",
            daemon=True,
        )
        self._align_broadcast_thread.start()

    def _stop_align_status_broadcast(self) -> None:
        self._align_broadcast_stop.set()
        thread = self._align_broadcast_thread
        if (
            thread is not None
            and thread.is_alive()
            and thread is not threading.current_thread()
        ):
            thread.join(timeout=1.0)
        self._align_broadcast_thread = None

    def _try_align_from_last_marker(self) -> None:
        """Retry alignment while both sides currently see the board."""
        if not self._spectacles_marker_detected() or not self._aligner.robot_marker_detected:
            return
        msg = self._last_align_marker
        marker_mono = self._last_align_marker_mono
        if msg is None or marker_mono is None:
            return
        odom = self._get_latest_odom()
        if odom is None:
            return
        self._process_alignment_candidate(msg, odom, received_ts=marker_mono)

    def _clear_align_session(self) -> None:
        self._last_spectacles_marker_mono = None
        self._last_align_marker = None
        self._last_align_marker_mono = None
        self._best_alignment = None
        self._best_alignment_ts = None
        self._latest_alignment_quality = None
        self._candidate_count = 0

    def _process_alignment_candidate(
        self,
        msg: AlignMarkerMessage,
        odom: OdomSample,
        *,
        received_ts: float | None = None,
    ) -> AlignmentResult | None:
        result = self._aligner.try_align(
            msg.marker_position,
            msg.marker_orientation,
            odom,
            received_ts=received_ts,
        )
        if result is None:
            return None
        self._latest_alignment_quality = result.quality
        self._candidate_count += 1
        improved = False
        if self._best_alignment is None or result.quality > self._best_alignment.quality:
            self._best_alignment = result
            self._best_alignment_ts = msg.ts
            improved = True
            logger.info(
                "AprilTag alignment improved",
                quality=round(result.quality, 3),
                reproj_px=round(result.reprojection_error_px, 2),
                samples=self._candidate_count,
            )
        self._broadcast_align_status(
            state="detecting",
            robot_marker_detected=True,
            spectacles_marker_detected=True,
            quality=result.quality,
            best_quality=self._best_alignment.quality if self._best_alignment is not None else None,
            has_candidate=self._best_alignment is not None,
            candidate_count=self._candidate_count,
            message=(
                "Alignment improved — hold steady for best result"
                if improved
                else "Tracking marker — refining best alignment"
            ),
            ts=msg.ts,
        )
        return result

    def _finish_alignment(self, result: AlignmentResult, ts: float | None) -> None:
        self._aligner.active = False
        self._stop_align_status_broadcast()
        self._calibration.register_from_alignment(result.T_world_odom)
        if self._status_tracker is not None:
            self._status_tracker.set_registered(True)
        candidate_count = self._candidate_count
        logger.info(
            "AprilTag alignment succeeded",
            quality=round(result.quality, 3),
            reproj_px=round(result.reprojection_error_px, 2),
            samples=candidate_count,
        )
        self._clear_align_session()
        self._broadcast_align_status(
            state="aligned",
            robot_marker_detected=True,
            spectacles_marker_detected=True,
            quality=result.quality,
            best_quality=result.quality,
            has_candidate=True,
            candidate_count=candidate_count,
            message="Alignment successful",
            ts=ts,
        )

    def _broadcast_align_status(
        self,
        *,
        state: str = "detecting",
        robot_marker_detected: bool | None = None,
        spectacles_marker_detected: bool | None = None,
        quality: float | None = None,
        best_quality: float | None = None,
        has_candidate: bool | None = None,
        candidate_count: int | None = None,
        message: str = "",
        ts: float | None = None,
    ) -> None:
        if robot_marker_detected is None:
            robot_marker_detected = self._aligner.robot_marker_detected
        if spectacles_marker_detected is None:
            spectacles_marker_detected = self._spectacles_marker_detected()
        if best_quality is None and self._best_alignment is not None:
            best_quality = self._best_alignment.quality
        if has_candidate is None:
            has_candidate = self._best_alignment is not None
        if candidate_count is None and self._candidate_count > 0:
            candidate_count = self._candidate_count
        if not message and state == "detecting":
            message = self._align_status_message()
        payload = encode_align_status(
            ts=ts,
            robot_id=self.config.robot_id,
            state=state,
            robot_marker_detected=robot_marker_detected,
            spectacles_marker_detected=spectacles_marker_detected,
            quality=quality,
            best_quality=best_quality,
            has_candidate=has_candidate,
            candidate_count=candidate_count,
            message=message,
        )
        self._ws_server.schedule_send(payload)

    def _on_align_start(self, msg: AlignStartMessage, _websocket: ServerConnection) -> None:
        self._aligner.active = True
        self._clear_align_session()
        self._logged_align_video = False
        logger.info("AprilTag alignment started (continuous preview until client commits)")
        self._broadcast_align_status(
            state="detecting",
            robot_marker_detected=False,
            spectacles_marker_detected=False,
            has_candidate=False,
            message="Searching for calibration marker",
            ts=msg.ts,
        )
        self._start_align_status_broadcast()

    def _on_align_stop(self, msg: AlignStopMessage, _websocket: ServerConnection) -> None:
        was_active = (
            self._aligner.active
            or self._last_align_marker is not None
            or self._best_alignment is not None
            or self._candidate_count > 0
        )
        self._aligner.active = False
        self._stop_align_status_broadcast()
        self._clear_align_session()
        if not was_active:
            return
        logger.info("AprilTag alignment stopped")
        self._broadcast_align_status(
            state="detecting",
            robot_marker_detected=False,
            spectacles_marker_detected=False,
            has_candidate=False,
            message="Alignment cancelled",
            ts=msg.ts,
        )

    def _on_align_commit(self, msg: AlignCommitMessage, _websocket: ServerConnection) -> None:
        best = self._best_alignment
        if best is None:
            self._broadcast_align_status(
                state="failed",
                robot_marker_detected=self._aligner.robot_marker_detected,
                spectacles_marker_detected=self._spectacles_marker_detected(),
                quality=self._latest_alignment_quality,
                best_quality=None,
                has_candidate=False,
                candidate_count=self._candidate_count,
                message="No valid alignment candidate yet",
                ts=msg.ts,
            )
            return
        self._finish_alignment(best, self._best_alignment_ts if self._best_alignment_ts is not None else msg.ts)

    def _on_align_marker(self, msg: AlignMarkerMessage, websocket: ServerConnection) -> None:
        if not self._aligner.active:
            return

        marker_mono = time.monotonic()
        self._last_spectacles_marker_mono = marker_mono
        self._last_align_marker = msg
        self._last_align_marker_mono = marker_mono
        odom = self._get_latest_odom()
        if odom is None:
            self._broadcast_align_status(
                state="detecting",
                spectacles_marker_detected=True,
                quality=self._latest_alignment_quality,
                has_candidate=self._best_alignment is not None,
                message="Waiting for robot odometry",
                ts=msg.ts,
            )
            return

        self._process_alignment_candidate(msg, odom, received_ts=marker_mono)

    def _on_register(self, msg: RegisterMessage, websocket: ServerConnection) -> None:
        odom = self._get_latest_odom()
        robot_id = self.config.robot_id
        if odom is None:
            logger.warning("register received before any odom sample")
            self._ws_server.schedule_send_to(
                websocket,
                encode_registered(registered=False, ts=msg.ts, robot_id=robot_id),
            )
            return
        self._calibration.register(msg, odom)
        if self._status_tracker is not None:
            self._status_tracker.set_registered(True)
        logger.info("AR calibration registered", marker_id=msg.marker_id)
        self._ws_server.schedule_send_to(
            websocket,
            encode_registered(registered=True, ts=msg.ts, robot_id=robot_id),
        )

    async def handle_camera_info(self, msg: CameraInfo) -> None:
        self._aligner.set_camera_info(msg)

    async def handle_color_image(self, msg: Image) -> None:
        if not self._aligner.active:
            return
        if not self._logged_align_video:
            self._logged_align_video = True
            logger.info("AprilTag: robot video frames reaching bridge (OpenCV detection running)")
        self._aligner.process_frame(msg)

    async def handle_lidar(self, msg: PointCloud2) -> None:
        self._last_lidar_mono = time.monotonic()
        self._refresh_streams_active()
        if not self._lidar_filter.rate_limiter.allow():
            return
        points = msg.points_f32()
        if points.size == 0:
            return
        filtered, colors = self._lidar_filter.filter(points)
        if len(filtered) == 0:
            return
        world_pts = self._calibration.transform_points(filtered)
        payload = encode_lidar(
            ts=msg.ts,
            points=world_pts,
            colors=colors,
            robot_id=self.config.robot_id,
        )
        self._maybe_log_lidar_payload(len(filtered), len(payload))
        self._ws_server.schedule_send(payload)

    def _maybe_log_lidar_payload(self, point_count: int, payload_bytes: int) -> None:
        now = time.monotonic()
        if now - self._last_lidar_payload_log_mono < LIDAR_PAYLOAD_LOG_INTERVAL_S:
            return
        self._last_lidar_payload_log_mono = now
        logger.info(
            "LiDAR payload",
            points=point_count,
            bytes=payload_bytes,
            hz=self.config.lidar_max_hz,
        )

    async def handle_odom(self, msg: PoseStamped) -> None:
        self._update_latest_odom(msg)
        self._last_odom_mono = time.monotonic()
        self._refresh_streams_active()
        if not self._pose_limiter.allow():
            return
        pos, quat = self._calibration.transform_pose(
            (msg.x, msg.y, msg.z),
            (
                msg.orientation.x,
                msg.orientation.y,
                msg.orientation.z,
                msg.orientation.w,
            ),
        )
        payload = encode_pose(
            ts=msg.ts,
            position=pos,
            orientation=quat,
            robot_id=self.config.robot_id,
        )
        self._ws_server.schedule_send(payload)
