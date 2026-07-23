"""Generate/cache printable AprilTag PNG + PDF for the launcher UI."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Callable

import cv2

from config import repo_root
from tag_config import DEFAULT_PRINT_SIZE_MM


def _marker_api() -> tuple[Callable[..., Any], Callable[..., None], tuple[float, float]]:
    dimos_ar = repo_root() / "dimos-ar"
    scripts = str(dimos_ar)
    if scripts not in sys.path:
        sys.path.insert(0, scripts)
    from scripts.generate_marker import (  # noqa: WPS433
        LETTER_PAGE_MM,
        generate_tag_raster,
        write_page_pdf,
    )

    return generate_tag_raster, write_page_pdf, LETTER_PAGE_MM


def cache_dir(root: Path | None = None) -> Path:
    return (root or repo_root()) / ".dimos-ar-launcher" / "apriltag-cache"


def ensure_png(tag_id: int, root: Path | None = None) -> Path:
    if tag_id < 0 or tag_id > 586:
        raise ValueError("tag_id out of AprilTag 36h11 range")
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
    if tag_id < 0 or tag_id > 586:
        raise ValueError("tag_id out of AprilTag 36h11 range")
    if print_size_mm <= 0:
        raise ValueError("print_size_mm must be positive")
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
