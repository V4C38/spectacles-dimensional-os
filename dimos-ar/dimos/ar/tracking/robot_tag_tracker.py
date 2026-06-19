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
from typing import TYPE_CHECKING, Any, Literal

_TRACE = os.getenv("DIMOS_AR_TRACE", "") not in ("", "0", "false")

import cv2
import numpy as np

from dimos.ar.tracking.transforms import (
    OdomSample,
    gravity_level_transform,
    pose_to_matrix,
    up_axis_angle_deg,
)
from dimos.msgs.sensor_msgs.CameraInfo import CameraInfo
from dimos.perception.fiducial.marker_tf_module import (
    camera_info_to_cv_matrices,
    create_aruco_detector,
    estimate_marker_pose,
)
from dimos.utils.logging_config import setup_logger

if TYPE_CHECKING:
    from numpy.typing import NDArray

logger = setup_logger()

create_apriltag_detector = create_aruco_detector

# One-shot mount-offset diagnostic (see _maybe_log_mount_offset_diagnostic).
_MOUNT_OFFSET_DIAG_EMITTED: bool = False
_MOUNT_OFFSET_DIAG_LOCK = threading.Lock()
_MOUNT_OFFSET_DIAG_INTERVAL_S: float = 30.0
_MOUNT_OFFSET_DIAG_LAST_MONO: float = 0.0

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
    def _require_finite_number(header: dict[str, Any], key: str) -> float:
        value = header.get(key)
        if not isinstance(value, (int, float)) or not math.isfinite(float(value)):
            raise ValueError(f"camera_frame invalid {key}")
        return float(value)

    def _require_finite_vector(
        header: dict[str, Any], key: str, *, length: int
    ) -> tuple[float, ...]:
        value = header.get(key)
        if not isinstance(value, list) or len(value) != length:
            raise ValueError(f"camera_frame invalid {key}")
        parsed: list[float] = []
        for item in value:
            if not isinstance(item, (int, float)) or not math.isfinite(float(item)):
                raise ValueError(f"camera_frame invalid {key}")
            parsed.append(float(item))
        return tuple(parsed)

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
    if not isinstance(header["robot_id"], str) or len(header["robot_id"]) == 0:
        raise ValueError("camera_frame invalid robot_id")
    header["seq"] = int(_require_finite_number(header, "seq"))
    header["ts"] = _require_finite_number(header, "ts")
    header["send_ts"] = _require_finite_number(header, "send_ts")
    header["cam_pos"] = _require_finite_vector(header, "cam_pos", length=3)
    header["cam_rot"] = _require_finite_vector(header, "cam_rot", length=4)
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


def _odom_tag_straightness(observations: list[TagObservation]) -> float:
    """Path straightness from odom-tag XY spread (0 = straight, →1 = curved)."""
    if len(observations) < 2:
        return 1.0
    u = np.array(
        [(o.p_odom_tag[0], o.p_odom_tag[1]) for o in observations],
        dtype=np.float64,
    )
    u_c = u - u.mean(axis=0)
    cov = (u_c.T @ u_c) / len(u_c)
    lam2, lam1 = sorted(np.linalg.eigvalsh(cov))
    if lam1 <= 1e-9:
        return 1.0
    return float(math.sqrt(lam2 / lam1))


def _yaw_from_T(T: NDArray[np.float64]) -> float:
    """Heading of T's forward (x) axis. Convention: forward = (cos th, 0, -sin th).

    Sign-consistent with build_T_world_odom, normalize_ground_pose, and the
    Lens-side MathUtils.yawRotationFromPlanarDirection.
    """
    forward = T[:3, 0]
    return math.atan2(-float(forward[2]), float(forward[0]))


def _orientation_yaw_deg(
    orientation: tuple[float, float, float, float],
) -> float:
    yaw_rad = _yaw_from_T(pose_to_matrix((0.0, 0.0, 0.0), orientation))
    return round(math.degrees(yaw_rad), 2)


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
    T_odom_base: NDArray[np.float64]
    quality: float
    reprojection_error_px: float


@dataclass
class TagSolve:
    T_world_odom: NDArray[np.float64]
    method: str
    quality: float
    observation_count: int
    baseline_m: float
    straightness: float = 1.0


@dataclass
class FrameResult:
    tag_detected: bool
    tag_ids: list[int]
    quality: float | None
    observations_added: int
    # Counts of per-observation rejections in the registered runtime path,
    # populated only when process_frame is called with registered=True.
    rejections_reprojection: int = 0
    rejections_distance: int = 0
    rejections_up_tilt: int = 0
    rejections_mount_residual: int = 0
    rejections_innovation: int = 0


