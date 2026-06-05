from __future__ import annotations

from pathlib import Path

import cv2

from dimos_ar.marker_contract import (
    COMPOSITE_MARKER_HEIGHT_CM,
    COMPOSITE_MARKER_HEIGHT_M,
    COMPOSITE_MARKER_WIDTH_M,
    DEFAULT_APRILTAG_DICT,
    DEFAULT_MARKER_ID,
    DEFAULT_MARKER_LENGTH_M,
)
from scripts.generate_marker import DEFAULT_APRILTAG_DICT as GENERATED_APRILTAG_DICT
from scripts.generate_marker import (
    PHONE_MARKER_HEIGHT_M,
    PHONE_MARKER_WIDTH_M,
    generate_composite_marker_raster,
    generate_marker_raster,
)


def test_phone_marker_inner_tag_width_matches_runtime_alignment_size() -> None:
    assert PHONE_MARKER_WIDTH_M == DEFAULT_MARKER_LENGTH_M


def test_phone_marker_height_matches_composite_tracking_contract() -> None:
    assert PHONE_MARKER_HEIGHT_M == COMPOSITE_MARKER_HEIGHT_M


def test_generated_marker_dictionary_matches_runtime_dictionary() -> None:
    assert GENERATED_APRILTAG_DICT == DEFAULT_APRILTAG_DICT


def test_lens_marker_height_matches_composite_tracking_size() -> None:
    imgmarker = (
        Path(__file__).resolve().parents[2]
        / "lens-studio"
        / "Assets"
        / "TrackingMarkers"
        / "apriltag_marker.imgmarker"
    )
    assert f"MarkerHeight: {COMPOSITE_MARKER_HEIGHT_CM:.6f}" in imgmarker.read_text(
        encoding="utf-8"
    )


def test_generated_marker_texture_matches_composite_aspect_ratio() -> None:
    marker_png = Path(__file__).resolve().parent.parent / "assets" / "aruco_marker.png"
    marker = cv2.imread(str(marker_png), cv2.IMREAD_COLOR)
    assert marker is not None

    expected_ratio = COMPOSITE_MARKER_HEIGHT_M / COMPOSITE_MARKER_WIDTH_M
    actual_ratio = marker.shape[0] / marker.shape[1]
    assert abs(actual_ratio - expected_ratio) < 0.01


def test_generated_composite_marker_preserves_single_apriltag_detection_on_white_page() -> None:
    marker = generate_composite_marker_raster(generate_marker_raster())
    margin_px = 60
    page = cv2.copyMakeBorder(
        marker,
        margin_px,
        margin_px,
        margin_px,
        margin_px,
        borderType=cv2.BORDER_CONSTANT,
        value=(255, 255, 255),
    )
    detector = cv2.aruco.ArucoDetector(
        cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, DEFAULT_APRILTAG_DICT)),
        cv2.aruco.DetectorParameters(),
    )

    corners, ids, _rejected = detector.detectMarkers(cv2.cvtColor(page, cv2.COLOR_BGR2GRAY))
    assert ids is not None
    assert len(corners) == 1
    assert ids.shape == (1, 1)
    assert int(ids[0][0]) == DEFAULT_MARKER_ID
