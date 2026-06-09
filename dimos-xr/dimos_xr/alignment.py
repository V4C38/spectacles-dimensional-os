"""AprilTag marker detection and dual-camera frame alignment."""

from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass

import cv2
import numpy as np
from dimos.msgs.sensor_msgs.CameraInfo import CameraInfo
from dimos.msgs.sensor_msgs.Image import Image
from dimos.utils.logging_config import setup_logger

from dimos_xr.marker_contract import (
    DEFAULT_APRILTAG_DICT,
    DEFAULT_MARKER_ID,
    DEFAULT_MARKER_LENGTH_M,
)
from dimos_xr.transforms import OdomSample, pose_to_matrix

logger = setup_logger()

_DEBUG_LOG_INTERVAL_S = 3.0
_AGENT_DEBUG_LOG_PATH = (
    "/Users/johannestscharn/Repositories/spectacles-dimensional-os/.cursor/debug-541187.log"
)


def _agent_debug_log(
    *,
    location: str,
    message: str,
    data: dict[str, object],
    hypothesis_id: str,
    run_id: str = "pre-fix",
) -> None:
    # region agent log
    try:
        with open(_AGENT_DEBUG_LOG_PATH, "a", encoding="utf-8") as handle:
            handle.write(
                json.dumps(
                    {
                        "sessionId": "541187",
                        "runId": run_id,
                        "hypothesisId": hypothesis_id,
                        "location": location,
                        "message": message,
                        "data": data,
                        "timestamp": int(time.time() * 1000),
                    }
                )
                + "\n"
            )
    except OSError:
        pass
    # endregion

# Go2 front camera extrinsics (base_link <- camera), aligned to the public Unitree Go2
# front_camera_joint mount. This is intentionally separate from the optical-frame rotation
# below, which already matches the standard ROS/OpenCV camera_optical convention.
DEFAULT_CAMERA_POSITION = (0.32715, -0.00003, 0.04297)
DEFAULT_CAMERA_ORIENTATION = (0.5, -0.5, 0.5, -0.5)

DEFAULT_TIMESTAMP_TOLERANCE_S = 0.5
DEFAULT_MAX_REPROJECTION_ERROR_PX = 8.0

DEFAULT_GO2_FRONT_CAMERA_INFO_SOURCE = "go2_front_720_calibrated"
DEFAULT_GO2_FRONT_CAMERA_WIDTH = 1280
DEFAULT_GO2_FRONT_CAMERA_HEIGHT = 720
DEFAULT_GO2_FRONT_CAMERA_K = (
    864.39938,
    0.0,
    639.19798,
    0.0,
    863.73849,
    373.28118,
    0.0,
    0.0,
    1.0,
)
DEFAULT_GO2_FRONT_CAMERA_D = (-0.35463, 0.102054, -0.001614, -0.001249, 0.0)