_RejectionKey = Literal["reproj", "dist", "tilt", "mount", "innov"]


@dataclass
class RejectionSummary:
    reprojection: int = 0
    distance: int = 0
    up_tilt: int = 0
    mount_residual: int = 0
    innovation: int = 0

    def record(self, key: _RejectionKey) -> None:
        if key == "reproj":
            self.reprojection += 1
        elif key == "dist":
            self.distance += 1
        elif key == "tilt":
            self.up_tilt += 1
        elif key == "mount":
            self.mount_residual += 1
        elif key == "innov":
            self.innovation += 1


@dataclass
class RobotAprilTagTrackerConfig:
    max_reprojection_error_px: float = 3.0
    max_distance_m: float = 6.0
    min_baseline_m: float = 0.15
    window_max_obs: int = 40
    window_max_age_s: float = 120.0
    innovation_gate_m: float = 1.5
    relocalize_cluster_m: float = 0.2
    relocalize_consecutive: int = 3
    max_mount_residual_m: float = 0.5
    max_up_axis_tilt_deg: float = 85.0


class RobotAprilTagTracker:
    def __init__(
        self,
        mounts: list[TagMount],
        *,
        config: RobotAprilTagTrackerConfig | None = None,
        camera_info: CameraInfo | None = None,
    ) -> None:
        self._mounts = {m.tag_id: m for m in mounts}
        self._config = config or RobotAprilTagTrackerConfig()
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

    def _try_accept_robot_tag(
        self,
        *,
        corners: Any,
        tag_id: int,
        mount: TagMount,
        camera_matrix: NDArray[np.float64],
        dist_coeffs: NDArray[np.float64],
        T_world_glcam: NDArray[np.float64],
        T_odom_base: NDArray[np.float64],
        recv_mono: float,
        registered: bool,
        T_committed: NDArray[np.float64] | None,
    ) -> tuple[TagObservation | None, _RejectionKey | None]:
        pose = estimate_marker_pose(
            corners,
            mount.size_m,
            camera_matrix,
            dist_coeffs,
        )
        if pose is None:
            return None, None
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
            return None, "reproj"
        dist_cam = float(np.linalg.norm(tvec.reshape(3)))
        if dist_cam > self._config.max_distance_m:
            return None, "dist"

        T_camera_tag = _rvec_tvec_to_matrix(rvec, tvec)
        T_world_tag = T_world_glcam @ FLIP_YZ @ T_camera_tag
        T_odom_tag = T_odom_base @ mount.T_base_tag
        T_candidate_raw = T_world_tag @ np.linalg.inv(T_odom_tag)
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
            up_tilt_deg = up_axis_angle_deg(T_candidate_raw)
            if up_tilt_deg > self._config.max_up_axis_tilt_deg:
                return None, "tilt"
            measured_mount = self._measured_mount_position(
                T_world_tag=T_world_tag,
                T_odom_base=T_odom_base,
                T_world_odom=T_candidate_raw,
            )
            mount_residual = float(
                np.linalg.norm(measured_mount - np.asarray(mount.position, dtype=np.float64))
            )
            if mount_residual > self._config.max_mount_residual_m:
                return None, "mount"
            T_candidate = gravity_level_transform(T_candidate_raw)
            implied_base = T_candidate @ T_odom_base
            committed_base = T_committed @ T_odom_base
            innov = float(np.linalg.norm(implied_base[:3, 3] - committed_base[:3, 3]))
            if innov > self._config.innovation_gate_m:
                with self._lock:
                    recent = list(self._observations)[-self._config.relocalize_consecutive :]
                if len(recent) < self._config.relocalize_consecutive:
                    return None, "innov"
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
                    return None, "innov"

        return TagObservation(
            mono_ts=recv_mono,
            tag_id=tag_id,
            p_world_tag=p_world,
            p_odom_tag=p_odom,
            T_world_tag=T_world_tag,
            T_odom_tag=T_odom_tag,
            T_odom_base=np.array(T_odom_base, dtype=np.float64, copy=True),
            quality=quality,
            reprojection_error_px=reproj,
        ), None

    def process_frame(
        self,
        header: dict[str, Any],
        jpeg: bytes,
        *,
        odom: OdomSample | None = None,
        receive_mono: float | None = None,
        T_committed: NDArray[np.float64] | None = None,
        registered: bool = False,
    ) -> FrameResult:
        recv_mono = receive_mono if receive_mono is not None else time.monotonic()

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
        rejections = RejectionSummary()

        for corners, tag_id_arr in zip(corners_list, ids, strict=False):
            tag_id = int(tag_id_arr[0])
            mount = mounts.get(tag_id)
            if mount is None:
                continue
            obs, rejection = self._try_accept_robot_tag(
                corners=corners,
                tag_id=tag_id,
                mount=mount,
                camera_matrix=camera_matrix,
                dist_coeffs=dist_coeffs,
                T_world_glcam=T_world_glcam,
                T_odom_base=T_odom_base,
                recv_mono=recv_mono,
                registered=registered,
                T_committed=T_committed,
            )
            if rejection is not None:
                rejections.record(rejection)
                continue
            if obs is None:
                continue
            with self._lock:
                self._prune_old(recv_mono)
                self._observations.append(obs)
            detected_ids.append(tag_id)
            best_quality = max(best_quality, obs.quality)
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
            rejections_reprojection=rejections.reprojection,
            rejections_distance=rejections.distance,
            rejections_up_tilt=rejections.up_tilt,
            rejections_mount_residual=rejections.mount_residual,
            rejections_innovation=rejections.innovation,
        )

    def _measured_mount_position(
        self,
        *,
        T_world_tag: NDArray[np.float64],
        T_odom_base: NDArray[np.float64],
        T_world_odom: NDArray[np.float64],
    ) -> NDArray[np.float64]:
        T_odom_world = np.linalg.inv(np.asarray(T_world_odom, dtype=np.float64))
        T_odom_tag_meas = T_odom_world @ T_world_tag
        p_odom_tag_meas = T_odom_tag_meas[:3, 3]
        R_odom_base = T_odom_base[:3, :3]
        p_odom_base = T_odom_base[:3, 3]
        return R_odom_base.T @ (p_odom_tag_meas - p_odom_base)

    def current_solve(
        self,
        *,
        min_baseline_m: float | None = None,
        max_age_s: float | None = None,
        max_observations: int | None = None,
    ) -> TagSolve | None:
        with self._lock:
            observations = list(self._observations)

        if not observations:
            return None

        if max_age_s is not None:
            newest = observations[-1].mono_ts
            cutoff = newest - max_age_s
            observations = [o for o in observations if o.mono_ts >= cutoff]
        if max_observations is not None and len(observations) > max_observations:
            observations = observations[-max_observations:]

        if not observations:
            return None

        effective_min_baseline = min_baseline_m if min_baseline_m is not None else self._config.min_baseline_m
        baseline = _ground_baseline_m(observations)
        straightness = _odom_tag_straightness(observations)
        if len(observations) >= 2 and baseline >= effective_min_baseline:
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
                straightness=straightness,
            )
        return None

    def baseline_m(self) -> float:
        with self._lock:
            return _ground_baseline_m(list(self._observations))

    def _maybe_log_mount_offset_diagnostic(
        self,
        obs: TagObservation,
        mount: TagMount,
        T_world_odom: NDArray[np.float64],
    ) -> None:
        """Log measured base->tag offset vs configured mount.position (rate-limited).

        Uses the committed world<-odom transform and a vision-derived tag pose so
        the residual reflects true lever-arm error rather than the mount model.
        """
        global _MOUNT_OFFSET_DIAG_EMITTED, _MOUNT_OFFSET_DIAG_LAST_MONO

        T_world_odom = np.asarray(T_world_odom, dtype=np.float64)
        if not np.all(np.isfinite(T_world_odom)):
            return

        T_odom_world = np.linalg.inv(T_world_odom)
        T_odom_tag_meas = T_odom_world @ obs.T_world_tag
        p_odom_tag_meas = T_odom_tag_meas[:3, 3]

        R_odom_base = obs.T_odom_base[:3, :3]
        p_odom_base = obs.T_odom_base[:3, 3]
        measured_p_base_tag = R_odom_base.T @ (p_odom_tag_meas - p_odom_base)

        configured = np.asarray(mount.position, dtype=np.float64)
        residual = measured_p_base_tag - configured

        R_world_odom = T_world_odom[:3, :3]
        p_world_tag = obs.T_world_tag[:3, 3]
        p_base_tag = configured
        p_world_base_from_mount = p_world_tag - (R_world_odom @ R_odom_base) @ p_base_tag

        now = time.monotonic()
        with _MOUNT_OFFSET_DIAG_LOCK:
            emit_one_shot = not _MOUNT_OFFSET_DIAG_EMITTED
            emit_periodic = now - _MOUNT_OFFSET_DIAG_LAST_MONO >= _MOUNT_OFFSET_DIAG_INTERVAL_S
            if not emit_one_shot and not emit_periodic:
                return
            if emit_one_shot:
                _MOUNT_OFFSET_DIAG_EMITTED = True
            _MOUNT_OFFSET_DIAG_LAST_MONO = now

        logger.info(
            "tag_mount_offset diagnostic tag_id=%s "
            "measured_base_to_tag=%s configured_mount.position=%s residual=%s "
            "p_world_tag=%s p_world_base_from_mount=%s",
            mount.tag_id,
            np.array2string(measured_p_base_tag, precision=4),
            np.array2string(configured, precision=4),
            np.array2string(residual, precision=4),
            np.array2string(p_world_tag, precision=4),
            np.array2string(p_world_base_from_mount, precision=4),
        )

    def current_translation_solve(
        self,
        T_reference: NDArray[np.float64],
        *,
        max_observations: int = 5,
    ) -> TagSolve | None:
        """Estimate a translation-only world<-odom update from recent tag sightings.

        This runtime path is intentionally separate from ``current_solve()``.
        ``current_solve()`` uses baseline across multiple odom-tag samples to
        recover yaw and translation; that geometry breaks down when the robot is
        stationary.  Here we preserve the committed gravity-levelled rotation
        from ``T_reference`` and solve only for translation from one or more
        robot-mounted tag observations.
        """
        with self._lock:
            observations = list(self._observations)[-max_observations:]
            mounts = dict(self._mounts)

        if not observations:
            return None

        T_keep = gravity_level_transform(np.array(T_reference, dtype=np.float64, copy=True))
        R_world_odom_keep = T_keep[:3, :3]

        translations: list[np.ndarray] = []
        qualities: list[float] = []
        for obs in observations:
            mount = mounts.get(obs.tag_id)
            if mount is None:
                continue
            self._maybe_log_mount_offset_diagnostic(obs, mount, T_keep)
            R_odom_base = obs.T_odom_base[:3, :3]
            p_odom_base = obs.T_odom_base[:3, 3]
            p_world_tag = obs.T_world_tag[:3, 3]
            p_base_tag = np.array(mount.position, dtype=np.float64)
            p_world_base = p_world_tag - (R_world_odom_keep @ R_odom_base) @ p_base_tag
            t_world_odom = p_world_base - R_world_odom_keep @ p_odom_base
            if not np.all(np.isfinite(t_world_odom)):
                continue
            translations.append(t_world_odom)
            qualities.append(max(obs.quality, 1e-3))

        if not translations:
            return None

        if len(translations) >= 3:
            arr = np.stack(translations, axis=0)
            center = np.median(arr, axis=0)
            dists = np.linalg.norm(arr - center, axis=1)
            keep_mask = dists <= self._config.relocalize_cluster_m
            if np.any(keep_mask):
                translations = [translations[i] for i, keep in enumerate(keep_mask) if keep]
                qualities = [qualities[i] for i, keep in enumerate(keep_mask) if keep]

        weights = np.asarray(qualities, dtype=np.float64)
        weights /= np.sum(weights)
        mean_translation = np.sum(
            np.stack(translations, axis=0) * weights[:, np.newaxis],
            axis=0,
        )
        T_new = np.array(T_keep, dtype=np.float64, copy=True)
        T_new[:3, 3] = mean_translation
        T_new = gravity_level_transform(T_new)
        window_obs = observations[-max_observations:] if max_observations else observations
        return TagSolve(
            T_world_odom=T_new,
            method="tag_translation",
            quality=float(np.mean(qualities)),
            observation_count=len(translations),
            baseline_m=_ground_baseline_m(window_obs),
            straightness=_odom_tag_straightness(window_obs),
        )

    def robot_world_pose_estimate(
        self,
        *,
        max_observations: int | None = None,
    ) -> tuple[tuple[float, float, float], tuple[float, float, float, float], float] | None:
        """Estimate robot base pose in world frame from recent tag observations.

        Returns:
            (position_xyz, orientation_xyzw, confidence) or None if no
            observations are available.  Heading is gravity-leveled and averaged
            using circular mean.  Confidence is mean observation quality (0-1).
        """
        with self._lock:
            observations = list(self._observations)
            mounts = dict(self._mounts)
        if max_observations is not None:
            observations = observations[-max_observations:]
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
