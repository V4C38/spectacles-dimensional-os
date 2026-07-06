"""AprilTag solve helpers: camera frames, 2D Kabsch, and observation types."""

from __future__ import annotations

from dataclasses import dataclass
import json
import math
import struct
from typing import TYPE_CHECKING, Any

import cv2
import numpy as np

from dimos.ar.world_frame.transforms import pose_to_matrix, yaw_from_T as _yaw_from_T
from dimos.msgs.sensor_msgs.CameraInfo import CameraInfo

__all__ = [
    "_yaw_from_T",
]

if TYPE_CHECKING:
    from numpy.typing import NDArray

DEFAULT_MARKER_ID: int = 0
DEFAULT_APRILTAG_DICT: str = "DICT_APRILTAG_36h11"
TAG_TOTAL_SIZE_M: float = 0.070
TAG_BLACK_SIZE_M: float = TAG_TOTAL_SIZE_M * 8 / 10  # 0.056 m — black detection square

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
    lam2 = max(0.0, float(lam2))  # guard near-singular covariance numerical noise
    if lam1 <= 1e-9:
        return 1.0
    return float(math.sqrt(lam2 / lam1))


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


@dataclass
class TagSolve:
    T_world_odom: NDArray[np.float64]
    method: str
    quality: float
    observation_count: int
    baseline_m: float
    straightness: float = 1.0
