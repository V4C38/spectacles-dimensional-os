# Troubleshooting — lens-studio

## Marker not detected after AprilTag migration

**Symptoms:**
- Spectacles show "Marker not visible" indefinitely during calibration
- Robot logs show `no_marker=N` with N increasing
- Old ChArUco references might appear in logs or UI

**Solution:**
1. **Fully close and reopen Lens Studio** - stale marker cache can prevent detection
2. **Verify marker asset:**
   - Check `Assets/Markers/apriltag_marker.imgmarker` exists
   - Ensure `MarkerHeight: 12.000000` (12.0 cm full composite height)
   - Texture should point to `Assets/Markers/apriltag_marker.png`
3. **Clear Lens Studio cache:**
   - Close Lens Studio
   - Delete `Cache/` folder in project root
   - Reopen project
4. **Phone marker page:**
   - Visit `http://<MAC_IP>:8766/` 
   - Should show the composite calibration target (not checkerboard)
   - Full marker should be **60mm × 120mm** on **white background**
   - The central AprilTag inside it should still be **60mm × 60mm**
   - Full brightness, disable auto-lock

## JSON parse errors from Spectacles

**Symptoms:**
```
BridgeClient: parse error SyntaxError: JSON Parse error: Unexpected character: .
```

**Cause:** NaN or Infinity values in lidar/pose data serialized as invalid JSON.

**Fix:** Upgrade dimos-ar to latest (NaN filtering added to protocol encoder).

## Replay mode shows "no marker"

**Expected behavior** - replay data was recorded before AprilTag migration, so video stream shows old ChArUco board. Robot detector can't see a marker that wasn't in the recording.

**Test with live robot** to verify AprilTag detection.

## Debug gizmo not appearing

**Setup:**
1. Create a simple SceneObject with 3 colored cubes (RGB axes) under `MarkerAnchor`
2. Wire `AlignmentController.debugGizmo` to point to this object
3. Gizmo will show/hide automatically when marker tracking starts/stops

**Example hierarchy:**
```
Image Tracking
└── MarkerAnchor
    ├── AlignmentController (script)
    └── DebugGizmo (your SceneObject)
        ├── XAxis (red cube)
        ├── YAxis (green cube)
        └── ZAxis (blue cube)
```
