"""AprilTag marker detection and dual-camera frame alignment."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass

import cv2
import numpy as np
from dimos.msgs.sensor_msgs.CameraInfo import CameraInfo
from dimos.msgs.sensor_msgs.Image import Image
from dimos.utils.logging_config import setup_logger

from dimos_ar.marker_contract import (
    DEFAULT_APRILTAG_DICT,
    DEFAULT_MARKER_ID,
    DEFAULT_MARKER_LENGTH_M,
)
from dimos_ar.transforms import OdomSample, pose_to_matrix

logger = setup_logger()

_DEBUG_LOG_INTERVAL_S = 3.0

# Go2 front camera extrinsics (base_link <- camera), from Unitree Go2 sim defaults.
DEFAULT_CAMERA_POSITION = (0.325, -0.001, 0.054)
DEFAULT_CAMERA_ORIENTATION = (0.5, -0.5, 0.5, -0.5)

DEFAULT_TIMESTAMP_TOLERANCE_S = 0.5
DEFAULT_MAX_REPROJECTION_ERROR_PX = 8.0


def camera_info_to_cv_matrices(camera_info: CameraInfo) -> tuple[np.ndarray, np.ndarray]:
    """Build OpenCV cameraMatrix and distCoeffs from DimOS CameraInfo."""
    k = np.array(camera_info.K, dtype=np.float64).reshape(3, 3)
    d = np.array(camera_info.D if camera_info.D else [], dtype=np.float64).reshape(-1, 1)
    return k, d


@dataclass(frozen=True)
class RobotMarkerDetection:
    """Marker pose in camera optical frame at detection time."""

    detect_ts: float
    T_camera_marker: np.ndarray
    reprojection_error_px: float


@dataclass(frozen=True)
class AlignmentResult:
    T_world_odom: np.ndarray
    quality: float
    reprojection_error_px: float


def _square_marker_object_points(marker_length_m: float) -> np.ndarray:
    """Corner order matches OpenCV square-marker / solvePnP convention (planar, Z=0)."""
    h = marker_length_m / 2.0
    return np.array(
        [
            [-h, h, 0.0],
            [h, h, 0.0],
            [h, -h, 0.0],
            [-h, -h, 0.0],
        ],
        dtype=np.float32,
    )


def _rvec_tvec_to_matrix(rvec: np.ndarray, tvec: np.ndarray) -> np.ndarray:
    rot_mat, _ = cv2.Rodrigues(rvec)
    T = np.eye(4, dtype=np.float64)
    T[:3, :3] = rot_mat
    T[:3, 3] = tvec.reshape(3)
    return T


def create_apriltag_detector(
    dictionary_name: str = DEFAULT_APRILTAG_DICT,
) -> cv2.aruco.ArucoDetector:
    if not hasattr(cv2.aruco, dictionary_name):
        raise ValueError(f"Unknown AprilTag dictionary {dictionary_name!r}")
    dictionary = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, dictionary_name))
    parameters = cv2.aruco.DetectorParameters()
    return cv2.aruco.ArucoDetector(dictionary, parameters)


def estimate_marker_pose(
    corners_px: np.ndarray,
    marker_length_m: float,
    camera_matrix: np.ndarray,
    dist_coeffs: np.ndarray,
) -> tuple[np.ndarray, np.ndarray] | None:
    """Return (rvec, tvec) for camera optical <- marker from solvePnP."""
    obj = _square_marker_object_points(marker_length_m)
    img: np.ndarray = corners_px.reshape(4, 1, 2).astype(np.float32)
    ok, rvec, tvec = cv2.solvePnP(
        obj,
        img,
        camera_matrix,
        dist_coeffs,
        flags=cv2.SOLVEPNP_IPPE_SQUARE,
    )
    if not ok:
        return None
    return rvec, tvec


def _reprojection_error_px(
    corners_px: np.ndarray,
    marker_length_m: float,
    rvec: np.ndarray,
    tvec: np.ndarray,
    camera_matrix: np.ndarray,
    dist_coeffs: np.ndarray,
) -> float:
    obj = _square_marker_object_points(marker_length_m)
    projected, _ = cv2.projectPoints(obj, rvec, tvec, camera_matrix, dist_coeffs)
    diff = corners_px.reshape(-1, 2) - projected.reshape(-1, 2)
    return float(np.sqrt(np.mean(np.sum(diff * diff, axis=1))))


@dataclass
class AlignDebugStats:
    """Counters since alignment started (for throttled logs)."""

    frames: int = 0
    no_camera_info: int = 0
    no_marker: int = 0
    wrong_id: int = 0
    pose_fail: int = 0
    high_reproj: int = 0
    detected: int = 0
    last_reproj_px: float | None = None


class AprilTagAligner:
    """Detects the calibration AprilTag on robot camera frames during align step only."""

    def __init__(
        self,
        *,
        marker_length_m: float = DEFAULT_MARKER_LENGTH_M,
        marker_id: int = DEFAULT_MARKER_ID,
        apriltag_dictionary: str = DEFAULT_APRILTAG_DICT,
        timestamp_tolerance_s: float = DEFAULT_TIMESTAMP_TOLERANCE_S,
        max_reprojection_error_px: float = DEFAULT_MAX_REPROJECTION_ERROR_PX,
        camera_position: tuple[float, float, float] = DEFAULT_CAMERA_POSITION,
        camera_orientation: tuple[float, float, float, float] = DEFAULT_CAMERA_ORIENTATION,
    ) -> None:
        self._marker_length_m = marker_length_m
        self._marker_id = marker_id
        self._timestamp_tolerance_s = timestamp_tolerance_s
        self._max_reprojection_error_px = max_reprojection_error_px
        self._T_base_camera = pose_to_matrix(camera_position, camera_orientation)
        self._detector = create_apriltag_detector(apriltag_dictionary)
        self._lock = threading.Lock()
        self._active = False
        self._camera_info: CameraInfo | None = None
        self._latest_detection: RobotMarkerDetection | None = None
        self._debug = AlignDebugStats()
        self._debug_log_mono: float = 0.0
        self._logged_waiting_camera_info = False

    @property
    def active(self) -> bool:
        with self._lock:
            return self._active

    @active.setter
    def active(self, value: bool) -> None:
        with self._lock:
            self._active = value
            if not value:
                self._latest_detection = None
                self._debug = AlignDebugStats()
                self._logged_waiting_camera_info = False
            elif value:
                self._debug = AlignDebugStats()
                self._debug_log_mono = 0.0
                self._logged_waiting_camera_info = False
                logger.info(
                    "AprilTag robot detection started: id=%d %s edge=%.0fmm "
                    "(same marker as legacy aruco_marker.png / phone PDF, Lens physical height %.1fcm)",
                    self._marker_id,
                    DEFAULT_APRILTAG_DICT,
                    self._marker_length_m * 1000,
                    self._marker_length_m * 100,
                )

    def set_camera_info(self, info: CameraInfo) -> None:
        with self._lock:
            had = self._camera_info is not None
            self._camera_info = info
        if not had and self._active:
            logger.info("AprilTag: robot camera intrinsics received")

    def debug_stats(self) -> AlignDebugStats:
        with self._lock:
            return AlignDebugStats(
                frames=self._debug.frames,
                no_camera_info=self._debug.no_camera_info,
                no_marker=self._debug.no_marker,
                wrong_id=self._debug.wrong_id,
                pose_fail=self._debug.pose_fail,
                high_reproj=self._debug.high_reproj,
                detected=self._debug.detected,
                last_reproj_px=self._debug.last_reproj_px,
            )

    @property
    def robot_marker_detected(self) -> bool:
        with self._lock:
            if self._latest_detection is None:
                return False
            age = time.monotonic() - self._latest_detection.detect_ts
            return age <= self._timestamp_tolerance_s

    def _maybe_log_debug(self) -> None:
        now = time.monotonic()
        if now - self._debug_log_mono < _DEBUG_LOG_INTERVAL_S:
            return
        self._debug_log_mono = now
        stats = self.debug_stats()
        if stats.frames == 0:
            return
        if stats.detected > 0 and stats.last_reproj_px is not None:
            logger.info(
                "AprilTag robot camera: marker visible (reproj %.1fpx); "
                "frames=%d detected=%d",
                stats.last_reproj_px,
                stats.frames,
                stats.detected,
            )
            return
        logger.info(
            "AprilTag robot camera: no marker yet — frames=%d "
            "no_intrinsics=%d no_marker=%d wrong_id=%d pose_fail=%d high_reproj=%d "
            "(show phone marker page to Go2 front camera; avoid glare)",
            stats.frames,
            stats.no_camera_info,
            stats.no_marker,
            stats.wrong_id,
            stats.pose_fail,
            stats.high_reproj,
        )

    def process_frame(self, image: Image) -> None:
        with self._lock:
            if not self._active:
                return
            info = self._camera_info
            self._debug.frames += 1
        if info is None:
            with self._lock:
                self._debug.no_camera_info += 1
                if not self._logged_waiting_camera_info:
                    self._logged_waiting_camera_info = True
                    logger.warning(
                        "AprilTag: waiting for robot camera_info before detection can run",
                    )
            self._maybe_log_debug()
            return

        gray = cv2.cvtColor(image.to_opencv(), cv2.COLOR_BGR2GRAY)
        corners, ids, _rejected = self._detector.detectMarkers(gray)
        if ids is None or len(ids) == 0:
            with self._lock:
                self._debug.no_marker += 1
            self._maybe_log_debug()
            return

        if len(ids) != 1 or int(ids[0][0]) != self._marker_id:
            with self._lock:
                self._debug.wrong_id += 1
            self._maybe_log_debug()
            return

        camera_matrix, dist_coeffs = camera_info_to_cv_matrices(info)
        marker_corners = corners[0]
        pose = estimate_marker_pose(
            marker_corners,
            self._marker_length_m,
            camera_matrix,
            dist_coeffs,
        )
        if pose is None:
            with self._lock:
                self._debug.pose_fail += 1
            self._maybe_log_debug()
            return

        rvec, tvec = pose
        reproj = _reprojection_error_px(
            marker_corners,
            self._marker_length_m,
            rvec,
            tvec,
            camera_matrix,
            dist_coeffs,
        )
        if reproj > self._max_reprojection_error_px:
            with self._lock:
                self._debug.high_reproj += 1
                self._debug.last_reproj_px = reproj
            self._maybe_log_debug()
            return

        T_camera_marker = _rvec_tvec_to_matrix(rvec, tvec)
        detection = RobotMarkerDetection(
            detect_ts=time.monotonic(),
            T_camera_marker=T_camera_marker,
            reprojection_error_px=reproj,
        )
        with self._lock:
            self._latest_detection = detection
            self._debug.detected += 1
            self._debug.last_reproj_px = reproj
        self._maybe_log_debug()

    def try_align(
        self,
        marker_position: tuple[float, float, float],
        marker_orientation: tuple[float, float, float, float],
        odom: OdomSample,
        *,
        received_ts: float | None = None,
    ) -> AlignmentResult | None:
        """Match a fresh Spectacles marker pose with a recent robot detection."""
        recv_ts = received_ts if received_ts is not None else time.monotonic()
        with self._lock:
            detection = self._latest_detection

        if detection is None:
            return None
        if abs(recv_ts - detection.detect_ts) > self._timestamp_tolerance_s:
            return None

        T_world_marker = pose_to_matrix(marker_position, marker_orientation)
        T_odom_base = pose_to_matrix(odom.position, odom.orientation)
        T_odom_camera = T_odom_base @ self._T_base_camera
        T_odom_marker = T_odom_camera @ detection.T_camera_marker
        T_world_odom = T_world_marker @ np.linalg.inv(T_odom_marker)

        quality = max(
            0.0,
            min(1.0, 1.0 - detection.reprojection_error_px / self._max_reprojection_error_px),
        )
        return AlignmentResult(
            T_world_odom=T_world_odom,
            quality=quality,
            reprojection_error_px=detection.reprojection_error_px,
        )
