# Changelog — dimos-ar

## [Unreleased]

### Changed
- **[BREAKING]** Replaced 44×33mm ChArUco board with single 60mm AprilTag 36h11 marker
  - Robot detection: `ArucoAligner` using `cv2.aruco.ArucoDetector` + `solvePnP(IPPE_SQUARE)`
  - Spectacles: same `MarkerTrackingComponent`, new marker asset at 6.0 cm physical height
  - Generate marker: `python scripts/generate_marker.py` (was `generate_charuco.py`)
  - Assets: `aruco_marker.png` / `aruco_marker_phone.pdf` (was `charuco_board*`)
  - **Migration:** Delete old `charuco_board*` files, reopen Lens Studio project to reload marker cache
  
### Fixed
- Protocol encoder now rejects NaN/Infinity (was silently generating invalid JSON)
- Lidar points with NaN/Inf now clamped to 0 instead of causing JSON parse errors
- Phone marker webpage now uses white background (was black) - AprilTags require white background for detection

### Added
- Optional `debugGizmo` input on `AlignmentController` (Spectacles) - shows/hides 3D gizmo when marker tracked
- `TROUBLESHOOTING.md` in `lens-studio/` for common marker detection issues