def build_camera_info(
    *,
    width: int,
    height: int,
    k: tuple[float, ...],
    d: tuple[float, ...],
    frame_id: str = "camera_optical",
) -> CameraInfo:
    return CameraInfo(
        frame_id=frame_id,
        width=width,
        height=height,
        distortion_model="plumb_bob",
        D=list(d),
        K=list(k),
        R=[1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
        P=[k[0], 0.0, k[2], 0.0, 0.0, k[4], k[5], 0.0, 0.0, 0.0, 1.0, 0.0],
        binning_x=0,
        binning_y=0,
    )


DEFAULT_GO2_FRONT_CAMERA_INFO = build_camera_info(
    width=DEFAULT_GO2_FRONT_CAMERA_WIDTH,
    height=DEFAULT_GO2_FRONT_CAMERA_HEIGHT,
    k=DEFAULT_GO2_FRONT_CAMERA_K,
    d=DEFAULT_GO2_FRONT_CAMERA_D,
)


def camera_info_to_cv_matrices(camera_info: CameraInfo) -> tuple[np.ndarray, np.ndarray]:
    """Build OpenCV cameraMatrix and distCoeffs from DimOS CameraInfo."""
    k = np.array(camera_info.K, dtype=np.float64).reshape(3, 3)
    d = np.array(camera_info.D if camera_info.D else [], dtype=np.float64).reshape(-1, 1)
    return k, d


def _camera_info_matches_resolution(camera_info: CameraInfo, width: int, height: int) -> bool:
    return int(camera_info.width) == int(width) and int(camera_info.height) == int(height)


def _camera_info_has_distortion(camera_info: CameraInfo) -> bool:
    return any(abs(float(value)) > 1e-6 for value in (camera_info.D if camera_info.D else []))


def _camera_info_intrinsics_differ(
    camera_info: CameraInfo,
    reference: CameraInfo,
    *,
    pixel_tolerance: float = 5.0,
) -> bool:
    return any(
        abs(float(lhs) - float(rhs)) > pixel_tolerance
        for lhs, rhs in zip(camera_info.K, reference.K, strict=False)
    )


def _camera_info_summary(camera_info: CameraInfo) -> str:
    d = camera_info.D if camera_info.D else []
    return (
        f"{int(camera_info.width)}x{int(camera_info.height)} "
        f"fx={float(camera_info.K[0]):.2f} fy={float(camera_info.K[4]):.2f} "
        f"cx={float(camera_info.K[2]):.2f} cy={float(camera_info.K[5]):.2f} "
        f"distortion={'nonzero' if _camera_info_has_distortion(camera_info) else 'zero'} "
        f"D={[round(float(value), 6) for value in d[:5]]}"
    )


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
    camera_resolution_mismatch: int = 0
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
        fallback_camera_info: CameraInfo | None = DEFAULT_GO2_FRONT_CAMERA_INFO,
        prefer_calibrated_camera_info: bool = True,
    ) -> None:
        self._marker_length_m = marker_length_m
        self._marker_id = marker_id
        self._timestamp_tolerance_s = timestamp_tolerance_s
        self._max_reprojection_error_px = max_reprojection_error_px
        self._T_base_camera = pose_to_matrix(camera_position, camera_orientation)
        self._fallback_camera_info = fallback_camera_info
        self._prefer_calibrated_camera_info = prefer_calibrated_camera_info
        self._detector = create_apriltag_detector(apriltag_dictionary)
        self._lock = threading.Lock()
        self._active = False
        self._camera_info: CameraInfo | None = None
        self._latest_detection: RobotMarkerDetection | None = None
        self._debug = AlignDebugStats()
        self._debug_log_mono: float = 0.0
        self._axes_log_mono: float = 0.0
        self._logged_waiting_camera_info = False
        self._logged_camera_resolution_mismatch: tuple[int, int, int, int] | None = None
        self._last_camera_info_signature: tuple[str, str] | None = None

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
                self._logged_camera_resolution_mismatch = None
                self._last_camera_info_signature = None
            elif value:
                self._debug = AlignDebugStats()
                self._debug_log_mono = 0.0
                self._logged_waiting_camera_info = False
                self._logged_camera_resolution_mismatch = None
                self._last_camera_info_signature = None
                logger.info(
                    "AprilTag robot detection started: id=%d %s edge=%.0fmm "
                    "(same marker as apriltag_marker.png / phone PDF, "
                    "Lens physical height %.1fcm)",
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
            logger.info(
                "AprilTag: robot camera intrinsics received (%s)",
                _camera_info_summary(info),
            )

    def debug_stats(self) -> AlignDebugStats:
        with self._lock:
            return AlignDebugStats(
                frames=self._debug.frames,
                no_camera_info=self._debug.no_camera_info,
                no_marker=self._debug.no_marker,
                wrong_id=self._debug.wrong_id,
                pose_fail=self._debug.pose_fail,
                high_reproj=self._debug.high_reproj,
                camera_resolution_mismatch=self._debug.camera_resolution_mismatch,
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
            # region agent log
            _agent_debug_log(
                location="alignment.py:_maybe_log_debug",
                message="robot april tag detection stats",
                data={
                    "marker_visible": True,
                    "frames": stats.frames,
                    "detected": stats.detected,
                    "no_marker": stats.no_marker,
                    "robot_marker_detected_now": self.robot_marker_detected,
                    "last_reproj_px": stats.last_reproj_px,
                },
                hypothesis_id="H3",
            )
            # endregion
            return
        logger.info(
            "AprilTag robot camera: no marker yet — frames=%d "
            "no_intrinsics=%d no_marker=%d wrong_id=%d pose_fail=%d high_reproj=%d "
            "resolution_mismatch=%d "
            "(show phone marker page to Go2 front camera; avoid glare)",
            stats.frames,
            stats.no_camera_info,
            stats.no_marker,
            stats.wrong_id,
            stats.pose_fail,
            stats.high_reproj,
            stats.camera_resolution_mismatch,
        )
        # region agent log
        _agent_debug_log(
            location="alignment.py:_maybe_log_debug",
            message="robot april tag detection stats",
            data={
                "marker_visible": False,
                "frames": stats.frames,
                "detected": stats.detected,
                "no_marker": stats.no_marker,
                "no_camera_info": stats.no_camera_info,
                "wrong_id": stats.wrong_id,
                "pose_fail": stats.pose_fail,
                "high_reproj": stats.high_reproj,
                "resolution_mismatch": stats.camera_resolution_mismatch,
                "robot_marker_detected_now": self.robot_marker_detected,
            },
            hypothesis_id="H3",
        )
        # endregion

    def _maybe_log_camera_resolution_mismatch(
        self,
        camera_info: CameraInfo,
        frame_width: int,
        frame_height: int,
    ) -> None:
        mismatch = (
            int(camera_info.width),
            int(camera_info.height),
            int(frame_width),
            int(frame_height),
        )
        if mismatch == self._logged_camera_resolution_mismatch:
            return
        self._logged_camera_resolution_mismatch = mismatch
        logger.warning(
            "AprilTag: camera_info/image resolution mismatch (camera_info=%dx%d frame=%dx%d) "
            "— rejecting calibration until a matching profile is available",
            mismatch[0],
            mismatch[1],
            mismatch[2],
            mismatch[3],
        )

    def _maybe_log_camera_info_source(
        self,
        source: str,
        camera_info: CameraInfo,
        *,
        live_camera_info: CameraInfo | None = None,
    ) -> None:
        summary = _camera_info_summary(camera_info)
        signature = (source, summary)
        if signature == self._last_camera_info_signature:
            return
        self._last_camera_info_signature = signature
        if live_camera_info is None:
            logger.info("AprilTag: using %s camera model (%s)", source, summary)
            return
        logger.warning(
            "AprilTag: overriding live camera_info with %s (%s); live camera_info was (%s)",
            source,
            summary,
            _camera_info_summary(live_camera_info),
        )

    def resolve_camera_info(
        self,
        frame_width: int,
        frame_height: int,
    ) -> tuple[CameraInfo, str] | None:
        with self._lock:
            live_camera_info = self._camera_info

        fallback_camera_info = self._fallback_camera_info
        fallback_matches = (
            fallback_camera_info is not None
            and _camera_info_matches_resolution(
                fallback_camera_info, frame_width, frame_height
            )
        )

        if live_camera_info is not None and _camera_info_matches_resolution(
            live_camera_info, frame_width, frame_height
        ):
            if (
                self._prefer_calibrated_camera_info
                and fallback_matches
                and (
                    not _camera_info_has_distortion(live_camera_info)
                    or _camera_info_intrinsics_differ(
                        live_camera_info,
                        fallback_camera_info,
                    )
                )
            ):
                assert fallback_camera_info is not None
                self._maybe_log_camera_info_source(
                    DEFAULT_GO2_FRONT_CAMERA_INFO_SOURCE,
                    fallback_camera_info,
                    live_camera_info=live_camera_info,
                )
                return fallback_camera_info, DEFAULT_GO2_FRONT_CAMERA_INFO_SOURCE

            self._maybe_log_camera_info_source("live", live_camera_info)
            return live_camera_info, "live"

        if live_camera_info is not None:
            with self._lock:
                self._debug.camera_resolution_mismatch += 1
            self._maybe_log_camera_resolution_mismatch(
                live_camera_info,
                frame_width,
                frame_height,
            )

        if fallback_matches:
            assert fallback_camera_info is not None
            self._maybe_log_camera_info_source(
                DEFAULT_GO2_FRONT_CAMERA_INFO_SOURCE,
                fallback_camera_info,
            )
            return fallback_camera_info, DEFAULT_GO2_FRONT_CAMERA_INFO_SOURCE

        return None

    def process_frame(self, image: Image) -> None:
        with self._lock:
            if not self._active:
                return
            self._debug.frames += 1
        frame_bgr = image.to_opencv()
        frame_height, frame_width = frame_bgr.shape[:2]
        resolved = self.resolve_camera_info(frame_width, frame_height)
        if resolved is None:
            with self._lock:
                self._debug.no_camera_info += 1
                if not self._logged_waiting_camera_info:
                    self._logged_waiting_camera_info = True
                    logger.warning(
                        "AprilTag: waiting for matching robot camera_info before detection can run",
                    )
            self._maybe_log_debug()
            return

        info, _source = resolved
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
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
        now = time.monotonic()
        if now - self._axes_log_mono >= 1.0:
            self._axes_log_mono = now
            logger.info(
                "AprilTag alignment axes",
                spectacles_marker_x_axis=[
                    round(float(value), 4) for value in T_world_marker[:3, 0]
                ],
                spectacles_marker_y_axis=[
                    round(float(value), 4) for value in T_world_marker[:3, 1]
                ],
                spectacles_marker_z_axis=[
                    round(float(value), 4) for value in T_world_marker[:3, 2]
                ],
                robot_marker_x_axis=[
                    round(float(value), 4) for value in T_odom_marker[:3, 0]
                ],
                robot_marker_y_axis=[
                    round(float(value), 4) for value in T_odom_marker[:3, 1]
                ],
                robot_marker_z_axis=[
                    round(float(value), 4) for value in T_odom_marker[:3, 2]
                ],
            )

        quality = max(
            0.0,
            min(1.0, 1.0 - detection.reprojection_error_px / self._max_reprojection_error_px),
        )
        return AlignmentResult(
            T_world_odom=T_world_odom,
            quality=quality,
            reprojection_error_px=detection.reprojection_error_px,
        )
