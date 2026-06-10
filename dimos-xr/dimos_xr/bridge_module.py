from __future__ import annotations

import asyncio
import math
import threading
import time
from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
from dimos.core.core import rpc
from dimos.core.global_config import global_config
from dimos.core.module import Module, ModuleConfig
from dimos.core.stream import In
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.nav_msgs.OccupancyGrid import OccupancyGrid
from dimos.msgs.nav_msgs.Path import Path
from dimos.msgs.sensor_msgs.CameraInfo import CameraInfo
from dimos.msgs.sensor_msgs.Image import Image
from dimos.msgs.sensor_msgs.PointCloud2 import PointCloud2
from dimos.utils.logging_config import setup_logger
from dimos_lcm.std_msgs import Bool, String
from websockets.asyncio.server import ServerConnection

from dimos_xr.adapters.base import XRRobotAdapterSpec
from dimos_xr.alignment import AprilTagAligner
from dimos_xr.bridge_status import BridgeStatusTracker
from dimos_xr.error_codes import NAV_GOAL_STALLED
from dimos_xr.filters import (
    LidarFilter,
    LidarFilterConfig,
    RateLimiter,
    lidar_height_band_m,
    subsample_points_near_robot,
)
from dimos_xr.preview_planner import PreviewPlanner
from dimos_xr.protocol import (
    AlignCommitMessage,
    AlignManualPoseMessage,
    AlignMarkerMessage,
    AlignStartMessage,
    AlignStopMessage,
    CancelGoalMessage,
    EmergencyStopMessage,
    GetStatusMessage,
    NavGoalMessage,
    PlanPathMessage,
    encode_align_status,
    encode_bridge_status,
    encode_lidar,
    encode_nav_status,
    encode_path,
    encode_path_preview,
    encode_pose,
)
from dimos_xr.transforms import (
    Calibration,
    OdomSample,
    _normalize_quaternion,
    gravity_level_transform,
    normalize_ground_pose,
    pose_to_matrix,
)
from dimos_xr.websocket_server import XRWebSocketServer

logger = setup_logger()

SPECTACLES_MARKER_TIMEOUT_S = 0.5
ALIGN_STATUS_BROADCAST_INTERVAL_S = 0.3
LIDAR_PAYLOAD_LOG_INTERVAL_S = 5.0
DROPPED_POSE_LOG_INTERVAL_S = 5.0
STREAM_STATUS_POLL_INTERVAL_S = 0.5
NAV_GOAL_PATH_TIMEOUT_S = 8.0
NAV_RECOVERY_MAX_ATTEMPTS = 2
NAV_WATCHDOG_POLL_INTERVAL_S = 0.5
ALIGNMENT_CLUSTER_WINDOW = 12
ALIGNMENT_CLUSTER_MIN_SAMPLES = 8
ALIGNMENT_CLUSTER_TARGET_SAMPLES = 8
ALIGNMENT_CLUSTER_TRANSLATION_THRESHOLD_M = 0.05
ALIGNMENT_CLUSTER_YAW_THRESHOLD_RAD = math.radians(3.0)


def _wrap_angle_rad(angle: float) -> float:
    return math.atan2(math.sin(angle), math.cos(angle))


def _candidate_yaw_rad(T_world_odom: np.ndarray) -> float:
    forward = T_world_odom[:3, 0]
    return math.atan2(float(forward[2]), float(forward[0]))


def _candidate_translation_distance_m(lhs: np.ndarray, rhs: np.ndarray) -> float:
    return float(np.linalg.norm(lhs[:3, 3] - rhs[:3, 3]))


def _candidate_yaw_distance_rad(lhs: np.ndarray, rhs: np.ndarray) -> float:
    return abs(_wrap_angle_rad(_candidate_yaw_rad(lhs) - _candidate_yaw_rad(rhs)))


def _orientation_yaw_deg(
    orientation: tuple[float, float, float, float],
) -> float:
    yaw_rad = _candidate_yaw_rad(pose_to_matrix((0.0, 0.0, 0.0), orientation))
    return round(math.degrees(yaw_rad), 2)


@dataclass(frozen=True)
class AlignmentCandidate:
    T_world_odom: Any
    quality: float
    method: str
    approximate: bool
    reprojection_error_px: float | None = None
    sample_quality: float | None = None
    cluster_size: int = 1


@dataclass(frozen=True)
class PreviewPathRequest:
    ts: float
    target_world: tuple[float, float, float]


def score_alignment_cluster(
    candidate: AlignmentCandidate,
    recent_candidates: list[AlignmentCandidate],
) -> tuple[float, int, float, float]:
    cluster = [
        sample
        for sample in recent_candidates
        if _candidate_translation_distance_m(sample.T_world_odom, candidate.T_world_odom)
        <= ALIGNMENT_CLUSTER_TRANSLATION_THRESHOLD_M
        and _candidate_yaw_distance_rad(sample.T_world_odom, candidate.T_world_odom)
        <= ALIGNMENT_CLUSTER_YAW_THRESHOLD_RAD
    ]
    cluster_size = len(cluster)
    if cluster_size == 0:
        return (
            0.0,
            0,
            ALIGNMENT_CLUSTER_TRANSLATION_THRESHOLD_M,
            ALIGNMENT_CLUSTER_YAW_THRESHOLD_RAD,
        )
    mean_translation_error = sum(
        _candidate_translation_distance_m(sample.T_world_odom, candidate.T_world_odom)
        for sample in cluster
    ) / cluster_size
    mean_yaw_error = sum(
        _candidate_yaw_distance_rad(sample.T_world_odom, candidate.T_world_odom)
        for sample in cluster
    ) / cluster_size
    translation_score = max(
        0.0,
        1.0 - mean_translation_error / ALIGNMENT_CLUSTER_TRANSLATION_THRESHOLD_M,
    )
    yaw_score = max(0.0, 1.0 - mean_yaw_error / ALIGNMENT_CLUSTER_YAW_THRESHOLD_RAD)
    stability_score = min(1.0, cluster_size / ALIGNMENT_CLUSTER_MIN_SAMPLES)
    cluster_bonus = min(1.0, cluster_size / ALIGNMENT_CLUSTER_TARGET_SAMPLES)
    sample_quality = (
        candidate.sample_quality if candidate.sample_quality is not None else candidate.quality
    )
    confidence = (
        sample_quality
        * stability_score
        * (0.45 + 0.25 * translation_score + 0.15 * yaw_score + 0.15 * cluster_bonus)
    )
    return confidence, cluster_size, mean_translation_error, mean_yaw_error


