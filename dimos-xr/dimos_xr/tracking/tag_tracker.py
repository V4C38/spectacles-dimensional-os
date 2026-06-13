"""Robot-mounted AprilTag tracking from XR client camera frames.

Phase 0 validation notes (device testing via scripts/frame_probe.py):
- Timestamp: use imageFrame.timestampMillis/1000 as capture ts (scene seconds).
- Intrinsics: scale DeviceCamera focal/principal by still/camera resolution ratio.
- Reprojection gate: 3.0 px default; fallback 6.0 px if stills prove non-rectified.
- JPEG size: expect 0.3-1.5 MB at IntermediateQuality over binary WS.
- Serialization: the Lens must keep at most one requestImage + encode pipeline
  in flight at a time (_pipelineBusy guard in FrameCaptureController). Overlapping
  stills at 3200x2400 exhaust Lens memory.

DimOS fiducial delegation note:
Detection and PnP pose estimation here deliberately does NOT delegate to
``dimos.perception.fiducial.marker_tf_module.MarkerTfModule`` because:
1. Input is XR headset camera JPEG frames over WebSocket, not a robot camera stream.
2. ``T_world_glcam`` (headset AR world pose) arrives in the ``camera_frame`` header —
   it is not in the DimOS TF graph and cannot be looked up via ``TFSpec``.
3. The bridge computes ``T_world_odom`` directly from paired (world-space tag,
   odom-space robot) observations — a fundamentally different fusion path.
The individual helper functions ``camera_info_to_cv_matrices`` and
``estimate_marker_pose`` are re-exported from the DimOS fiducial module (same
implementation) to keep the two in sync.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import json
import math
import os
import struct
import threading
import time
from typing import TYPE_CHECKING, Any

_TRACE = os.getenv("DIMOS_XR_TRACE", "") not in ("", "0", "false")

import cv2
from dimos.msgs.sensor_msgs.CameraInfo import CameraInfo
from dimos.perception.fiducial.marker_tf_module import (
    camera_info_to_cv_matrices,
    create_aruco_detector,
    estimate_marker_pose,
)
from dimos.utils.logging_config import setup_logger
from dimos.utils.transform_utils import normalize_angle
import numpy as np

from dimos_xr.tracking.transforms import OdomSample, gravity_level_transform, pose_to_matrix

if TYPE_CHECKING:
    from collections.abc import Callable

    from numpy.typing import NDArray

logger = setup_logger()

DEFAULT_MARKER_ID: int = 0
DEFAULT_APRILTAG_DICT: str = "DICT_APRILTAG_36h11"
TAG_TOTAL_SIZE_M: float = 0.070
TAG_BLACK_SIZE_M: float = TAG_TOTAL_SIZE_M * 8 / 10  # 0.056 m — black detection square

CAMERA_FRAME_MAGIC = b"XRF1"
MAX_HEADER_BYTES = 4096

FLIP_YZ = np.diag([1.0, -1.0, -1.0, 1.0])

R_ALIGN = np.array(
    [
        [1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0],
        [0.0, -1.0, 0.0],
    ],
    dtype=np.float64,
)


def build_camera_info(
    *,
    width: int,
    height: int,
    k: tuple[float, ...],
    d: tuple[float, ...] | list[float],
    frame_id: str = "xr_camera",
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


def _rvec_tvec_to_matrix(rvec: np.ndarray, tvec: np.ndarray) -> np.ndarray:
    rot_mat, _ = cv2.Rodrigues(rvec)
    T = np.eye(4, dtype=np.float64)
    T[:3, :3] = rot_mat
    T[:3, 3] = tvec.reshape(3)
    return T


def _square_marker_object_points(marker_length_m: float) -> np.ndarray:
    h = marker_length_m / 2.0
    return np.array(
        [[-h, h, 0.0], [h, h, 0.0], [h, -h, 0.0], [-h, -h, 0.0]],
        dtype=np.float32,
    )


def reprojection_error_px(
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


def parse_camera_frame(data: bytes) -> tuple[dict[str, Any], bytes]:
    if len(data) < 8:
        raise ValueError("camera_frame too short")
    if data[:4] != CAMERA_FRAME_MAGIC:
        raise ValueError("camera_frame bad magic")
    header_len = struct.unpack_from("<I", data, 4)[0]
    if header_len < 2 or header_len > MAX_HEADER_BYTES:
        raise ValueError("camera_frame invalid header_len")
    header_end = 8 + header_len
    if len(data) < header_end:
        raise ValueError("camera_frame truncated header")
    header = json.loads(data[8:header_end].decode("utf-8"))
    if header.get("type") != "camera_frame":
        raise ValueError("camera_frame wrong type in header")
    for key in ("robot_id", "seq", "ts", "send_ts", "cam_pos", "cam_rot"):
        if key not in header:
            raise ValueError(f"camera_frame missing {key}")
    return header, data[header_end:]


def solve_yaw_translation_2d(
    u: NDArray[np.float64],
    v: NDArray[np.float64],
) -> tuple[float, NDArray[np.float64]]:
    """2D Kabsch: u (odom XY) -> v (world X, -world Z)."""
    if u.shape[0] < 2:
        raise ValueError("need at least 2 points")
    mean_u = u.mean(axis=0)
    mean_v = v.mean(axis=0)
    u_c = u - mean_u
    v_c = v - mean_v
    numerator = float(np.sum(u_c[:, 0] * v_c[:, 1] - u_c[:, 1] * v_c[:, 0]))
    denominator = float(np.sum(u_c[:, 0] * v_c[:, 0] + u_c[:, 1] * v_c[:, 1]))
    yaw = math.atan2(numerator, denominator)
    c, s = math.cos(yaw), math.sin(yaw)
    R2 = np.array([[c, -s], [s, c]], dtype=np.float64)
    t2 = mean_v - R2 @ mean_u
    return yaw, t2


def build_T_world_odom(yaw: float, t_world: tuple[float, float, float]) -> NDArray[np.float64]:
    cy, sy = math.cos(yaw), math.sin(yaw)
    R_yaw = np.array(
        [[cy, 0.0, sy], [0.0, 1.0, 0.0], [-sy, 0.0, cy]],
        dtype=np.float64,
    )
    T = np.eye(4, dtype=np.float64)
    T[:3, :3] = R_yaw @ R_ALIGN
    T[:3, 3] = np.asarray(t_world, dtype=np.float64)
    return T


def _ground_baseline_m(observations: list[TagObservation]) -> float:
    if len(observations) < 2:
        return 0.0
    pts = np.array([(o.p_odom_tag[0], o.p_odom_tag[1]) for o in observations])
    max_dist = 0.0
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            d = float(np.linalg.norm(pts[i] - pts[j]))
            max_dist = max(max_dist, d)
    return max_dist


def _yaw_from_T(T: NDArray[np.float64]) -> float:
    """Heading of T's forward (x) axis. Convention: forward = (cos th, 0, -sin th).

    Sign-consistent with build_T_world_odom, normalize_ground_pose, and the
    Lens-side HeadingRotation.yawToQuat.
    """
    forward = T[:3, 0]
    return math.atan2(-float(forward[2]), float(forward[0]))


# ---------------------------------------------------------------------------
# Alignment-candidate cluster helpers (used by bridge.alignment.AlignmentController)
# ---------------------------------------------------------------------------

ALIGNMENT_CLUSTER_WINDOW: int = 12
ALIGNMENT_CLUSTER_MIN_SAMPLES: int = 5
ALIGNMENT_CLUSTER_TARGET_SAMPLES: int = 5
ALIGNMENT_CLUSTER_TRANSLATION_THRESHOLD_M: float = 0.05
ALIGNMENT_CLUSTER_YAW_THRESHOLD_RAD: float = math.radians(3.0)


@dataclass(frozen=True)
class AlignmentCandidate:
    T_world_odom: Any
    quality: float
    method: str
    approximate: bool
    reprojection_error_px: float | None = None
    sample_quality: float | None = None
    cluster_size: int = 1


def _candidate_translation_distance_m(lhs: NDArray[np.float64], rhs: NDArray[np.float64]) -> float:
    return float(np.linalg.norm(lhs[:3, 3] - rhs[:3, 3]))


def _candidate_yaw_distance_rad(lhs: NDArray[np.float64], rhs: NDArray[np.float64]) -> float:
    return float(abs(normalize_angle(_yaw_from_T(lhs) - _yaw_from_T(rhs))))


def _orientation_yaw_deg(
    orientation: tuple[float, float, float, float],
) -> float:
    yaw_rad = _yaw_from_T(pose_to_matrix((0.0, 0.0, 0.0), orientation))
    return round(math.degrees(yaw_rad), 2)


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
    mean_translation_error = (
        sum(
            _candidate_translation_distance_m(sample.T_world_odom, candidate.T_world_odom)
            for sample in cluster
        )
        / cluster_size
    )
    mean_yaw_error = (
        sum(
            _candidate_yaw_distance_rad(sample.T_world_odom, candidate.T_world_odom)
            for sample in cluster
        )
        / cluster_size
    )
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
    translation: NDArray[np.float64],
) -> NDArray[np.float64]:
    x_axis = np.array(
        [math.cos(yaw_rad), 0.0, -math.sin(yaw_rad)],
        dtype=np.float64,
    )
    z_axis = np.array([0.0, 1.0, 0.0], dtype=np.float64)
    y_axis = np.cross(z_axis, x_axis)
    T: NDArray[np.float64] = np.eye(4, dtype=np.float64)
    T[:3, 0] = x_axis
    T[:3, 1] = y_axis
    T[:3, 2] = z_axis
    T[:3, 3] = translation
    return T


def average_cluster_transform(
    cluster: list[AlignmentCandidate],
) -> tuple[NDArray[np.float64], float, float]:
    """Average gravity-leveled cluster members; return (T, yaw_spread_rad, trans_spread_m)."""
    if not cluster:
        raise ValueError("cluster must not be empty")
    leveled = [
        gravity_level_transform(np.array(sample.T_world_odom, dtype=np.float64, copy=True))
        for sample in cluster
    ]
    yaws = [_yaw_from_T(T) for T in leveled]
    translations = np.array([T[:3, 3] for T in leveled], dtype=np.float64)
    mean_yaw = _circular_mean_rad(yaws)
    mean_translation = np.mean(translations, axis=0)
    T_avg = _matrix_from_yaw_and_translation(mean_yaw, mean_translation)
    yaw_spread = max(abs(normalize_angle(yaw - mean_yaw)) for yaw in yaws) if len(yaws) > 1 else 0.0
    trans_spread = (
        float(np.max(np.linalg.norm(translations - mean_translation, axis=1)))
        if len(translations) > 1
        else 0.0
    )
    return T_avg, yaw_spread, trans_spread


@dataclass(frozen=True)
class TagMount:
    tag_id: int
    size_m: float = TAG_BLACK_SIZE_M
    position: tuple[float, float, float] = (0.0, 0.0, 0.0)
    orientation: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 1.0)

    @property
    def T_base_tag(self) -> NDArray[np.float64]:
        return pose_to_matrix(self.position, self.orientation)


@dataclass
class TagObservation:
    mono_ts: float
    tag_id: int
    p_world_tag: tuple[float, float, float]
    p_odom_tag: tuple[float, float, float]
    T_world_tag: NDArray[np.float64]
    T_odom_tag: NDArray[np.float64]
    quality: float
    reprojection_error_px: float


@dataclass
class TagSolve:
    T_world_odom: NDArray[np.float64]
    method: str
    quality: float
    observation_count: int
    baseline_m: float


@dataclass
class FrameResult:
    tag_detected: bool
    tag_ids: list[int]
    quality: float | None
    observations_added: int


@dataclass
class TagTrackerConfig:
    max_reprojection_error_px: float = 3.0
    max_distance_m: float = 6.0
    min_baseline_m: float = 0.30
    window_max_obs: int = 40
    window_max_age_s: float = 120.0
    innovation_gate_m: float = 1.5
    relocalize_cluster_m: float = 0.2
    relocalize_consecutive: int = 3


class TagTracker:
    def __init__(
        self,
        mounts: list[TagMount],
        *,
        config: TagTrackerConfig | None = None,
        camera_info: CameraInfo | None = None,
    ) -> None:
        self._mounts = {m.tag_id: m for m in mounts}
        self._config = config or TagTrackerConfig()
        self._camera_info = camera_info
        self._detector = create_aruco_detector(DEFAULT_APRILTAG_DICT)
        self._lock = threading.RLock()
        self._observations: deque[TagObservation] = deque(maxlen=self._config.window_max_obs)
        self._active = False
        self._last_tag_detected = False
        self._last_tag_ids: list[int] = []
        self._last_quality: float | None = None

    @property
    def active(self) -> bool:
        with self._lock:
            return self._active

    @active.setter
    def active(self, value: bool) -> None:
        with self._lock:
            self._active = value
            if not value:
                self.reset_window()

    def reset_window(self) -> None:
        with self._lock:
            self._observations.clear()
            self._last_tag_detected = False
            self._last_tag_ids = []
            self._last_quality = None

    def set_camera_info(self, info: CameraInfo) -> None:
        with self._lock:
            self._camera_info = info

    def has_camera_info(self) -> bool:
        with self._lock:
            return self._camera_info is not None

    @property
    def last_tag_detected(self) -> bool:
        with self._lock:
            return self._last_tag_detected

    @property
    def last_tag_ids(self) -> list[int]:
        with self._lock:
            return list(self._last_tag_ids)

    @property
    def last_quality(self) -> float | None:
        with self._lock:
            return self._last_quality

    def observation_count(self) -> int:
        with self._lock:
            return len(self._observations)

    def _prune_old(self, now_mono: float) -> None:
        cutoff = now_mono - self._config.window_max_age_s
        while self._observations and self._observations[0].mono_ts < cutoff:
            self._observations.popleft()

    def process_frame(
        self,
        header: dict[str, Any],
        jpeg: bytes,
        odom_lookup: Callable[[float], OdomSample | None],
        *,
        receive_mono: float | None = None,
        T_committed: NDArray[np.float64] | None = None,
        registered: bool = False,
    ) -> FrameResult:
        recv_mono = receive_mono if receive_mono is not None else time.monotonic()
        frame_age = float(header["send_ts"]) - float(header["ts"])
        odom_ts = recv_mono - max(0.0, frame_age)
        odom = odom_lookup(odom_ts)

        with self._lock:
            camera_info = self._camera_info
            mounts = dict(self._mounts)

        if camera_info is None:
            logger.warning("Tag frame skipped: no camera intrinsics yet", seq=header.get("seq"))
            return FrameResult(False, [], None, 0)
        if odom is None:
            logger.info(
                "Tag frame skipped: no odom at capture time",
                seq=header.get("seq"),
            )
            return FrameResult(False, [], None, 0)

        gray = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_GRAYSCALE)
        if gray is None:
            logger.warning(
                "Tag frame JPEG decode failed",
                seq=header.get("seq"),
                jpeg_bytes=len(jpeg),
            )
            return FrameResult(False, [], None, 0)

        camera_matrix, dist_coeffs = camera_info_to_cv_matrices(camera_info)
        corners_list, ids, _ = self._detector.detectMarkers(gray)
        if ids is None or len(ids) == 0:
            with self._lock:
                self._last_tag_detected = False
                self._last_tag_ids = []
            if _TRACE:
                logger.debug("Tag frame: no markers detected", seq=header.get("seq"))
            return FrameResult(False, [], None, 0)

        detected_tag_ids = [int(tag_id_arr[0]) for tag_id_arr in ids]
        if _TRACE:
            logger.debug(
                "Tag frame: markers detected",
                seq=header.get("seq"),
                tag_ids=detected_tag_ids,
            )

        T_world_glcam = pose_to_matrix(
            tuple(header["cam_pos"]),
            tuple(header["cam_rot"]),
        )
        T_odom_base = pose_to_matrix(odom.position, odom.orientation)

        detected_ids: list[int] = []
        best_quality = 0.0
        added = 0

        for corners, tag_id_arr in zip(corners_list, ids, strict=False):
            tag_id = int(tag_id_arr[0])
            mount = mounts.get(tag_id)
            if mount is None:
                continue
            pose = estimate_marker_pose(
                corners,
                mount.size_m,
                camera_matrix,
                dist_coeffs,
            )
            if pose is None:
                continue
            rvec, tvec = pose
            reproj = reprojection_error_px(
                corners,
                mount.size_m,
                rvec,
                tvec,
                camera_matrix,
                dist_coeffs,
            )
            if reproj > self._config.max_reprojection_error_px:
                continue
            dist_cam = float(np.linalg.norm(tvec.reshape(3)))
            if dist_cam > self._config.max_distance_m:
                continue

            T_camera_tag = _rvec_tvec_to_matrix(rvec, tvec)
            T_world_tag = T_world_glcam @ FLIP_YZ @ T_camera_tag
            T_odom_tag = T_odom_base @ mount.T_base_tag
            p_world = (
                float(T_world_tag[0, 3]),
                float(T_world_tag[1, 3]),
                float(T_world_tag[2, 3]),
            )
            p_odom = (
                float(T_odom_tag[0, 3]),
                float(T_odom_tag[1, 3]),
                float(T_odom_tag[2, 3]),
            )
            quality = max(0.0, min(1.0, 1.0 - reproj / self._config.max_reprojection_error_px))

            if registered and T_committed is not None:
                T_candidate = T_world_tag @ np.linalg.inv(T_odom_tag)
                T_candidate = gravity_level_transform(T_candidate)
                implied_base = T_candidate @ T_odom_base
                committed_base = T_committed @ T_odom_base
                innov = float(np.linalg.norm(implied_base[:3, 3] - committed_base[:3, 3]))
                if innov > self._config.innovation_gate_m:
                    with self._lock:
                        recent = list(self._observations)[-self._config.relocalize_consecutive :]
                    if len(recent) < self._config.relocalize_consecutive:
                        continue
                    spread = max(
                        float(
                            np.linalg.norm(
                                np.array(recent[i].p_world_tag) - np.array(recent[j].p_world_tag)
                            )
                        )
                        for i in range(len(recent))
                        for j in range(i + 1, len(recent))
                    )
                    if spread > self._config.relocalize_cluster_m:
                        continue

            obs = TagObservation(
                mono_ts=recv_mono,
                tag_id=tag_id,
                p_world_tag=p_world,
                p_odom_tag=p_odom,
                T_world_tag=T_world_tag,
                T_odom_tag=T_odom_tag,
                quality=quality,
                reprojection_error_px=reproj,
            )
            with self._lock:
                self._prune_old(recv_mono)
                self._observations.append(obs)
            detected_ids.append(tag_id)
            best_quality = max(best_quality, quality)
            added += 1

        with self._lock:
            self._last_tag_detected = len(detected_ids) > 0
            self._last_tag_ids = detected_ids
            self._last_quality = best_quality if detected_ids else None

        return FrameResult(
            tag_detected=len(detected_ids) > 0,
            tag_ids=detected_ids,
            quality=best_quality if detected_ids else None,
            observations_added=added,
        )

    def current_solve(self) -> TagSolve | None:
        with self._lock:
            observations = list(self._observations)

        if not observations:
            return None

        baseline = _ground_baseline_m(observations)
        if baseline >= self._config.min_baseline_m and len(observations) >= 2:
            u = np.array(
                [(o.p_odom_tag[0], o.p_odom_tag[1]) for o in observations],
                dtype=np.float64,
            )
            v = np.array(
                [(o.p_world_tag[0], -o.p_world_tag[2]) for o in observations],
                dtype=np.float64,
            )
            yaw, t2 = solve_yaw_translation_2d(u, v)
            mean_world_y = float(np.mean([o.p_world_tag[1] for o in observations]))
            mean_odom_z = float(np.mean([o.p_odom_tag[2] for o in observations]))
            t_world = (float(t2[0]), mean_world_y - mean_odom_z, -float(t2[1]))
            T = build_T_world_odom(yaw, t_world)
            T = gravity_level_transform(T)
            quality = float(np.mean([o.quality for o in observations]))
            return TagSolve(
                T_world_odom=T,
                method="tag",
                quality=quality,
                observation_count=len(observations),
                baseline_m=baseline,
            )
        return None

    def baseline_m(self) -> float:
        with self._lock:
            return _ground_baseline_m(list(self._observations))

    def robot_world_pose_estimate(
        self,
    ) -> tuple[tuple[float, float, float], tuple[float, float, float, float], float] | None:
        """Estimate robot base pose in world frame from recent tag observations.

        Returns:
            (position_xyz, orientation_xyzw, confidence) or None if no
            observations are available.  Heading is gravity-leveled and averaged
            using circular mean.  Confidence is mean observation quality (0–1).
        """
        with self._lock:
            observations = list(self._observations)
            mounts = dict(self._mounts)
        if not observations:
            return None
        positions = []
        yaws = []
        qualities = []
        for obs in observations:
            mount = mounts.get(obs.tag_id)
            if mount is None:
                continue
            T_world_tag = obs.T_world_tag
            T_world_base = gravity_level_transform(T_world_tag @ np.linalg.inv(mount.T_base_tag))
            positions.append(T_world_base[:3, 3])
            yaws.append(_yaw_from_T(T_world_base))
            qualities.append(obs.quality)
        if not positions:
            return None
        mean_pos = np.mean(positions, axis=0)
        sin_sum = sum(math.sin(y) for y in yaws)
        cos_sum = sum(math.cos(y) for y in yaws)
        mean_yaw = math.atan2(sin_sum, cos_sum)
        cy, sy = math.cos(mean_yaw / 2), math.sin(mean_yaw / 2)
        orientation = (0.0, float(sy), 0.0, float(cy))
        confidence = float(np.mean(qualities))
        return (
            (float(mean_pos[0]), float(mean_pos[1]), float(mean_pos[2])),
            orientation,
            confidence,
        )
