# Marker assets (AprilTag 36h11 + composite Spectacles target)

Calibration uses a shared **composite** marker image on the **phone web page** and **Spectacles Image Tracking** in Lens Studio. The **Go2 camera** still detects the exact **inner AprilTag** inside that composite image. Keep all three in sync.

## Source of truth

| Location | Role |
|----------|------|
| `dimos-ar/assets/aruco_marker.png` | Generated composite PNG (phone + Lens) |
| `dimos-ar/assets/aruco_marker_phone.pdf` | Composite phone PDF (optional print) |
| `dimos-ar/clients/marker/index.html` | Marker page template served by `./start.sh` |
| `lens-studio/Assets/Markers/apriltag_marker.png` | Lens Image Tracking texture |
| `lens-studio/Assets/Markers/apriltag_marker.imgmarker` | Lens marker asset (physical height **6.0 cm**) |
| `dimos-ar/dimos_ar/marker_contract.py` | Shared AprilTag dictionary, ID, and physical size |

## Regenerate

From `dimos-ar/`:

```bash
python scripts/generate_marker.py --sync-lens
```

This writes the composite PNG/PDF under `dimos-ar/assets/`, copies the marker texture to `lens-studio/Assets/Markers/apriltag_marker.png`, and syncs the Lens marker asset physical height from the shared marker contract.

Options:

- `--print` — larger print PDF/PNG (150 mm edge)
- `--assets-dir PATH` — override output directory
- `--sync-lens` — copy PNG to `../lens-studio/Assets/Markers/apriltag_marker.png` and update `Markers/apriltag_marker.imgmarker`

After sync, reopen the Lens project if Lens Studio was running — confirm **Physical Height** on the marker asset is still **12.0 cm** (the full tracked image height).

## Defaults

- Dictionary: AprilTag 36h11, ID 0
- Inner AprilTag edge: **60 mm** (`DEFAULT_MARKER_LENGTH_M = 0.060` in `dimos_ar.marker_contract`)
- Full tracked image: **60 mm × 120 mm** (`COMPOSITE_MARKER_WIDTH_M` / `COMPOSITE_MARKER_HEIGHT_M`)
- Bridge alignment tolerance: 500 ms between dual detections

## Composite marker design

- The AprilTag remains centered and unchanged for robot-side pose estimation.
- The tracked image adds asymmetric black features **above and below** the tag so Spectacles sees more distinct features at multiple scales.
- A white quiet zone remains between the core tag and those extra features.
- Lens `MarkerHeight` refers to the **full 120 mm image height**, not the inner 60 mm tag edge.

See also [README.md](../README.md#frame-alignment-apriltag-marker) and [lens-studio/docs/SCENE_SETUP.md](../lens-studio/docs/SCENE_SETUP.md).
