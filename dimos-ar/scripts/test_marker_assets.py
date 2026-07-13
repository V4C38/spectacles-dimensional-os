from __future__ import annotations

from pathlib import Path

import cv2

from dimos.ar.tag_tracking.fiducial_helpers import aruco_detected_tag_id
from scripts.generate_marker import (
    A4_PAGE_MM,
    DEFAULT_APRILTAG_DICT,
    DEFAULT_MARKER_ID,
    LETTER_PAGE_MM,
    TAG_BLACK_SIZE_M,
    TAG_MODULES_TOTAL,
    TAG_TOTAL_SIZE_M,
    generate_tag_raster,
    marker_pdf_a4_name,
    marker_pdf_letter_name,
    marker_png_name,
)

_MIN_PRINT_MARGIN_MM = 9.0


def test_tag_total_and_black_sizes_match_contract() -> None:
    assert TAG_TOTAL_SIZE_M == 0.070
    assert abs(TAG_BLACK_SIZE_M - TAG_TOTAL_SIZE_M * 8 / TAG_MODULES_TOTAL) < 1e-9


def test_robot_tag_prints_at_full_scale_on_a4_and_us_letter() -> None:
    width_mm = TAG_TOTAL_SIZE_M * 1000.0
    height_mm = TAG_TOTAL_SIZE_M * 1000.0
    for page_w_mm, page_h_mm in (A4_PAGE_MM, LETTER_PAGE_MM):
        assert (page_w_mm - width_mm) / 2.0 >= _MIN_PRINT_MARGIN_MM
        assert (page_h_mm - height_mm) / 2.0 >= _MIN_PRINT_MARGIN_MM


def test_generated_robot_marker_is_square() -> None:
    marker = generate_tag_raster(marker_id=DEFAULT_MARKER_ID)
    assert marker.shape[0] == marker.shape[1]


def test_generated_robot_marker_detects_on_white_page() -> None:
    marker = generate_tag_raster(marker_id=DEFAULT_MARKER_ID)
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
    assert aruco_detected_tag_id(ids[0]) == DEFAULT_MARKER_ID


def test_robot_marker_assets_exist_after_generation() -> None:
    assets_dir = Path(__file__).resolve().parent.parent / "assets"
    png = assets_dir / marker_png_name(DEFAULT_MARKER_ID)
    assert png.is_file()
    marker = cv2.imread(str(png), cv2.IMREAD_COLOR)
    assert marker is not None
    assert marker.shape[0] == marker.shape[1]
    assert (assets_dir / marker_pdf_a4_name(DEFAULT_MARKER_ID)).is_file()
    assert (assets_dir / marker_pdf_letter_name(DEFAULT_MARKER_ID)).is_file()


def test_robot_marker_survives_downscaled_view() -> None:
    marker = generate_tag_raster(marker_id=DEFAULT_MARKER_ID)
    small = cv2.resize(marker, (112, 112), interpolation=cv2.INTER_AREA)
    page = cv2.copyMakeBorder(
        small,
        120,
        120,
        120,
        120,
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
    assert aruco_detected_tag_id(ids[0]) == DEFAULT_MARKER_ID
