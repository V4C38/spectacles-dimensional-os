"""Shared AprilTag calibration marker contract.

Keep robot-side AprilTag detection, generated composite assets, and Lens
physical marker height aligned through these constants.

The composite is sized to print at 100% scale on both A4 and US Letter:
190 x 260 mm fits inside the shared printable area of both paper sizes
with >= 9.7 mm margins. The central AprilTag is the largest 36h11 square
that keeps a full one-module (>= 18.75 mm) white quiet zone inside the
190 mm composite width.
"""

from __future__ import annotations

DEFAULT_MARKER_ID = 0
DEFAULT_APRILTAG_DICT = "DICT_APRILTAG_36h11"

# Robot pose math uses the exact edge length of the central AprilTag
# (outer edge of the black border, as detected by OpenCV).
DEFAULT_MARKER_LENGTH_M = 0.150
DEFAULT_MARKER_LENGTH_MM = int(round(DEFAULT_MARKER_LENGTH_M * 1000.0))
DEFAULT_MARKER_LENGTH_CM = DEFAULT_MARKER_LENGTH_M * 100.0

# White quiet zone around the tag. Must stay >= one tag module
# (DEFAULT_MARKER_LENGTH_M / 8 for 36h11 with a one-module border).
MARKER_QUIET_ZONE_M = 0.020

# The full tracked image carries non-repetitive macro features above and
# below the tag so Spectacles image tracking stays robust at distance.
# The AprilTag is centered so the Lens marker origin and the robot PnP
# tag center are the same physical point.
COMPOSITE_MARKER_WIDTH_M = 0.190
COMPOSITE_MARKER_WIDTH_MM = int(round(COMPOSITE_MARKER_WIDTH_M * 1000.0))
COMPOSITE_MARKER_WIDTH_CM = COMPOSITE_MARKER_WIDTH_M * 100.0

COMPOSITE_MARKER_HEIGHT_M = 0.260
COMPOSITE_MARKER_HEIGHT_MM = int(round(COMPOSITE_MARKER_HEIGHT_M * 1000.0))
COMPOSITE_MARKER_HEIGHT_CM = COMPOSITE_MARKER_HEIGHT_M * 100.0

MARKER_BASENAME = "apriltag_marker"
MARKER_PNG = f"{MARKER_BASENAME}.png"
MARKER_PDF_A4 = f"{MARKER_BASENAME}_a4.pdf"
MARKER_PDF_LETTER = f"{MARKER_BASENAME}_letter.pdf"

LENS_MARKER_ASSET_RELATIVE_PATH = "TrackingMarkers/apriltag_marker.imgmarker"
LENS_MARKER_TEXTURE_RELATIVE_PATH = "TrackingMarkers/apriltag_marker.png"
