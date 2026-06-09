"""Shared AprilTag calibration marker contract.

Keep robot-side AprilTag detection, generated composite assets, the phone
marker page, and Lens physical marker height aligned through these constants.
"""

from __future__ import annotations

DEFAULT_MARKER_ID = 0
DEFAULT_APRILTAG_DICT = "DICT_APRILTAG_36h11"

# Robot pose math uses the exact edge length of the central AprilTag.
DEFAULT_MARKER_LENGTH_M = 0.060
DEFAULT_MARKER_LENGTH_MM = int(round(DEFAULT_MARKER_LENGTH_M * 1000.0))
DEFAULT_MARKER_LENGTH_CM = DEFAULT_MARKER_LENGTH_M * 100.0

# The full tracked image is taller than the AprilTag so Spectacles gets
# additional non-repetitive features above and below the core tag.
COMPOSITE_MARKER_WIDTH_M = DEFAULT_MARKER_LENGTH_M
COMPOSITE_MARKER_WIDTH_MM = int(round(COMPOSITE_MARKER_WIDTH_M * 1000.0))
COMPOSITE_MARKER_WIDTH_CM = COMPOSITE_MARKER_WIDTH_M * 100.0

COMPOSITE_MARKER_HEIGHT_M = 0.120
COMPOSITE_MARKER_HEIGHT_MM = int(round(COMPOSITE_MARKER_HEIGHT_M * 1000.0))
COMPOSITE_MARKER_HEIGHT_CM = COMPOSITE_MARKER_HEIGHT_M * 100.0

# Mobile browsers often do not map CSS absolute units to real physical units.
# This scales the website marker so it lands at the intended physical size on
# the phone in use. Measured current-phone factor: 3.75 cm displayed vs 6.0 cm
# target -> 1.6x.
PHONE_WEB_MARKER_SCALE = 1.6
PHONE_WEB_MARKER_DISPLAY_WIDTH_MM = COMPOSITE_MARKER_WIDTH_MM * PHONE_WEB_MARKER_SCALE
PHONE_WEB_MARKER_DISPLAY_HEIGHT_MM = COMPOSITE_MARKER_HEIGHT_MM * PHONE_WEB_MARKER_SCALE

MARKER_BASENAME = "apriltag_marker"
MARKER_PNG = f"{MARKER_BASENAME}.png"
MARKER_PHONE_PDF = f"{MARKER_BASENAME}_phone.pdf"
MARKER_PRINT_PNG = f"{MARKER_BASENAME}_print.png"
MARKER_PRINT_PDF = f"{MARKER_BASENAME}_print.pdf"

LENS_MARKER_ASSET_RELATIVE_PATH = "TrackingMarkers/apriltag_marker.imgmarker"
LENS_MARKER_TEXTURE_RELATIVE_PATH = "TrackingMarkers/apriltag_marker.png"