def collect_alignment_cluster(
    candidate: AlignmentCandidate,
    recent_candidates: list[AlignmentCandidate],
) -> list[AlignmentCandidate]:
    return [
        sample
        for sample in recent_candidates
        if _candidate_translation_distance_m(sample.T_world_odom, candidate.T_world_odom)
        <= ALIGNMENT_CLUSTER_TRANSLATION_THRESHOLD_M
        and _candidate_yaw_distance_rad(sample.T_world_odom, candidate.T_world_odom)
        <= ALIGNMENT_CLUSTER_YAW_THRESHOLD_RAD
    ]


def _circular_mean_rad(angles: list[float]) -> float:
    if not angles:
        return 0.0
    sin_sum = sum(math.sin(angle) for angle in angles)
    cos_sum = sum(math.cos(angle) for angle in angles)
    return math.atan2(sin_sum, cos_sum)


def _matrix_from_yaw_and_translation(
    yaw_rad: float,
    translation: np.ndarray,
) -> np.ndarray:
    x_axis = np.array(
        [math.cos(yaw_rad), 0.0, math.sin(yaw_rad)],
        dtype=np.float64,
    )
    z_axis = np.array([0.0, 1.0, 0.0], dtype=np.float64)
    y_axis = np.cross(z_axis, x_axis)
    T = np.eye(4, dtype=np.float64)
    T[:3, 0] = x_axis
    T[:3, 1] = y_axis
    T[:3, 2] = z_axis
    T[:3, 3] = translation
    return T


def average_cluster_transform(
    cluster: list[AlignmentCandidate],
) -> tuple[np.ndarray, float, float]:
    """Average gravity-leveled cluster members; return (T, yaw_spread_rad, trans_spread_m)."""
    if not cluster:
        raise ValueError("cluster must not be empty")
    leveled = [
        gravity_level_transform(np.array(sample.T_world_odom, dtype=np.float64, copy=True))
        for sample in cluster
    ]
    yaws = [_candidate_yaw_rad(T) for T in leveled]
    translations = np.array([T[:3, 3] for T in leveled], dtype=np.float64)
    mean_yaw = _circular_mean_rad(yaws)
    mean_translation = np.mean(translations, axis=0)
    T_avg = _matrix_from_yaw_and_translation(mean_yaw, mean_translation)
    yaw_spread = (
        max(abs(_wrap_angle_rad(yaw - mean_yaw)) for yaw in yaws) if len(yaws) > 1 else 0.0
    )
    trans_spread = (
        float(np.max(np.linalg.norm(translations - mean_translation, axis=1)))
        if len(translations) > 1
        else 0.0
    )
    return T_avg, yaw_spread, trans_spread


class XRBridgeConfig(ModuleConfig):
    port: int = 8787
    max_message_bytes: int = 1_048_576
    max_range_m: float | None = None
    min_height_m: float | None = -0.35
    max_height_m: float | None = 1.2
    obstacle_height_threshold_m: float = 0.08
    target_points: int = 1000
    lidar_max_hz: float = 1.0
    pose_max_hz: float = 30.0
    stream_stale_timeout_s: float = 10.0
    manual_alignment_quality: float = 0.35


