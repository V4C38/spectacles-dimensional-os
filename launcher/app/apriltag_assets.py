"""Generate/cache printable AprilTag PNG + PDF and decode uploaded markers."""

from __future__ import annotations

import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from config import repo_root
from tag_config import DEFAULT_PRINT_SIZE_MM

APRILTAG_36H11_MAX_ID = 586
_DICTIONARY_NAME = "DICT_APRILTAG_36h11"


def _marker_api() -> tuple[Callable[..., Any], Callable[..., None], tuple[float, float]]:
    markers = str(repo_root() / "assets" / "markers")
    if markers not in sys.path:
        sys.path.insert(0, markers)
    from generate_marker import LETTER_PAGE_MM, generate_tag_raster, write_page_pdf

    return generate_tag_raster, write_page_pdf, LETTER_PAGE_MM


def cache_dir(root: Path | None = None) -> Path:
    return (root or repo_root()) / ".dimos-ar-launcher" / "apriltag-cache"


def bundled_png(tag_id: int, root: Path | None = None) -> Path | None:
    path = (root or repo_root()) / "assets" / "markers" / f"apriltag_robot_{tag_id}.png"
    return path if path.is_file() else None


def bundled_letter_pdf(tag_id: int, root: Path | None = None) -> Path | None:
    path = (root or repo_root()) / "assets" / "markers" / f"apriltag_robot_{tag_id}_letter.pdf"
    return path if path.is_file() else None


def _require_marker_id(tag_id: int) -> None:
    if tag_id < 0 or tag_id > APRILTAG_36H11_MAX_ID:
        raise ValueError("marker_id out of AprilTag 36h11 range")


def ensure_png(tag_id: int, root: Path | None = None) -> Path:
    _require_marker_id(tag_id)
    bundled = bundled_png(tag_id, root)
    if bundled is not None:
        return bundled
    out = cache_dir(root) / f"apriltag_robot_{tag_id}.png"
    if out.is_file():
        return out
    generate_tag_raster, _write_page_pdf, _letter = _marker_api()
    raster = generate_tag_raster(marker_id=tag_id)
    out.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(out), raster):
        raise RuntimeError(f"failed to write {out}")
    return out


def ensure_pdf(
    tag_id: int,
    *,
    print_size_mm: float = DEFAULT_PRINT_SIZE_MM,
    root: Path | None = None,
) -> Path:
    _require_marker_id(tag_id)
    if print_size_mm <= 0:
        raise ValueError("print_size_mm must be positive")
    if print_size_mm == DEFAULT_PRINT_SIZE_MM:
        bundled = bundled_letter_pdf(tag_id, root)
        if bundled is not None:
            return bundled
    size_key = f"{print_size_mm:g}".replace(".", "p")
    out = cache_dir(root) / f"apriltag_robot_{tag_id}_{size_key}mm_letter.pdf"
    if out.is_file():
        return out
    generate_tag_raster, write_page_pdf, letter_mm = _marker_api()
    raster = generate_tag_raster(marker_id=tag_id)
    out.parent.mkdir(parents=True, exist_ok=True)
    write_page_pdf(
        raster,
        out,
        page_width_mm=letter_mm[0],
        page_height_mm=letter_mm[1],
        marker_width_mm=float(print_size_mm),
        marker_height_mm=float(print_size_mm),
        tag_id=tag_id,
    )
    return out


def decode_marker_id(png_bytes: bytes) -> int:
    image = cv2.imdecode(np.frombuffer(png_bytes, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise ValueError("file is not a readable PNG image")
    dictionary = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, _DICTIONARY_NAME))
    _corners, ids, _rejected = cv2.aruco.ArucoDetector(dictionary).detectMarkers(image)
    if ids is None or len(ids) == 0:
        raise ValueError("no AprilTag 36h11 marker found in PNG")
    found = sorted({int(value) for value in np.asarray(ids).reshape(-1)})
    if len(found) != 1:
        raise ValueError(f"expected one AprilTag 36h11 id, found {found}")
    return found[0]
