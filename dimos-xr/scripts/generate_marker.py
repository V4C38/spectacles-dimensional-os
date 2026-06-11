#!/usr/bin/env python3
"""Generate plain robot-mounted AprilTag 36h11 assets for print.

Outputs per tag ID:
  - ``apriltag_robot_{id}.png`` — 70 mm total (56 mm black square)
  - Combined ``apriltag_robot_a4.pdf`` and ``apriltag_robot_letter.pdf``

Print at 100% scale (no "fit to page") and verify the sticker measures 70 mm.
Mount on a flat rigid backing — do not bend or wrap around curves.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np

from dimos_xr.marker_contract import (
    DEFAULT_APRILTAG_DICT,
    DEFAULT_MARKER_ID,
    MARKER_PDF_A4,
    MARKER_PDF_LETTER,
    TAG_BLACK_SIZE_M,
    TAG_MODULES_TOTAL,
    TAG_TOTAL_SIZE_M,
    marker_png_name,
)

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError as e:  # pragma: no cover
    raise SystemExit("Pillow is required for PDF export: pip install Pillow") from e

A4_PAGE_MM = (210.0, 297.0)
LETTER_PAGE_MM = (215.9, 279.4)
PDF_DPI = 300
MODULES_BLACK = 8
MODULES_PER_SIDE = TAG_MODULES_TOTAL
PX_PER_MODULE = 80


def _mm_to_px(mm: float, dpi: int = PDF_DPI) -> int:
    return max(1, int(round(mm / 25.4 * dpi)))


def generate_tag_raster(
    *,
    marker_id: int = DEFAULT_MARKER_ID,
    dictionary_name: str = DEFAULT_APRILTAG_DICT,
) -> np.ndarray:
    """Return BGR image: 10x10 modules white canvas with centered 8x8 tag."""
    if not hasattr(cv2.aruco, dictionary_name):
        raise ValueError(f"Unknown AprilTag dictionary {dictionary_name!r}")
    dictionary = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, dictionary_name))
    black_px = MODULES_BLACK * PX_PER_MODULE
    gray_tag = cv2.aruco.generateImageMarker(dictionary, marker_id, black_px, borderBits=1)
    tag_bgr = cv2.cvtColor(gray_tag, cv2.COLOR_GRAY2BGR)
    canvas_px = MODULES_PER_SIDE * PX_PER_MODULE
    canvas = np.full((canvas_px, canvas_px, 3), 255, dtype=np.uint8)
    offset = (canvas_px - black_px) // 2
    canvas[offset : offset + black_px, offset : offset + black_px] = tag_bgr
    return canvas


def write_page_pdf(
    marker_bgr: np.ndarray,
    out_path: Path,
    *,
    page_width_mm: float,
    page_height_mm: float,
    marker_width_mm: float,
    marker_height_mm: float,
    tag_id: int,
    dpi: int = PDF_DPI,
) -> None:
    if marker_width_mm > page_width_mm or marker_height_mm > page_height_mm:
        raise ValueError(
            f"Marker {marker_width_mm}x{marker_height_mm} mm does not fit "
            f"page {page_width_mm}x{page_height_mm} mm"
        )
    page_width_px = _mm_to_px(page_width_mm, dpi)
    page_height_px = _mm_to_px(page_height_mm, dpi)
    marker_width_px = _mm_to_px(marker_width_mm, dpi)
    marker_height_px = _mm_to_px(marker_height_mm, dpi)
    marker_rgb = cv2.cvtColor(marker_bgr, cv2.COLOR_BGR2RGB)
    marker_pil = Image.fromarray(marker_rgb).resize(
        (marker_width_px, marker_height_px),
        Image.Resampling.LANCZOS,
    )
    page = Image.new("RGB", (page_width_px, page_height_px), (255, 255, 255))
    x = (page_width_px - marker_width_px) // 2
    y = (page_height_px - marker_height_px) // 2
    page.paste(marker_pil, (x, y))
    draw = ImageDraw.Draw(page)
    label_y = y + marker_height_px + int(0.01 * dpi)
    lines = [
        f"AprilTag 36h11 ID {tag_id}",
        f"70 mm total / 56 mm black square — print at 100% scale",
        "Mount FLAT (rigid backing). Do not bend or wrap.",
    ]
    for i, line in enumerate(lines):
        draw.text((x, label_y + i * int(0.12 * dpi)), line, fill=(0, 0, 0))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    page.save(str(out_path), "PDF", resolution=float(dpi))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    assets = Path(__file__).resolve().parent.parent / "assets"
    parser.add_argument("--ids", type=int, nargs="+", default=[DEFAULT_MARKER_ID])
    parser.add_argument("--out", type=Path, default=assets, help="Output directory")
    args = parser.parse_args()
    marker_mm = TAG_TOTAL_SIZE_M * 1000.0
    for tag_id in args.ids:
        raster = generate_tag_raster(marker_id=tag_id)
        png_path = args.out / marker_png_name(tag_id)
        args.out.mkdir(parents=True, exist_ok=True)
        if not cv2.imwrite(str(png_path), raster):
            raise SystemExit(f"Failed to write {png_path}")
        print(f"Wrote {png_path} ({raster.shape[1]}x{raster.shape[0]} px)")
    first_id = args.ids[0]
    first_raster = generate_tag_raster(marker_id=first_id)
    for pdf_name, (page_w, page_h) in (
        (MARKER_PDF_A4, A4_PAGE_MM),
        (MARKER_PDF_LETTER, LETTER_PAGE_MM),
    ):
        pdf_path = args.out / pdf_name
        write_page_pdf(
            first_raster,
            pdf_path,
            page_width_mm=page_w,
            page_height_mm=page_h,
            marker_width_mm=marker_mm,
            marker_height_mm=marker_mm,
            tag_id=first_id,
        )
        print(f"Wrote {pdf_path} (tag {first_id}, {marker_mm:.0f} mm total)")


if __name__ == "__main__":
    main()
