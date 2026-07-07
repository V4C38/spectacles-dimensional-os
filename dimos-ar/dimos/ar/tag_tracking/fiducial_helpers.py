"""AprilTag pose helpers aligned with DimOS ``fiducial.marker_tf_module``.

Vendored in dimos-ar so unit tests run against PyPI dimos without depending on
upstream fiducial packaging layout. Keep in sync when DimOS updates these helpers.
"""

from __future__ import annotations

import cv2
import numpy as np

from dimos.msgs.sensor_msgs.CameraInfo import CameraInfo

_FISHEYE_MODELS = frozenset({"equidistant", "fisheye", "kannala_brandt"})


def _is_fisheye_model(distortion_model: str | None) -> bool:
    return (distortion_model or "").strip().lower() in _FISHEYE_MODELS


def camera_info_to_cv_matrices(camera_info: CameraInfo) -> tuple[np.ndarray, np.ndarray]:
    """Build OpenCV ``cameraMatrix`` and ``distCoeffs`` from ``CameraInfo``."""
    k = np.array(camera_info.K, dtype=np.float64).reshape(3, 3)
    d = np.array(camera_info.D if camera_info.D else [], dtype=np.float64).reshape(-1, 1)
    return k, d


def _aruco_marker_object_points(marker_length_m: float) -> np.ndarray:
    """Corner order matches OpenCV ArUco / solvePnP convention (planar square, Z=0)."""
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


def estimate_marker_pose(
    corners_px: np.ndarray,
    marker_length_m: float,
    camera_matrix: np.ndarray,
    dist_coeffs: np.ndarray,
    *,
    distortion_model: str | None = None,
) -> tuple[np.ndarray, np.ndarray] | None:
    """Return ``(rvec, tvec)`` for camera optical <- marker from undistorted solvePnP."""
    obj = _aruco_marker_object_points(marker_length_m)
    img: np.ndarray = corners_px.reshape(4, 1, 2).astype(np.float32)
    if _is_fisheye_model(distortion_model):
        d_flat = np.asarray(dist_coeffs, dtype=np.float64).reshape(-1)
        if d_flat.size < 4:
            raise ValueError(
                f"Fisheye/equidistant distortion model requires at least 4 coefficients; "
                f"got {d_flat.size}. Check CameraInfo.D."
            )
        d_fisheye = d_flat[:4].reshape(4, 1)
        img = cv2.fisheye.undistortPoints(img, camera_matrix, d_fisheye, P=camera_matrix)
        solve_dist: np.ndarray = np.zeros((0, 1), dtype=np.float64)
    else:
        solve_dist = dist_coeffs
    ok, rvec, tvec = cv2.solvePnP(
        obj,
        img,
        camera_matrix,
        solve_dist,
        flags=cv2.SOLVEPNP_IPPE_SQUARE,
    )
    if not ok:
        return None
    return rvec, tvec


def aruco_detected_tag_id(tag_id_entry: np.ndarray | int | float) -> int:
    """Normalize one ``detectMarkers`` id entry to ``int`` across OpenCV layouts."""
    arr = np.asarray(tag_id_entry)
    if arr.ndim == 0:
        return int(arr)
    return int(arr.reshape(-1)[0])


def aruco_detected_tag_ids(ids: np.ndarray) -> list[int]:
    """Normalize the full ``detectMarkers`` ids array to a list of ints."""
    return [aruco_detected_tag_id(tag_id_entry) for tag_id_entry in ids]


def create_aruco_detector(dictionary_name: str) -> cv2.aruco.ArucoDetector:
    if not hasattr(cv2.aruco, dictionary_name):
        raise ValueError(f"Unknown ArUco dictionary {dictionary_name!r}")
    dictionary = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, dictionary_name))
    parameters = cv2.aruco.DetectorParameters()
    return cv2.aruco.ArucoDetector(dictionary, parameters)