class XRBridge(Module):
    xr_lidar: In[PointCloud2]
    xr_odom: In[PoseStamped]
    xr_color_image: In[Image]
    xr_camera_info: In[CameraInfo]
    xr_global_costmap: In[OccupancyGrid]
    xr_path: In[Path]
    xr_goal_reached: In[Bool]
    xr_navigation_state: In[String]

    config: XRBridgeConfig
    _adapter: XRRobotAdapterSpec
    # Adapter-dependent objects are constructed in build(), after the coordinator
    # injects self._adapter via set_module_ref (not available during __init__).
    _aligner: AprilTagAligner
    _robot_id: str
    _status_tracker: BridgeStatusTracker
    _ws_server: XRWebSocketServer

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        filter_config = LidarFilterConfig(
            max_range_m=self.config.max_range_m,
            min_height_m=self.config.min_height_m,
            max_height_m=self.config.max_height_m,
            obstacle_height_threshold_m=self.config.obstacle_height_threshold_m,
            target_points=self.config.target_points,
            max_hz=self.config.lidar_max_hz,
        )
        self._lidar_filter = LidarFilter(filter_config)
        self._pose_limiter = RateLimiter(self.config.pose_max_hz)
        self._calibration = Calibration()
        self._preview_planner = PreviewPlanner(global_config)
        self._odom_lock = threading.Lock()
        self._latest_odom: OdomSample | None = None
        self._last_spectacles_marker_mono: float | None = None
        self._last_align_marker: AlignMarkerMessage | None = None
        self._last_align_marker_mono: float | None = None
        self._best_alignment: AlignmentCandidate | None = None
        self._best_alignment_ts: float | None = None
        self._latest_alignment_quality: float | None = None
        self._candidate_count = 0
        self._alignment_mode = "marker"
        self._recent_marker_candidates: list[AlignmentCandidate] = []
        self._align_broadcast_stop = threading.Event()
        self._align_broadcast_thread: threading.Thread | None = None
        self._logged_align_video = False
        self._color_frame_count = 0
        self._last_color_frame_mono: float | None = None
        self._last_debug_robot_detected: bool | None = None
        self._align_start_mono: float | None = None
        self._last_lidar_payload_log_mono = 0.0
        self._logged_lidar_stream_active = False
        self._last_lidar_mono: float | None = None
        self._last_odom_mono: float | None = None
        self._nav_state = "idle"
        self._goal_reached = False
        self._goal_failed = False
        self._nav_goal_pending = False
        self._nav_path_received = False
        self._nav_goal_dispatch_mono: float | None = None
        self._nav_recovery_attempts = 0
        self._nav_degraded = False
        self._nav_recovering = False
        self._nav_error_code: int | None = None
        self._nav_watchdog_stop = threading.Event()
        self._nav_watchdog_thread: threading.Thread | None = None
        self._nav_watchdog_lock = threading.Lock()
        self._last_executing_path_payload: str | None = None
        self._stream_status_stop = threading.Event()
        self._stream_status_thread: threading.Thread | None = None
        self._preview_worker_stop = threading.Event()
        self._preview_request_condition = threading.Condition()
        self._preview_request: PreviewPathRequest | None = None
        self._preview_worker_thread: threading.Thread | None = None
        self._dropped_pose_count = 0
        self._last_dropped_pose_log_mono = 0.0

    @rpc
    def build(self) -> None:
        # Runs after the coordinator wires self._adapter (set_module_ref) and
        # before start(), so this is the earliest point adapter-dependent objects
        # can be constructed.
        super().build()
        camera_alignment = self._adapter.camera_alignment_config()
        self._aligner = AprilTagAligner(
            marker_length_m=camera_alignment.marker_length_m,
            timestamp_tolerance_s=camera_alignment.timestamp_tolerance_s,
            camera_position=camera_alignment.position,
            camera_orientation=camera_alignment.orientation,
        )
        if camera_alignment.camera_info is not None:
            self._aligner.set_camera_info(camera_alignment.camera_info)
        self._robot_id = self._adapter.robot_id()
        handshake = self._adapter.handshake_payload()
        min_height_m, max_height_m = lidar_height_band_m(
            body_bounds_m=handshake.body_bounds_m,
            base_height_m=handshake.base_height_m,
        )
        self._lidar_filter.config.min_height_m = min_height_m
        self._lidar_filter.config.max_height_m = max_height_m
        self._status_tracker = BridgeStatusTracker(
            robot_id=self._robot_id,
            robot_connected=False,
        )
        self._status_tracker.set_on_change(self._broadcast_status)
        self._ws_server = XRWebSocketServer(
            port=self.config.port,
            hello_supplier=self._adapter.handshake_payload,
            max_message_bytes=self.config.max_message_bytes,
            on_align_start=self._on_align_start,
            on_align_stop=self._on_align_stop,
            on_align_commit=self._on_align_commit,
            on_align_marker=self._on_align_marker,
            on_align_manual_pose=self._on_align_manual_pose,
            on_nav_goal=self._on_nav_goal,
            on_plan_path=self._on_plan_path,
            on_cancel_goal=self._on_cancel_goal,
            on_emergency_stop=self._on_emergency_stop,
            on_get_status=self._on_get_status,
            on_status_connect=self._send_status_to,
            on_disconnect=self._on_client_disconnect,
        )

    @rpc
    def start(self) -> None:
        super().start()
        self._start_preview_worker()
        self._start_nav_watchdog()
        self._ws_server.start()
        self._start_stream_status_monitor()
        host = global_config.listen_host
        logger.info("XRBridge started", websocket=f"ws://{host}:{self.config.port}")
        self._broadcast_status()

    @rpc
    def stop(self) -> None:
        # build() may not have run if another module aborted deployment, so the
        # adapter-dependent objects can be absent during teardown.
        self._stop_nav_watchdog()
        aligner = getattr(self, "_aligner", None)
        if aligner is not None:
            aligner.active = False
        self._stop_align_status_broadcast()
        self._stop_stream_status_monitor()
        self._stop_preview_worker()
        ws_server = getattr(self, "_ws_server", None)
        if ws_server is not None:
            ws_server.stop()
        logger.info("XRBridge stopping")
        super().stop()

    def _sample_odom(self, msg: PoseStamped) -> OdomSample:
        orientation = _normalize_quaternion(
            msg.orientation.x,
            msg.orientation.y,
            msg.orientation.z,
            msg.orientation.w,
        )
        return OdomSample(
            position=(msg.x, msg.y, msg.z),
            orientation=orientation,
        )

    @staticmethod
    def _pose_components_finite(
        position: tuple[float, float, float],
        orientation: tuple[float, float, float, float],
    ) -> bool:
        return all(math.isfinite(value) for value in (*position, *orientation))

    def _update_latest_odom(self, msg: PoseStamped) -> None:
        with self._odom_lock:
            self._latest_odom = self._sample_odom(msg)

    def _get_latest_odom(self) -> OdomSample | None:
        with self._odom_lock:
            return self._latest_odom

    def _status_payload(self) -> str:
        return encode_bridge_status(self._status_tracker.snapshot())

    def _nav_status_payload(self) -> str:
        return encode_nav_status(
            state=self._nav_state,
            goal_reached=self._goal_reached,
            goal_failed=self._goal_failed,
            recovering=self._nav_recovering,
            error_code=self._nav_error_code,
            robot_id=self._robot_id,
        )

    def _send_runtime_sync_to(self, websocket: ServerConnection) -> None:
        """Resend authoritative bridge + nav lifecycle state after connect or get_status."""
        self._ws_server.schedule_send_to(websocket, self._status_payload())
        self._ws_server.schedule_send_to(websocket, self._nav_status_payload())
        if self._last_executing_path_payload is not None:
            self._ws_server.schedule_send_to(websocket, self._last_executing_path_payload)

    def _send_status_to(self, websocket: ServerConnection) -> None:
        self._send_runtime_sync_to(websocket)

    def _broadcast_status(self) -> None:
        self._ws_server.schedule_send(self._status_payload())

    def _latest_robot_world_position(self) -> tuple[float, float, float] | None:
        odom = self._get_latest_odom()
        if odom is None:
            return None
        position, _orientation = self._calibration.transform_pose(
            odom.position,
            odom.orientation,
        )
        return position

    def _refresh_streams_active(self) -> None:
        now = time.monotonic()
        lidar_fresh = (
            self._last_lidar_mono is not None
            and now - self._last_lidar_mono < self.config.stream_stale_timeout_s
        )
        odom_fresh = (
            self._last_odom_mono is not None
            and now - self._last_odom_mono < self.config.stream_stale_timeout_s
        )
        snapshot = self._status_tracker.snapshot()
        robot_connected = lidar_fresh or odom_fresh
        self._status_tracker.set_robot_connected(robot_connected)
        self._status_tracker.set_streams_active(lidar_fresh and odom_fresh)
        self._status_tracker.set_reconnecting(snapshot.robot_connected and not robot_connected)

    def _start_stream_status_monitor(self) -> None:
        self._stop_stream_status_monitor()
        self._stream_status_stop.clear()

        def loop() -> None:
            while not self._stream_status_stop.wait(STREAM_STATUS_POLL_INTERVAL_S):
                self._refresh_streams_active()

        self._stream_status_thread = threading.Thread(
            target=loop,
            name="xr-stream-status",
            daemon=True,
        )
        self._stream_status_thread.start()

    def _stop_stream_status_monitor(self) -> None:
        self._stream_status_stop.set()
        if self._stream_status_thread is not None and self._stream_status_thread.is_alive():
            self._stream_status_thread.join(timeout=1.0)
        self._stream_status_thread = None

    def _start_preview_worker(self) -> None:
        self._stop_preview_worker()
        self._preview_worker_stop.clear()

        def loop() -> None:
            while not self._preview_worker_stop.is_set():
                with self._preview_request_condition:
                    while (
                        self._preview_request is None
                        and not self._preview_worker_stop.is_set()
                    ):
                        self._preview_request_condition.wait()
                    if self._preview_worker_stop.is_set():
                        return
                    request = self._preview_request
                    self._preview_request = None
                if request is not None:
                    self._process_preview_request(request)

        self._preview_worker_thread = threading.Thread(
            target=loop,
            name="xr-preview-planner",
            daemon=True,
        )
        self._preview_worker_thread.start()

    def _stop_preview_worker(self) -> None:
        self._preview_worker_stop.set()
        with self._preview_request_condition:
            self._preview_request = None
            self._preview_request_condition.notify_all()
        thread = self._preview_worker_thread
        if thread is not None and thread.is_alive():
            thread.join(timeout=1.0)
        self._preview_worker_thread = None

    def _spectacles_marker_detected(self) -> bool:
        if self._last_spectacles_marker_mono is None:
            return False
        return time.monotonic() - self._last_spectacles_marker_mono <= SPECTACLES_MARKER_TIMEOUT_S

    def _align_status_message(self) -> str:
        if self._alignment_mode == "manual":
            if self._best_alignment is not None:
                return "Manual robot pose ready — review and commit"
            return "Place the robot pose manually, then commit"
        spec = self._spectacles_marker_detected()
        robot = self._aligner.robot_marker_detected
        if self._best_alignment is not None:
            best = round(self._best_alignment.quality * 100)
            return f"Tracking marker — best alignment {best}% ready"
        if spec and robot:
            return "Both see marker — aligning..."
        if spec:
            return "Spectacles sees marker — hold printed board toward robot camera"
        if robot:
            return "Robot sees marker — show marker to Spectacles"
        stats = self._aligner.debug_stats()
        if stats.frames == 0:
            return "Waiting for robot video frames..."
        if stats.no_camera_info > 0 and stats.detected == 0:
            return "Waiting for robot camera calibration..."
        return "Searching for marker on both devices..."

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
            name="xr-align-status",
            daemon=True,
        )
        self._align_broadcast_thread.start()

    def _stop_align_status_broadcast(self) -> None:
        self._align_broadcast_stop.set()
        thread = self._align_broadcast_thread
        if thread is not None and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=1.0)
        self._align_broadcast_thread = None

    def _clear_align_session(self) -> None:
        self._last_spectacles_marker_mono = None
        self._last_align_marker = None
        self._last_align_marker_mono = None
        self._best_alignment = None
        self._best_alignment_ts = None
        self._latest_alignment_quality = None
        self._candidate_count = 0
        self._alignment_mode = "marker"
        self._recent_marker_candidates = []

    def _on_client_disconnect(self, _websocket: ServerConnection) -> None:
        self._nav_degraded = False
        self._nav_error_code = None
        self._nav_recovering = False
        self._goal_failed = False
        self._goal_reached = False
        self._nav_state = "idle"
        self._reset_nav_goal_tracking(reset_recovery=True)
        if (
            not self._aligner.active
            and self._last_align_marker is None
            and self._best_alignment is None
            and self._candidate_count == 0
        ):
            return
        self._aligner.active = False
        self._stop_align_status_broadcast()
        self._clear_align_session()
        logger.info("Alignment session cleared on XR client disconnect")

    def _score_alignment_candidate(
        self, candidate: AlignmentCandidate
    ) -> tuple[float, int, float, float]:
        return score_alignment_cluster(candidate, self._recent_marker_candidates)

    def _try_align_from_last_marker(self) -> None:
        if self._alignment_mode != "marker":
            return
        if not self._spectacles_marker_detected() or not self._aligner.robot_marker_detected:
            return
        msg = self._last_align_marker
        if msg is None or self._last_align_marker_mono is None:
            return
        odom = self._get_latest_odom()
        if odom is None:
            return
        self._process_alignment_candidate(msg, odom, received_ts=time.monotonic())

    def _process_alignment_candidate(
        self,
        msg: AlignMarkerMessage,
        odom: OdomSample,
        *,
        received_ts: float | None = None,
    ) -> AlignmentCandidate | None:
        result = self._aligner.try_align(
            msg.marker_position,
            msg.marker_orientation,
            odom,
            received_ts=received_ts,
        )
        if result is None:
            return None
        candidate = AlignmentCandidate(
            T_world_odom=np.array(result.T_world_odom, dtype=np.float64, copy=True),
            quality=result.quality,
            method="marker",
            approximate=False,
            reprojection_error_px=result.reprojection_error_px,
            sample_quality=result.quality,
        )
        self._recent_marker_candidates.append(candidate)
        if len(self._recent_marker_candidates) > ALIGNMENT_CLUSTER_WINDOW:
            self._recent_marker_candidates = self._recent_marker_candidates[
                -ALIGNMENT_CLUSTER_WINDOW:
            ]
        stable_quality, cluster_size, mean_translation_error, mean_yaw_error = (
            self._score_alignment_candidate(candidate)
        )
        candidate = AlignmentCandidate(
            T_world_odom=candidate.T_world_odom,
            quality=stable_quality,
            method=candidate.method,
            approximate=candidate.approximate,
            reprojection_error_px=candidate.reprojection_error_px,
            sample_quality=candidate.sample_quality,
            cluster_size=cluster_size,
        )
        self._latest_alignment_quality = candidate.quality
        self._candidate_count += 1
        improved = False
        is_stable_candidate = cluster_size >= ALIGNMENT_CLUSTER_MIN_SAMPLES
        if is_stable_candidate and (
            self._best_alignment is None or candidate.quality > self._best_alignment.quality
        ):
            self._best_alignment = candidate
            self._best_alignment_ts = msg.ts
            improved = True
            logger.info(
                "AprilTag alignment improved",
                quality=round(candidate.quality, 3),
                sample_quality=round(candidate.sample_quality or 0.0, 3),
                reproj_px=round(result.reprojection_error_px, 2),
                cluster_size=cluster_size,
                mean_translation_error_m=round(mean_translation_error, 4),
                mean_yaw_error_deg=round(math.degrees(mean_yaw_error), 2),
                candidate_yaw_deg=round(
                    math.degrees(_candidate_yaw_rad(candidate.T_world_odom)),
                    2,
                ),
                samples=self._candidate_count,
            )
        self._broadcast_align_status(
            state="detecting",
            robot_marker_detected=True,
            spectacles_marker_detected=True,
            quality=candidate.quality,
            best_quality=self._best_alignment.quality if self._best_alignment is not None else None,
            has_candidate=self._best_alignment is not None,
            method="marker",
            message=(
                "Alignment improved — hold steady for best result"
                if improved
                else (
                    "Tracking marker — hold steady "
                    f"({cluster_size}/{ALIGNMENT_CLUSTER_MIN_SAMPLES})"
                    if not is_stable_candidate
                    else "Tracking marker — refining best alignment"
                )
            ),
            ts=msg.ts,
        )
        return candidate

    def _process_manual_alignment_candidate(
        self,
        msg: AlignManualPoseMessage,
        odom: OdomSample,
    ) -> AlignmentCandidate:
        norm_position, norm_orientation = normalize_ground_pose(msg.position, msg.orientation)
        T_world_base = pose_to_matrix(norm_position, norm_orientation)
        T_odom_base = pose_to_matrix(odom.position, odom.orientation)
        candidate = AlignmentCandidate(
            T_world_odom=np.array(
                T_world_base @ np.linalg.inv(T_odom_base),
                dtype=np.float64,
                copy=True,
            ),
            quality=self.config.manual_alignment_quality,
            method="manual",
            approximate=True,
            sample_quality=self.config.manual_alignment_quality,
        )
        self._alignment_mode = "manual"
        self._latest_alignment_quality = candidate.quality
        self._candidate_count += 1
        self._best_alignment = candidate
        self._best_alignment_ts = msg.ts
        self._broadcast_align_status(
            state="detecting",
            robot_marker_detected=False,
            spectacles_marker_detected=True,
            quality=candidate.quality,
            best_quality=candidate.quality,
            has_candidate=True,
            method="manual",
            message="Manual robot pose ready — review and commit",
            ts=msg.ts,
        )
        return candidate

    def _finish_alignment(self, result: AlignmentCandidate, ts: float | None) -> None:
        self._aligner.active = False
        self._stop_align_status_broadcast()
        self._calibration.register_from_alignment(result.T_world_odom)
        method: Literal["manual", "marker"] = (
            "manual" if result.method == "manual" else "marker"
        )
        self._status_tracker.set_registered(
            True,
            method=method,
            approximate=result.approximate,
        )
        logger.info(
            "Alignment succeeded",
            quality=round(result.quality, 3),
            samples=self._candidate_count,
            method=method,
            approximate=result.approximate,
        )
        self._clear_align_session()
        self._broadcast_status()
        self._broadcast_align_status(
            state="aligned",
            robot_marker_detected=method == "marker",
            spectacles_marker_detected=True,
            quality=result.quality,
            best_quality=result.quality,
            has_candidate=True,
            method=method,
            message=(
                "Manual alignment committed"
                if result.method == "manual"
                else "Alignment successful"
            ),
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
        method: str | None = None,
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
        if method is None and self._best_alignment is not None:
            method = self._best_alignment.method
        if method is None and self._alignment_mode == "manual":
            method = "manual"
        if not message and state == "detecting":
            message = self._align_status_message()
        if state == "detecting" and robot_marker_detected != self._last_debug_robot_detected:
            self._last_debug_robot_detected = robot_marker_detected
        self._ws_server.schedule_send(
            encode_align_status(
                ts=ts,
                robot_id=self._robot_id,
                state=state,
                robot_marker_detected=robot_marker_detected,
                spectacles_marker_detected=spectacles_marker_detected,
                quality=quality,
                best_quality=best_quality,
                has_candidate=has_candidate,
                method=method,
                message=message,
            )
        )

    def _normalize_nav_state(self, raw: str) -> str:
        state = raw.strip().lower()
        if state in {"idle", "following_path", "recovery"}:
            return state
        if "recover" in state:
            return "recovery"
        if any(token in state for token in ("follow", "path", "navig")):
            return "following_path"
        return "idle"

    def _broadcast_nav_status(self, *, ts: float | None = None) -> None:
        self._ws_server.schedule_send(
            encode_nav_status(
                ts=ts,
                state=self._nav_state,
                goal_reached=self._goal_reached,
                goal_failed=self._goal_failed,
                recovering=self._nav_recovering,
                error_code=self._nav_error_code,
                robot_id=self._robot_id,
            )
        )

    def _start_nav_watchdog(self) -> None:
        if self._nav_watchdog_thread is not None:
            return
        self._nav_watchdog_stop.clear()
        self._nav_watchdog_thread = threading.Thread(
            target=self._nav_watchdog_loop,
            name="XRBridgeNavWatchdog",
            daemon=True,
        )
        self._nav_watchdog_thread.start()

    def _stop_nav_watchdog(self) -> None:
        self._nav_watchdog_stop.set()
        thread = self._nav_watchdog_thread
        if thread is not None:
            thread.join(timeout=1.0)
        self._nav_watchdog_thread = None

    def _nav_watchdog_loop(self) -> None:
        while not self._nav_watchdog_stop.wait(timeout=NAV_WATCHDOG_POLL_INTERVAL_S):
            with self._nav_watchdog_lock:
                if (
                    self._nav_degraded
                    or not self._nav_goal_pending
                    or self._nav_path_received
                    or self._nav_goal_dispatch_mono is None
                ):
                    continue
                elapsed = time.monotonic() - self._nav_goal_dispatch_mono
                if elapsed < NAV_GOAL_PATH_TIMEOUT_S:
                    continue
            self._handle_nav_goal_stall()

    def _reset_nav_goal_tracking(self, *, reset_recovery: bool = False) -> None:
        with self._nav_watchdog_lock:
            self._nav_goal_pending = False
            self._nav_path_received = False
            self._nav_goal_dispatch_mono = None
            self._nav_recovering = False
            if reset_recovery:
                self._nav_recovery_attempts = 0

    def _cancel_nav_goal_async(self) -> None:
        threading.Thread(
            target=self._cancel_or_stop,
            kwargs={"emergency": False},
            daemon=True,
        ).start()

    def _handle_nav_goal_stall(self) -> None:
        with self._nav_watchdog_lock:
            if (
                self._nav_degraded
                or not self._nav_goal_pending
                or self._nav_path_received
            ):
                return
            self._nav_recovery_attempts += 1
            attempts = self._nav_recovery_attempts

        if attempts <= NAV_RECOVERY_MAX_ATTEMPTS:
            logger.warning(
                "XR navigation goal stalled; attempting recovery",
                attempt=attempts,
                max_attempts=NAV_RECOVERY_MAX_ATTEMPTS,
            )
            self._recover_stuck_nav_goal()
            return

        logger.error(
            "XR navigation goal stalled; recovery exhausted",
            attempts=attempts,
        )
        self._terminal_nav_failure()

    def _recover_stuck_nav_goal(self) -> None:
        self._goal_reached = False
        self._goal_failed = False
        self._nav_error_code = None
        self._nav_state = "idle"
        self._reset_nav_goal_tracking(reset_recovery=False)
        self._nav_recovering = True
        self._broadcast_empty_path()
        self._broadcast_nav_status()
        self._cancel_nav_goal_async()

    def _terminal_nav_failure(self) -> None:
        self._nav_degraded = True
        self._goal_reached = False
        self._goal_failed = True
        self._nav_error_code = NAV_GOAL_STALLED.code
        self._nav_state = "idle"
        self._nav_recovering = False
        self._reset_nav_goal_tracking(reset_recovery=False)
        self._broadcast_empty_path()
        self._broadcast_nav_status()
        self._cancel_nav_goal_async()

    def _promote_nav_to_following_path(self, *, ts: float | None = None) -> None:
        with self._nav_watchdog_lock:
            if not self._nav_goal_pending:
                return
            self._nav_path_received = True
            self._nav_goal_dispatch_mono = None
            self._nav_recovering = False
        self._nav_state = "following_path"
        self._goal_failed = False
        self._nav_error_code = None
        self._broadcast_nav_status(ts=ts)

    def _broadcast_empty_path(self, *, ts: float | None = None) -> None:
        self._last_executing_path_payload = None
        self._ws_server.schedule_send(
            encode_path(
                ts=ts if ts is not None else time.time(),
                waypoints=[],
                robot_id=self._robot_id,
            )
        )

    def _send_preview_path(
        self,
        *,
        ts: float,
        target_world: tuple[float, float, float],
        waypoints: list[tuple[float, float, float]],
    ) -> None:
        self._ws_server.schedule_send(
            encode_path_preview(
                ts=ts,
                waypoints=waypoints,
                robot_id=self._robot_id,
                target=target_world,
            )
        )

    def _on_get_status(self, _msg: GetStatusMessage, websocket: ServerConnection) -> None:
        self._send_status_to(websocket)

    def _on_align_start(self, msg: AlignStartMessage, _websocket: ServerConnection) -> None:
        self._aligner.active = True
        self._clear_align_session()
        self._logged_align_video = False
        self._color_frame_count = 0
        self._last_color_frame_mono = None
        self._last_debug_robot_detected = None
        self._align_start_mono = time.monotonic()
        self._alignment_mode = "marker"
        logger.info("XR alignment started")
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
        alignment_mode = self._alignment_mode
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
        logger.info("XR alignment stopped")
        self._broadcast_align_status(
            state="detecting",
            robot_marker_detected=False,
            spectacles_marker_detected=False,
            has_candidate=False,
            method=alignment_mode,
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
                method=self._alignment_mode,
                message="No valid alignment candidate yet",
                ts=msg.ts,
            )
            return
        finish_ts = self._best_alignment_ts if self._best_alignment_ts is not None else msg.ts
        commit_candidate = best
        if best.method == "marker":
            cluster = collect_alignment_cluster(best, self._recent_marker_candidates)
            if len(cluster) >= ALIGNMENT_CLUSTER_MIN_SAMPLES:
                T_avg, yaw_spread, trans_spread = average_cluster_transform(cluster)
                commit_candidate = AlignmentCandidate(
                    T_world_odom=T_avg,
                    quality=best.quality,
                    method=best.method,
                    approximate=best.approximate,
                    reprojection_error_px=best.reprojection_error_px,
                    sample_quality=best.sample_quality,
                    cluster_size=len(cluster),
                )
                logger.info(
                    "AprilTag alignment commit averaged cluster",
                    cluster_size=len(cluster),
                    yaw_spread_deg=round(math.degrees(yaw_spread), 2),
                    trans_spread_m=round(trans_spread, 4),
                    committed_yaw_deg=round(
                        math.degrees(_candidate_yaw_rad(T_avg)),
                        2,
                    ),
                )
        self._finish_alignment(commit_candidate, finish_ts)

    def _on_align_marker(self, msg: AlignMarkerMessage, _websocket: ServerConnection) -> None:
        if not self._aligner.active:
            return
        self._alignment_mode = "marker"
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
                method="marker",
                message="Waiting for robot odometry",
                ts=msg.ts,
            )
            return
        self._process_alignment_candidate(msg, odom, received_ts=marker_mono)

    def _on_align_manual_pose(
        self, msg: AlignManualPoseMessage, _websocket: ServerConnection
    ) -> None:
        if not self._aligner.active:
            return
        odom = self._get_latest_odom()
        if odom is None:
            self._alignment_mode = "manual"
            self._broadcast_align_status(
                state="detecting",
                robot_marker_detected=False,
                spectacles_marker_detected=True,
                quality=self._latest_alignment_quality,
                has_candidate=False,
                method="manual",
                message="Waiting for robot odometry",
                ts=msg.ts,
            )
            return
        self._process_manual_alignment_candidate(msg, odom)

    def _on_nav_goal(self, msg: NavGoalMessage) -> None:
        if not self._calibration.is_registered:
            logger.warning("nav_goal ignored before calibration")
            return
        if self._nav_degraded:
            logger.warning("nav_goal rejected: navigation is unavailable for this session")
            self._goal_failed = True
            self._goal_reached = False
            self._nav_error_code = NAV_GOAL_STALLED.code
            self._nav_state = "idle"
            self._nav_recovering = False
            self._broadcast_empty_path(ts=msg.ts)
            self._broadcast_nav_status(ts=msg.ts)
            return
        self._goal_reached = False
        self._goal_failed = False
        self._nav_error_code = None
        self._nav_recovering = False
        self._nav_path_received = False
        self._nav_state = "idle"
        with self._nav_watchdog_lock:
            self._nav_goal_pending = True
            self._nav_goal_dispatch_mono = time.monotonic()
        if msg.orientation is not None:
            odom_position, odom_orientation = self._calibration.inverse_transform_pose(
                msg.position,
                msg.orientation,
            )
        else:
            odom_position = self._calibration.inverse_transform_point(msg.position)
            odom_orientation = (0.0, 0.0, 0.0, 1.0)
        goal = PoseStamped(
            position=list(odom_position),
            orientation=list(odom_orientation),
            ts=msg.ts,
            frame_id="odom",
        )
        try:
            if not self._adapter.send_nav_goal(goal):
                raise RuntimeError("adapter rejected goal")
            logger.info(
                "XR navigation goal published",
                world_goal=[round(v, 3) for v in msg.position],
                odom_goal=[round(v, 3) for v in odom_position],
                world_goal_yaw_deg=(
                    _orientation_yaw_deg(msg.orientation)
                    if msg.orientation is not None
                    else None
                ),
                odom_goal_yaw_deg=_orientation_yaw_deg(odom_orientation),
            )
            self._broadcast_nav_status(ts=msg.ts)
        except Exception as exc:
            self._goal_failed = True
            self._reset_nav_goal_tracking(reset_recovery=False)
            self._nav_state = "idle"
            logger.error("XR navigation goal publish failed", error=str(exc))
            self._broadcast_empty_path(ts=msg.ts)
            self._broadcast_nav_status(ts=msg.ts)

    def _on_plan_path(self, msg: PlanPathMessage) -> None:
        if not self._calibration.is_registered or not self._preview_planner.has_costmap():
            self._send_preview_path(ts=msg.ts, target_world=msg.position, waypoints=[])
            return
        if self._get_latest_odom() is None:
            self._send_preview_path(ts=msg.ts, target_world=msg.position, waypoints=[])
            return
        with self._preview_request_condition:
            self._preview_request = PreviewPathRequest(ts=msg.ts, target_world=msg.position)
            self._preview_request_condition.notify()

    def _process_preview_request(self, request: PreviewPathRequest) -> None:
        try:
            if not self._calibration.is_registered:
                self._send_preview_path(
                    ts=request.ts,
                    target_world=request.target_world,
                    waypoints=[],
                )
                return
            odom = self._get_latest_odom()
            if odom is None or not self._preview_planner.has_costmap():
                self._send_preview_path(
                    ts=request.ts,
                    target_world=request.target_world,
                    waypoints=[],
                )
                return
            target_odom = self._calibration.inverse_transform_point(request.target_world)
            preview_path = self._preview_planner.plan(
                (odom.position[0], odom.position[1]),
                (target_odom[0], target_odom[1]),
            )
            if not preview_path:
                self._send_preview_path(
                    ts=request.ts,
                    target_world=request.target_world,
                    waypoints=[],
                )
                return
            world_waypoints = []
            for waypoint in preview_path:
                world_position, _ = self._calibration.transform_pose(
                    waypoint,
                    (0.0, 0.0, 0.0, 1.0),
                )
                world_waypoints.append(world_position)
            self._send_preview_path(
                ts=request.ts,
                target_world=request.target_world,
                waypoints=world_waypoints,
            )
        except Exception as exc:
            logger.error("XR preview planning failed", error=str(exc))
            self._send_preview_path(
                ts=request.ts,
                target_world=request.target_world,
                waypoints=[],
            )

    def _cancel_or_stop(self, *, emergency: bool) -> None:
        try:
            if emergency:
                self._adapter.emergency_stop()
            else:
                self._adapter.cancel_goal()
        except Exception as exc:
            logger.error("XR control command failed", emergency=emergency, error=str(exc))

    def _on_cancel_goal(self, msg: CancelGoalMessage) -> None:
        self._goal_reached = False
        self._goal_failed = False
        self._nav_error_code = None
        self._nav_recovering = False
        self._nav_state = "idle"
        self._reset_nav_goal_tracking(reset_recovery=True)
        self._broadcast_empty_path(ts=msg.ts)
        self._broadcast_nav_status(ts=msg.ts)
        self._cancel_nav_goal_async()

    def _on_emergency_stop(self, msg: EmergencyStopMessage) -> None:
        self._goal_reached = False
        self._goal_failed = False
        self._nav_error_code = None
        self._nav_recovering = False
        self._nav_state = "idle"
        self._reset_nav_goal_tracking(reset_recovery=True)
        self._broadcast_empty_path(ts=msg.ts)
        self._broadcast_nav_status(ts=msg.ts)
        threading.Thread(
            target=self._cancel_or_stop,
            kwargs={"emergency": True},
            daemon=True,
        ).start()

    def _maybe_log_lidar_payload(self, point_count: int, payload_bytes: int) -> None:
        now = time.monotonic()
        if now - self._last_lidar_payload_log_mono < LIDAR_PAYLOAD_LOG_INTERVAL_S:
            return
        self._last_lidar_payload_log_mono = now
        logger.debug(
            "LiDAR payload",
            points=point_count,
            bytes=payload_bytes,
            hz=self.config.lidar_max_hz,
        )

    async def handle_xr_camera_info(self, msg: CameraInfo) -> None:
        self._aligner.set_camera_info(msg)

    async def handle_xr_color_image(self, msg: Image) -> None:
        if not self._aligner.active:
            return
        self._last_color_frame_mono = time.monotonic()
        self._color_frame_count += 1
        if not self._logged_align_video:
            self._logged_align_video = True
            logger.info("AprilTag: robot video frames reaching XR bridge")
        await asyncio.to_thread(self._aligner.process_frame, msg)

    async def handle_xr_lidar(self, msg: PointCloud2) -> None:
        self._last_lidar_mono = time.monotonic()
        self._refresh_streams_active()
        if not self._lidar_filter.rate_limiter.allow():
            return
        points = msg.points_f32()
        world_pts = np.zeros((0, 3), dtype=np.float32)
        if points.size != 0:
            filtered = self._lidar_filter.filter(points)
            if len(filtered) != 0:
                world_pts = self._calibration.transform_points(filtered)
                world_pts = subsample_points_near_robot(
                    world_pts,
                    self._latest_robot_world_position(),
                    target_points=self.config.target_points,
                )
        payload = encode_lidar(ts=msg.ts, points=world_pts, robot_id=self._robot_id)
        if not self._logged_lidar_stream_active:
            self._logged_lidar_stream_active = True
            logger.info("LiDAR stream active", hz=self.config.lidar_max_hz)
        self._maybe_log_lidar_payload(len(world_pts), len(payload))
        self._ws_server.schedule_send(payload)

    async def handle_xr_odom(self, msg: PoseStamped) -> None:
        self._update_latest_odom(msg)
        self._last_odom_mono = time.monotonic()
        self._refresh_streams_active()
        if not self._pose_limiter.allow():
            return
        sample = self._sample_odom(msg)
        pos, quat = self._calibration.transform_pose(sample.position, sample.orientation)
        if not self._pose_components_finite(pos, quat):
            self._dropped_pose_count += 1
            now = time.monotonic()
            if now - self._last_dropped_pose_log_mono >= DROPPED_POSE_LOG_INTERVAL_S:
                self._last_dropped_pose_log_mono = now
                logger.warning(
                    "XR pose dropped (non-finite after transform)",
                    drops=self._dropped_pose_count,
                )
            return
        self._ws_server.schedule_send(
            encode_pose(ts=msg.ts, position=pos, orientation=quat, robot_id=self._robot_id)
        )

    async def handle_xr_path(self, msg: Path) -> None:
        waypoints: list[tuple[float, float, float]] = []
        for pose in msg.poses:
            world_pos, _world_quat = self._calibration.transform_pose(
                (pose.x, pose.y, pose.z),
                (
                    pose.orientation.x,
                    pose.orientation.y,
                    pose.orientation.z,
                    pose.orientation.w,
                ),
            )
            waypoints.append(world_pos)
        if waypoints and self._nav_goal_pending and not self._nav_path_received:
            self._promote_nav_to_following_path(ts=msg.ts)
        path_payload = encode_path(ts=msg.ts, waypoints=waypoints, robot_id=self._robot_id)
        if waypoints:
            self._last_executing_path_payload = path_payload
        elif self._nav_state == "idle":
            self._last_executing_path_payload = None
        self._ws_server.schedule_send(path_payload)

    async def handle_xr_global_costmap(self, msg: OccupancyGrid) -> None:
        self._preview_planner.update_costmap(msg)

    async def handle_xr_goal_reached(self, msg: Bool) -> None:
        self._goal_reached = bool(msg.data)
        was_pending = self._nav_goal_pending
        self._goal_failed = was_pending and not self._goal_reached
        self._nav_recovering = False
        self._nav_error_code = None
        self._reset_nav_goal_tracking(reset_recovery=self._goal_reached)
        if self._goal_reached or self._goal_failed:
            self._nav_state = "idle"
            self._broadcast_empty_path()
        self._broadcast_nav_status()

    async def handle_xr_navigation_state(self, msg: String) -> None:
        normalized = self._normalize_nav_state(msg.data)
        if (
            normalized == "idle"
            and self._nav_goal_pending
            and not self._nav_path_received
            and not self._nav_degraded
        ):
            self._handle_nav_goal_stall()
            return
        self._nav_state = normalized
        if self._nav_state == "following_path":
            self._goal_reached = False
            self._goal_failed = False
            with self._nav_watchdog_lock:
                self._nav_goal_pending = True
                if not self._nav_path_received:
                    self._nav_path_received = True
                    self._nav_goal_dispatch_mono = None
        self._broadcast_nav_status()
