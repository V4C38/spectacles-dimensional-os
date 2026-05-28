#!/usr/bin/env python3
"""Generate AprilTag 36h11 calibration assets.

Outputs:
  - ``aruco_marker.png`` — legacy filename containing the AprilTag image
  - ``aruco_marker_phone.pdf`` — legacy filename for the padded phone-display PDF

Pose code uses ``marker_length_m`` from ``dimos_ar.marker_contract``.
Phone display: scan QR from ./start.sh marker URL.

Print: ``--print`` for a larger print PDF and PNG (150 mm).
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

import cv2
import numpy as np

from dimos_ar.marker_contract import (
    COMPOSITE_MARKER_HEIGHT_CM,
    COMPOSITE_MARKER_HEIGHT_M,
    COMPOSITE_MARKER_HEIGHT_MM,
    COMPOSITE_MARKER_WIDTH_M,
    DEFAULT_APRILTAG_DICT,
    DEFAULT_MARKER_ID,
    DEFAULT_MARKER_LENGTH_M,
    LEGACY_MARKER_PNG,
    LEGACY_PHONE_PDF,
    LENS_MARKER_ASSET_RELATIVE_PATH,
    LENS_MARKER_TEXTURE_RELATIVE_PATH,
)

try:
    from PIL import Image
except ImportError as e:  # pragma: no cover
    raise SystemExit("Pillow is required for PDF export: pip install Pillow") from e

PHONE_MARKER_WIDTH_M = COMPOSITE_MARKER_WIDTH_M
PHONE_MARKER_HEIGHT_M = COMPOSITE_MARKER_HEIGHT_M
PRINT_MARKER_TAG_EDGE_M = 0.150

PHONE_PAGE_PADDING = 0.125
PRINT_PAGE_PADDING = 0.08

PDF_DPI = 300
MARKER_SIDE_PX = 600
QUIET_ZONE_PX = 72


def _composite_marker_height_px(side_pixels: int) -> int:
    return int(round(side_pixels * (COMPOSITE_MARKER_HEIGHT_M / COMPOSITE_MARKER_WIDTH_M)))


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
    """Copy the generated marker texture to the active Lens asset location.

    If an older root-level texture still exists, keep it in sync too.
    """
    targets = [lens_assets_dir / LENS_MARKER_TEXTURE_RELATIVE_PATH]
    legacy_root_texture = lens_assets_dir / LEGACY_MARKER_PNG
    if legacy_root_texture.is_file():
        targets.append(legacy_root_texture)

    import shutil

    copied: list[Path] = []
    for target in targets:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_png, target)
        copied.append(target)
    return copied


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


def generate_composite_marker_raster(
    marker_bgr: np.ndarray,
    *,
    total_height_px: int | None = None,
    quiet_zone_px: int = QUIET_ZONE_PX,
) -> np.ndarray:
    """Return a portrait marker with a central AprilTag and extra tracking features."""
    marker_h, marker_w = marker_bgr.shape[:2]
    if marker_h != marker_w:
        raise ValueError("Core AprilTag raster must be square")

    height_px = total_height_px or _composite_marker_height_px(marker_w)
    feature_band_px = (height_px - marker_h - (2 * quiet_zone_px)) // 2
    if feature_band_px <= 0:
        raise ValueError("Composite marker height leaves no room for feature bands")

    composite = np.full((height_px, marker_w, 3), 255, dtype=np.uint8)
    marker_top = (height_px - marker_h) // 2
    composite[marker_top : marker_top + marker_h, :, :] = marker_bgr

    def fill_triangle(points: list[tuple[int, int]]) -> None:
        pts = np.array(points, dtype=np.int32).reshape((-1, 1, 2))
        cv2.fillPoly(composite, [pts], (0, 0, 0), lineType=cv2.LINE_AA)

    def fill_diamond(center: tuple[int, int], half_w: int, half_h: int) -> None:
        cx, cy = center
        fill_triangle([(cx, cy - half_h), (cx + half_w, cy), (cx, cy + half_h)])
        fill_triangle([(cx, cy - half_h), (cx - half_w, cy), (cx, cy + half_h)])

    top_band_y1 = feature_band_px
    bottom_band_y0 = height_px - feature_band_px
    bottom_center_y = bottom_band_y0 + (feature_band_px // 2)

    # Top band: use a few large, unmistakable silhouettes so Spectacles can
    # distinguish the target from farther away on a phone screen.
    cv2.circle(
        composite,
        center=(96, 64),
        radius=48,
        color=(0, 0, 0),
        thickness=-1,
        lineType=cv2.LINE_AA,
    )
    cv2.circle(
        composite,
        center=(190, 120),
        radius=18,
        color=(0, 0, 0),
        thickness=10,
        lineType=cv2.LINE_AA,
    )
    fill_triangle([(246, top_band_y1 - 18), (318, 22), (382, top_band_y1 - 34)])
    fill_diamond((432, 74), half_w=30, half_h=24)
    cv2.rectangle(
        composite,
        pt1=(392, 110),
        pt2=(434, 152),
        color=(0, 0, 0),
        thickness=-1,
        lineType=cv2.LINE_AA,
    )
    cv2.line(
        composite,
        pt1=(500, 18),
        pt2=(582, top_band_y1 - 24),
        color=(0, 0, 0),
        thickness=26,
        lineType=cv2.LINE_AA,
    )
    cv2.rectangle(
        composite,
        pt1=(520, 70),
        pt2=(574, 98),
        color=(0, 0, 0),
        thickness=-1,
        lineType=cv2.LINE_AA,
    )

    # Bottom band: different macro shapes and spacing so orientation stays clear.
    ring_center = (110, bottom_center_y - 18)
    cv2.circle(
        composite,
        center=ring_center,
        radius=46,
        color=(0, 0, 0),
        thickness=18,
        lineType=cv2.LINE_AA,
    )
    cv2.circle(
        composite,
        center=(206, bottom_band_y0 + 116),
        radius=16,
        color=(0, 0, 0),
        thickness=-1,
        lineType=cv2.LINE_AA,
    )
    cv2.rectangle(
        composite,
        pt1=(272, bottom_band_y0 + 18),
        pt2=(350, bottom_band_y0 + 112),
        color=(0, 0, 0),
        thickness=-1,
        lineType=cv2.LINE_AA,
    )
    fill_diamond((420, bottom_band_y0 + 50), half_w=28, half_h=22)
    fill_triangle(
        [(462, bottom_band_y0 + 132), (520, bottom_band_y0 + 56), (578, bottom_band_y0 + 132)]
    )
    cv2.line(
        composite,
        pt1=(470, height_px - 18),
        pt2=(586, bottom_band_y0 + 14),
        color=(0, 0, 0),
        thickness=34,
        lineType=cv2.LINE_AA,
    )
    cv2.rectangle(
        composite,
        pt1=(26, bottom_band_y0 + 120),
        pt2=(76, bottom_band_y0 + 144),
        color=(0, 0, 0),
        thickness=-1,
        lineType=cv2.LINE_AA,
    )

    return composite


def _mm_to_px(mm: float, dpi: int = PDF_DPI) -> int:
    return max(1, int(round(mm / 25.4 * dpi)))


def write_padded_pdf(
    marker_bgr: np.ndarray,
    out_path: Path,
    *,
    marker_width_mm: float,
    marker_height_mm: float,
    padding_fraction: float = PHONE_PAGE_PADDING,
    dpi: int = PDF_DPI,
) -> None:
    """PDF: marker centered on white page with known physical size."""
    pad = padding_fraction
    page_width_mm = marker_width_mm / (1.0 - 2.0 * pad)
    page_height_mm = marker_height_mm / (1.0 - 2.0 * pad)

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
        help="Output directory (default: dimos-ar/assets)",
    )
    lens_assets = Path(__file__).resolve().parent.parent.parent / "lens-studio" / "Assets"
    parser.add_argument(
        "--sync-lens",
        action="store_true",
        help="Copy legacy aruco_marker.png AprilTag asset to lens-studio/Assets/",
    )
    parser.add_argument(
        "--lens-assets-dir",
        type=Path,
        default=lens_assets,
        help="Lens Studio Assets directory (default: ../lens-studio/Assets)",
    )
    parser.add_argument(
        "--print",
        dest="print_mode",
        action="store_true",
        help="Print-sized marker instead of phone defaults",
    )
    parser.add_argument(
        "--padding",
        type=float,
        default=PHONE_PAGE_PADDING,
        help="Padding fraction per side on phone PDF (default: 0.125)",
    )
    args = parser.parse_args()

    tag_edge_m = PRINT_MARKER_TAG_EDGE_M if args.print_mode else DEFAULT_MARKER_LENGTH_M
    width_scale = tag_edge_m / DEFAULT_MARKER_LENGTH_M
    marker_width_mm = PHONE_MARKER_WIDTH_M * width_scale * 1000.0
    marker_height_mm = PHONE_MARKER_HEIGHT_M * width_scale * 1000.0

    core_marker = generate_marker_raster()
    marker = generate_composite_marker_raster(core_marker)
    if args.print_mode and width_scale != 1.0:
        resized_width = _mm_to_px(marker_width_mm, dpi=PDF_DPI)
        resized_height = _mm_to_px(marker_height_mm, dpi=PDF_DPI)
        marker = cv2.resize(marker, (resized_width, resized_height), interpolation=cv2.INTER_LINEAR)

    assets_dir = args.assets_dir
    png_path = assets_dir / ("aruco_marker_print.png" if args.print_mode else "aruco_marker.png")
    pdf_name = "aruco_marker_print.pdf" if args.print_mode else LEGACY_PHONE_PDF
    pdf_path = assets_dir / pdf_name

    if not cv2.imwrite(str(png_path), marker):
        raise SystemExit(f"Failed to write {png_path}")

    write_padded_pdf(
        marker,
        pdf_path,
        marker_width_mm=marker_width_mm,
        marker_height_mm=marker_height_mm,
        padding_fraction=args.padding if not args.print_mode else PRINT_PAGE_PADDING,
    )

    mode = "PRINT" if args.print_mode else "PHONE"
    print(f"[{mode}] Wrote {png_path} ({marker.shape[1]}x{marker.shape[0]} px)")
    print(
        f"[{mode}] Wrote {pdf_path} "
        f"(tracked image {marker_width_mm:.0f}x{marker_height_mm:.0f} mm; "
        f"inner tag edge {tag_edge_m * 1000.0:.0f} mm)"
    )

    if args.sync_lens and not args.print_mode:
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
