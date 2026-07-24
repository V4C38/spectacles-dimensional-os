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
) -> tuple[np.ndarray, np.ndarray, float] | None:
    """Return best ``(rvec, tvec, ambiguity_ratio)`` from IPPE square hypotheses."""
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
    ok, rvecs, tvecs, reproj = cv2.solvePnPGeneric(
        obj,
        img,
        camera_matrix,
        solve_dist,
        flags=cv2.SOLVEPNP_IPPE_SQUARE,
    )
    if not ok:
        return None
    rvec_candidates = [np.asarray(candidate, dtype=np.float64) for candidate in rvecs]
    tvec_candidates = [np.asarray(candidate, dtype=np.float64) for candidate in tvecs]
    errors = (
        np.asarray(reproj, dtype=np.float64).reshape(-1)
        if reproj is not None
        else np.array([], dtype=np.float64)
    )
    if len(rvec_candidates) == 0 or len(tvec_candidates) == 0:
        return None
    if errors.size != len(rvec_candidates):
        errors = np.array(
            [
                np.sqrt(
                    np.mean(
                        np.sum(
                            (
                                corners_px.reshape(-1, 2)
                                - cv2.projectPoints(
                                    obj,
                                    rvec_candidate,
                                    tvec_candidate,
                                    camera_matrix,
                                    solve_dist,
                                )[0].reshape(-1, 2)
                            )
                            ** 2,
                            axis=1,
                        )
                    )
                )
                for rvec_candidate, tvec_candidate in zip(
                    rvec_candidates,
                    tvec_candidates,
                    strict=False,
                )
            ],
            dtype=np.float64,
        )
    order = np.argsort(errors)
    best_idx = int(order[0])
    best_rvec = rvec_candidates[best_idx]
    best_tvec = tvec_candidates[best_idx]
    ambiguity_ratio = 1.0
    if len(order) >= 2:
        best_error = max(float(errors[best_idx]), 1e-9)
        second_error = float(errors[int(order[1])])
        ambiguity_ratio = max(1.0, second_error / best_error)
    return best_rvec, best_tvec, ambiguity_ratio


def aruco_detected_tag_id(tag_id_entry: np.ndarray | float) -> int:
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
