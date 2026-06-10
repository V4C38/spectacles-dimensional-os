#!/usr/bin/env python3
"""Generate AprilTag 36h11 calibration assets for print and Lens tracking.

Outputs:
  - ``apriltag_marker.png`` — composite tracking image (<= 2048 px, Lens texture)
  - ``apriltag_marker_a4.pdf`` — A4 page (210 x 297 mm), print at 100% scale
  - ``apriltag_marker_letter.pdf`` — US Letter page (8.5 x 11 in), print at 100% scale

Pose code uses ``DEFAULT_MARKER_LENGTH_M`` from ``dimos_xr.marker_contract``.
Print either PDF at actual size (no "fit to page") and verify the black tag
edge with a ruler before calibrating.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

import cv2
import numpy as np

from dimos_xr.marker_contract import (
    COMPOSITE_MARKER_HEIGHT_CM,
    COMPOSITE_MARKER_HEIGHT_M,
    COMPOSITE_MARKER_WIDTH_M,
    DEFAULT_APRILTAG_DICT,
    DEFAULT_MARKER_ID,
    DEFAULT_MARKER_LENGTH_M,
    LENS_MARKER_ASSET_RELATIVE_PATH,
    LENS_MARKER_TEXTURE_RELATIVE_PATH,
    MARKER_PDF_A4,
    MARKER_PDF_LETTER,
    MARKER_PNG,
)

try:
    from PIL import Image
except ImportError as e:  # pragma: no cover
    raise SystemExit("Pillow is required for PDF export: pip install Pillow") from e

A4_PAGE_MM = (210.0, 297.0)
LETTER_PAGE_MM = (215.9, 279.4)

PDF_DPI = 300
# Snap recommends marker textures of 2048 x 2048 px or less.
LENS_TEXTURE_MAX_PX = 2048

# Reference layout rendered at 12.8 px/mm. The tag is 1920 px
# (240 px per 36h11 module), the composite 2432 x 3328 px,
# and the quiet zone 256 px (20 mm) — all integer module multiples.
MARKER_SIDE_PX = 1920
_REF_TAG_PX = 1920
_REF_WIDTH_PX = 2432
_REF_HEIGHT_PX = 3328
_REF_QUIET_PX = 256


def sync_lens_marker_height(lens_assets_dir: Path, marker_height_cm: float) -> None:
    """Update Lens ImageMarker physical height to match the shared marker contract."""
    imgmarker_path = lens_assets_dir / LENS_MARKER_ASSET_RELATIVE_PATH
    text = imgmarker_path.read_text(encoding="utf-8")
    updated, count = re.subn(
        r"(^\s*MarkerHeight:\s*)[0-9.]+",
        rf"\g<1>{marker_height_cm:.6f}",
        text,
        flags=re.MULTILINE,
    )
    if count != 1:
        raise SystemExit(f"Failed to update MarkerHeight in {imgmarker_path}")
    imgmarker_path.write_text(updated, encoding="utf-8")


def sync_lens_texture(lens_assets_dir: Path, source_png: Path) -> list[Path]:
    """Copy the generated marker texture to the active Lens asset location."""
    import shutil

    target = lens_assets_dir / LENS_MARKER_TEXTURE_RELATIVE_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_png, target)
    return [target]


def generate_marker_raster(
    *,
    marker_id: int = DEFAULT_MARKER_ID,
    dictionary_name: str = DEFAULT_APRILTAG_DICT,
    side_pixels: int = MARKER_SIDE_PX,
) -> np.ndarray:
    """Return BGR image of a single AprilTag marker."""
    if not hasattr(cv2.aruco, dictionary_name):
        raise ValueError(f"Unknown AprilTag dictionary {dictionary_name!r}")
    dictionary = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, dictionary_name))
    gray = cv2.aruco.generateImageMarker(dictionary, marker_id, side_pixels, borderBits=1)
    return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)


def generate_composite_marker_raster(marker_bgr: np.ndarray) -> np.ndarray:
    """Return the portrait composite: centered AprilTag plus macro feature bands.

    The tag keeps a full quiet zone on all sides. The bands above and below
    are filled with large, high-contrast, non-repeating shapes (different per
    band, so the target has no rotational symmetry) sized for Spectacles
    image tracking at distance.
    """
    marker_h, marker_w = marker_bgr.shape[:2]
    if marker_h != marker_w:
        raise ValueError("Core AprilTag raster must be square")

    s = marker_w / _REF_TAG_PX

    def px(value: float) -> int:
        return int(round(value * s))

    width_px = px(_REF_WIDTH_PX)
    height_px = px(_REF_HEIGHT_PX)
    quiet_px = px(_REF_QUIET_PX)
    band_px = (height_px - marker_h) // 2 - quiet_px
    if band_px <= 0:
        raise ValueError("Composite layout leaves no room for feature bands")

    composite = np.full((height_px, width_px, 3), 255, dtype=np.uint8)
    top = (height_px - marker_h) // 2
    left = (width_px - marker_w) // 2
    composite[top : top + marker_h, left : left + marker_w, :] = marker_bgr

    black = (0, 0, 0)

    def fill_triangle(points: list[tuple[float, float]]) -> None:
        pts = np.array([(px(x), px(y)) for x, y in points], dtype=np.int32)
        cv2.fillPoly(composite, [pts.reshape((-1, 1, 2))], black, lineType=cv2.LINE_AA)

    def fill_diamond(cx: float, cy: float, half_w: float, half_h: float) -> None:
        fill_triangle([(cx, cy - half_h), (cx + half_w, cy), (cx, cy + half_h)])
        fill_triangle([(cx, cy - half_h), (cx - half_w, cy), (cx, cy + half_h)])

    def fill_rect(x0: float, y0: float, x1: float, y1: float) -> None:
        cv2.rectangle(composite, (px(x0), px(y0)), (px(x1), px(y1)), black, thickness=-1)

    def circle(cx: float, cy: float, radius: float, thickness: float = -1.0) -> None:
        cv2.circle(
            composite,
            (px(cx), px(cy)),
            px(radius),
            black,
            thickness=-1 if thickness < 0 else max(1, px(thickness)),
            lineType=cv2.LINE_AA,
        )

    def line(x0: float, y0: float, x1: float, y1: float, thickness: float) -> None:
        cv2.line(
            composite,
            (px(x0), px(y0)),
            (px(x1), px(y1)),
            black,
            thickness=max(1, px(thickness)),
            lineType=cv2.LINE_AA,
        )

    # Top band (reference y in [0, 448]): bracket, disc, ring, triangle,
    # diamond, square, diagonal.
    fill_rect(32, 32, 384, 128)
    fill_rect(32, 32, 128, 384)
    circle(640, 256, 152)
    circle(968, 144, 88, thickness=48)
    fill_triangle([(1120, 416), (1296, 48), (1472, 400)])
    fill_diamond(1696, 224, 128, 176)
    fill_rect(1856, 48, 1984, 176)
    line(2080, 400, 2384, 64, 72)

    # Bottom band (reference y in [2880, 3328]): mirrored-but-different set
    # so orientation stays unambiguous.
    line(48, 2928, 368, 3280, 80)
    circle(608, 3112, 136, thickness=56)
    circle(856, 3264, 56)
    fill_rect(1000, 2928, 1216, 3280)
    fill_triangle([(1344, 3280), (1504, 2928), (1664, 3280)])
    fill_diamond(1856, 3104, 112, 160)
    fill_rect(2048, 3232, 2400, 3296)
    fill_rect(2336, 2944, 2400, 3296)

    return composite


def _mm_to_px(mm: float, dpi: int = PDF_DPI) -> int:
    return max(1, int(round(mm / 25.4 * dpi)))


def write_page_pdf(
    marker_bgr: np.ndarray,
    out_path: Path,
    *,
    page_width_mm: float,
    page_height_mm: float,
    marker_width_mm: float,
    marker_height_mm: float,
    dpi: int = PDF_DPI,
) -> None:
    """PDF: marker centered on a fixed-size page so 100%-scale printing is exact."""
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

    out_path.parent.mkdir(parents=True, exist_ok=True)
    page.save(str(out_path), "PDF", resolution=float(dpi))


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    assets = Path(__file__).resolve().parent.parent / "assets"
    parser.add_argument(
        "--assets-dir",
        type=Path,
        default=assets,
        help="Output directory (default: dimos-xr/assets)",
    )
    lens_assets = Path(__file__).resolve().parent.parent.parent / "lens-studio" / "Assets"
    parser.add_argument(
        "--sync-lens",
        action="store_true",
        help="Copy apriltag_marker.png to lens-studio/Assets/TrackingMarkers/",
    )
    parser.add_argument(
        "--lens-assets-dir",
        type=Path,
        default=lens_assets,
        help="Lens Studio Assets directory (default: ../lens-studio/Assets)",
    )
    args = parser.parse_args()

    marker_width_mm = COMPOSITE_MARKER_WIDTH_M * 1000.0
    marker_height_mm = COMPOSITE_MARKER_HEIGHT_M * 1000.0

    marker = generate_composite_marker_raster(generate_marker_raster())

    # Lens texture / repo PNG, capped at Snap's recommended texture size.
    texture_scale = LENS_TEXTURE_MAX_PX / max(marker.shape[:2])
    texture = cv2.resize(
        marker,
        (
            int(round(marker.shape[1] * texture_scale)),
            int(round(marker.shape[0] * texture_scale)),
        ),
        interpolation=cv2.INTER_AREA,
    )

    assets_dir = args.assets_dir
    png_path = assets_dir / MARKER_PNG
    assets_dir.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(png_path), texture):
        raise SystemExit(f"Failed to write {png_path}")

    for pdf_name, (page_w, page_h) in (
        (MARKER_PDF_A4, A4_PAGE_MM),
        (MARKER_PDF_LETTER, LETTER_PAGE_MM),
    ):
        pdf_path = assets_dir / pdf_name
        write_page_pdf(
            marker,
            pdf_path,
            page_width_mm=page_w,
            page_height_mm=page_h,
            marker_width_mm=marker_width_mm,
            marker_height_mm=marker_height_mm,
        )
        print(
            f"Wrote {pdf_path} (page {page_w:.0f}x{page_h:.0f} mm; "
            f"tracked image {marker_width_mm:.0f}x{marker_height_mm:.0f} mm; "
            f"inner tag edge {DEFAULT_MARKER_LENGTH_M * 1000.0:.0f} mm)"
        )

    print(f"Wrote {png_path} ({texture.shape[1]}x{texture.shape[0]} px)")

    if args.sync_lens:
        lens_dir = args.lens_assets_dir
        lens_dir.mkdir(parents=True, exist_ok=True)
        copied_targets = sync_lens_texture(lens_dir, png_path)
        sync_lens_marker_height(lens_dir, COMPOSITE_MARKER_HEIGHT_CM)
        for copied_target in copied_targets:
            print(f"[SYNC] Copied {png_path.name} -> {copied_target}")
        print(
            f"[SYNC] Updated {LENS_MARKER_ASSET_RELATIVE_PATH} physical height "
            f"to {COMPOSITE_MARKER_HEIGHT_CM:.1f} cm"
        )


if __name__ == "__main__":
    main()
