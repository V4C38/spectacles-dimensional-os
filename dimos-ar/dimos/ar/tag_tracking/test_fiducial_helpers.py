from __future__ import annotations

import numpy as np

from dimos.ar.tag_tracking.fiducial_helpers import (
    aruco_detected_tag_id,
    aruco_detected_tag_ids,
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
