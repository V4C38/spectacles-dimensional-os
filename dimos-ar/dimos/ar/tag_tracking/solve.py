"""AprilTag solve helpers: camera frames, similarity fitting, and observation types."""

from __future__ import annotations

from dataclasses import dataclass
import json
import math
import struct
from typing import TYPE_CHECKING, Any

import cv2
import numpy as np

from dimos.ar.world_frame.transforms import (
    gravity_level_transform,
    pose_to_matrix,
    yaw_from_T as _yaw_from_T,
)
from dimos.msgs.sensor_msgs.CameraInfo import CameraInfo
from dimos.utils.transform_utils import normalize_angle

__all__ = [
    "CAPTURE_MAX_DISTANCE_MARGIN",
    "_yaw_from_T",
    "capture_max_stream_distance_m",
    "max_detection_distance_m",
]

if TYPE_CHECKING:
    from numpy.typing import NDArray

DEFAULT_MARKER_ID: int = 0
DEFAULT_APRILTAG_DICT: str = "DICT_APRILTAG_36h11"
TAG_TOTAL_SIZE_M: float = 0.070
TAG_BLACK_SIZE_M: float = TAG_TOTAL_SIZE_M * 8 / 10  # 0.056 m — black detection square

# Headroom on pinhole max distance before sending capture_policy / applying frame gates.
CAPTURE_MAX_DISTANCE_MARGIN: float = 1.25


def max_detection_distance_m(fx: float, tag_size_m: float, min_tag_px: float) -> float:
    if fx <= 0.0 or tag_size_m <= 0.0 or min_tag_px <= 0.0:
        raise ValueError("max_detection_distance_m requires positive fx, tag_size_m, min_tag_px")
    return fx * tag_size_m / min_tag_px


def capture_max_stream_distance_m(
    fx: float,
    tag_size_m: float,
    min_tag_px: float,
    *,
    margin: float = CAPTURE_MAX_DISTANCE_MARGIN,
) -> float:
    if margin <= 0.0:
        raise ValueError("capture_max_stream_distance_m requires positive margin")
    return max_detection_distance_m(fx, tag_size_m, min_tag_px) * margin


CAMERA_FRAME_MAGIC = b"ARF1"
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
    frame_id: str = "ar_camera",
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


@dataclass(frozen=True)
class SimilaritySolve:
    yaw: float
    scale: float
    t2: NDArray[np.float64]
    resid_rms: float
    suu: float
    total_weight: float
    observation_count: int


def solve_similarity_2d(
    u: NDArray[np.float64],
    v: NDArray[np.float64],
    w: NDArray[np.float64],
) -> SimilaritySolve:
    """Weighted 2D similarity fit: raw odom XY -> world (X, -Z)."""
    if u.shape != v.shape or u.ndim != 2 or u.shape[1] != 2:
        raise ValueError("u and v must be Nx2 arrays with matching shape")
    if w.ndim != 1 or w.shape[0] != u.shape[0]:
        raise ValueError("w must be a length-N vector")
    if u.shape[0] < 2:
        raise ValueError("need at least 2 points")
    weights = np.asarray(w, dtype=np.float64)
    if not np.all(np.isfinite(weights)) or float(np.sum(weights)) <= 0.0:
        raise ValueError("weights must be finite and sum to > 0")
    total_weight = float(np.sum(weights))
    mean_u = np.sum(u * weights[:, np.newaxis], axis=0) / total_weight
    mean_v = np.sum(v * weights[:, np.newaxis], axis=0) / total_weight
    u_c = u - mean_u
    v_c = v - mean_v
    numerator = float(np.sum(weights * (u_c[:, 0] * v_c[:, 1] - u_c[:, 1] * v_c[:, 0])))
    denominator = float(np.sum(weights * (u_c[:, 0] * v_c[:, 0] + u_c[:, 1] * v_c[:, 1])))
    yaw = math.atan2(numerator, denominator)
    suu = float(np.sum(weights * np.sum(u_c * u_c, axis=1)))
    scale = math.hypot(numerator, denominator) / max(suu, 1e-9)
    c, s = math.cos(yaw), math.sin(yaw)
    r2 = np.array([[c, -s], [s, c]], dtype=np.float64)
    t2 = mean_v - scale * (r2 @ mean_u)
    residuals = np.linalg.norm(v - ((scale * (r2 @ u.T)).T + t2), axis=1)
    resid_rms = math.sqrt(float(np.sum(weights * residuals * residuals)) / total_weight)
    return SimilaritySolve(
        yaw=yaw,
        scale=scale,
        t2=t2,
        resid_rms=resid_rms,
        suu=suu,
        total_weight=total_weight,
        observation_count=u.shape[0],
    )


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


