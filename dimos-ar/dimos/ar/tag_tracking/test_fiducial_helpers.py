from __future__ import annotations

import numpy as np

from dimos.ar.tag_tracking.fiducial_helpers import (
    aruco_detected_tag_id,
    aruco_detected_tag_ids,
    estimate_marker_pose,
)


def test_aruco_detected_tag_id_accepts_scalar_layout() -> None:
    assert aruco_detected_tag_id(np.int32(7)) == 7


def test_aruco_detected_tag_id_accepts_row_vector_layout() -> None:
    assert aruco_detected_tag_id(np.array([7], dtype=np.int32)) == 7


def test_aruco_detected_tag_id_accepts_column_vector_layout() -> None:
    assert aruco_detected_tag_id(np.array([[7]], dtype=np.int32)) == 7


def test_aruco_detected_tag_ids_normalizes_mixed_layouts() -> None:
    ids = np.array([3, 9], dtype=np.int32)
    assert aruco_detected_tag_ids(ids) == [3, 9]


def test_estimate_marker_pose_returns_best_hypothesis_and_ambiguity_ratio(monkeypatch) -> None:
    monkeypatch.setattr(
        "cv2.solvePnPGeneric",
        lambda *_args, **_kwargs: (
            True,
            [
                np.array([[0.0], [0.0], [0.0]], dtype=np.float64),
                np.array([[0.1], [0.0], [0.0]], dtype=np.float64),
            ],
            [
                np.array([[0.0], [0.0], [1.0]], dtype=np.float64),
                np.array([[0.0], [0.0], [1.2]], dtype=np.float64),
            ],
            np.array([[0.5], [1.0]], dtype=np.float64),
        ),
    )
    corners = np.array([[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]], dtype=np.float32)
    camera_matrix = np.eye(3, dtype=np.float64)
    dist_coeffs = np.zeros((0, 1), dtype=np.float64)

    pose = estimate_marker_pose(corners, 0.1, camera_matrix, dist_coeffs)

    assert pose is not None
    rvec, tvec, ambiguity_ratio = pose
    assert np.allclose(rvec, np.array([[0.0], [0.0], [0.0]], dtype=np.float64))
    assert np.allclose(tvec, np.array([[0.0], [0.0], [1.0]], dtype=np.float64))
    assert ambiguity_ratio == 2.0
