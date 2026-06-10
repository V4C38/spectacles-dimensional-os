from __future__ import annotations

from pathlib import Path

import cv2

from dimos_xr.marker_contract import (
    COMPOSITE_MARKER_HEIGHT_CM,
    COMPOSITE_MARKER_HEIGHT_M,
    COMPOSITE_MARKER_WIDTH_M,
    DEFAULT_APRILTAG_DICT,
    DEFAULT_MARKER_ID,
    DEFAULT_MARKER_LENGTH_M,
    MARKER_QUIET_ZONE_M,
)
from scripts.generate_marker import (
    A4_PAGE_MM,
    LENS_TEXTURE_MAX_PX,
    LETTER_PAGE_MM,
    generate_composite_marker_raster,
    generate_marker_raster,
)
from scripts.generate_marker import DEFAULT_APRILTAG_DICT as GENERATED_APRILTAG_DICT

# Minimum print margin per side at 100% scale (typical inkjet/laser dead zone).
_MIN_PRINT_MARGIN_MM = 9.0


def test_tag_with_quiet_zone_fits_composite() -> None:
    assert DEFAULT_MARKER_LENGTH_M + 2 * MARKER_QUIET_ZONE_M <= COMPOSITE_MARKER_WIDTH_M + 1e-9
    assert DEFAULT_MARKER_LENGTH_M + 2 * MARKER_QUIET_ZONE_M <= COMPOSITE_MARKER_HEIGHT_M + 1e-9


def test_quiet_zone_is_at_least_one_tag_module() -> None:
    # 36h11 with a one-module border is 8 modules across.
    module_m = DEFAULT_MARKER_LENGTH_M / 8.0
    assert MARKER_QUIET_ZONE_M >= module_m


def test_composite_prints_at_full_scale_on_a4_and_us_letter() -> None:
    width_mm = COMPOSITE_MARKER_WIDTH_M * 1000.0
    height_mm = COMPOSITE_MARKER_HEIGHT_M * 1000.0
    for page_w_mm, page_h_mm in (A4_PAGE_MM, LETTER_PAGE_MM):
        assert (page_w_mm - width_mm) / 2.0 >= _MIN_PRINT_MARGIN_MM
        assert (page_h_mm - height_mm) / 2.0 >= _MIN_PRINT_MARGIN_MM


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
    marker_png = Path(__file__).resolve().parent.parent / "assets" / "apriltag_marker.png"
    marker = cv2.imread(str(marker_png), cv2.IMREAD_COLOR)
    assert marker is not None

    expected_ratio = COMPOSITE_MARKER_HEIGHT_M / COMPOSITE_MARKER_WIDTH_M
    actual_ratio = marker.shape[0] / marker.shape[1]
    assert abs(actual_ratio - expected_ratio) < 0.01


def test_generated_marker_texture_respects_lens_size_limit() -> None:
    marker_png = Path(__file__).resolve().parent.parent / "assets" / "apriltag_marker.png"
    marker = cv2.imread(str(marker_png), cv2.IMREAD_COLOR)
    assert marker is not None
    assert max(marker.shape[:2]) <= LENS_TEXTURE_MAX_PX


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


def test_composite_detection_survives_downscaled_camera_view() -> None:
    """The tag must still decode when the composite spans only ~25% of frame width."""
    marker = generate_composite_marker_raster(generate_marker_raster())
    small = cv2.resize(marker, (160, 219), interpolation=cv2.INTER_AREA)
    page = cv2.copyMakeBorder(
        small,
        240,
        240,
        240,
        240,
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
    assert int(ids[0][0]) == DEFAULT_MARKER_ID