def _view_baseline_m(observations: list[TagObservation]) -> float:
    """Max pairwise camera-position spread (Spectacles motion during static registration)."""
    positions: list[NDArray[np.float64]] = []
    for obs in observations:
        if obs.cam_pos is None:
            continue
        positions.append(np.asarray(obs.cam_pos, dtype=np.float64))
    if len(positions) < 2:
        return _implied_yaw_baseline_m(observations)
    max_dist = 0.0
    for i in range(len(positions)):
        for j in range(i + 1, len(positions)):
            d = float(np.linalg.norm(positions[i] - positions[j]))
            max_dist = max(max_dist, d)
    return max_dist


def _implied_yaw_baseline_m(observations: list[TagObservation]) -> float:
    """Fallback view baseline from per-observation implied yaw spread."""
    yaws: list[float] = []
    for obs in observations:
        T_raw = obs.T_world_tag @ np.linalg.inv(obs.T_odom_tag)
        T = gravity_level_transform(T_raw)
        yaws.append(_yaw_from_T(T))
    if len(yaws) < 2:
        return 0.0
    max_dyaw = 0.0
    for i in range(len(yaws)):
        for j in range(i + 1, len(yaws)):
            dyaw = abs(normalize_angle(yaws[i] - yaws[j]))
            max_dyaw = max(max_dyaw, dyaw)
    return max_dyaw * 2.0


@dataclass(frozen=True)
class RegistrationPoseAggregate:
    yaw_rad: float
    translation_world: tuple[float, float, float]
    resid_rms_m: float


def aggregate_registration_pose(
    observations: list[TagObservation],
    weights: NDArray[np.float64],
) -> RegistrationPoseAggregate:
    """Weighted mean of per-observation world←odom poses (static robot / camera motion)."""
    w = np.asarray(weights, dtype=np.float64)
    total_weight = float(np.sum(w))
    if total_weight <= 0.0 or len(observations) < 1:
        raise ValueError("aggregate_registration_pose needs positive weights and observations")

    yaws: list[float] = []
    translations: list[NDArray[np.float64]] = []
    for obs, _weight in zip(observations, w, strict=True):
        T_raw = obs.T_world_tag @ np.linalg.inv(obs.T_odom_tag)
        T = gravity_level_transform(T_raw)
        yaws.append(_yaw_from_T(T))
        translations.append(np.asarray(T[:3, 3], dtype=np.float64))

    sin_sum = float(np.sum(w * np.sin(yaws)))
    cos_sum = float(np.sum(w * np.cos(yaws)))
    mean_yaw = math.atan2(sin_sum, cos_sum)
    mean_trans = np.sum(np.stack(translations) * w[:, np.newaxis], axis=0) / total_weight

    sq_err = 0.0
    for yaw, trans, weight in zip(yaws, translations, w, strict=True):
        dyaw = normalize_angle(yaw - mean_yaw)
        pos_err = float(np.linalg.norm(trans - mean_trans))
        err = math.hypot(dyaw, pos_err)
        sq_err += float(weight) * err * err
    resid_rms = math.sqrt(sq_err / total_weight)

    return RegistrationPoseAggregate(
        yaw_rad=mean_yaw,
        translation_world=(
            float(mean_trans[0]),
            float(mean_trans[1]),
            float(mean_trans[2]),
        ),
        resid_rms_m=resid_rms,
    )


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


def orientation_yaw_deg(
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
    dist_cam_m: float = 0.0
    ambiguity_ratio: float = 1.0
    pair_skew_s: float = 0.0
    capture_ts_robot: float | None = None
    cam_pos: tuple[float, float, float] | None = None


