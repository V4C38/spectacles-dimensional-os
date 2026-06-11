"""Shared AprilTag robot-mount marker contract.

Robot-mounted tags are plain 36h11 AprilTags printed at 7 x 7 cm total
(including white quiet zone). PnP uses the black detection square edge length.
"""

from __future__ import annotations

DEFAULT_MARKER_ID = 0
DEFAULT_APRILTAG_DICT = "DICT_APRILTAG_36h11"

# Printed sticker edge including quiet zone (10 x 10 modules at 7 mm/module).
TAG_TOTAL_SIZE_M = 0.070
TAG_MODULES_TOTAL = 10
# Black detection square (8 modules) — used for solvePnP marker_length_m.
TAG_BLACK_SIZE_M = TAG_TOTAL_SIZE_M * 8 / TAG_MODULES_TOTAL  # 0.056 m

TAG_TOTAL_SIZE_MM = int(round(TAG_TOTAL_SIZE_M * 1000.0))
TAG_BLACK_SIZE_MM = int(round(TAG_BLACK_SIZE_M * 1000.0))

MARKER_BASENAME = "apriltag_robot"
MARKER_PDF_A4 = f"{MARKER_BASENAME}_a4.pdf"
MARKER_PDF_LETTER = f"{MARKER_BASENAME}_letter.pdf"


def marker_png_name(tag_id: int) -> str:
    return f"{MARKER_BASENAME}_{tag_id}.png"
