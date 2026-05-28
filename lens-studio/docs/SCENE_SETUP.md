# Lens Studio scene setup (M1)

Scripts live under `Assets/Scripts/`. After pulling, wire the scene in Lens Studio
(MCP can attach scripts; these steps are manual when asset references are needed).

## 1. AprilTag marker asset

**Lens Studio** uses `Assets/Markers/apriltag_marker.png` (tracking image). **On the phone** during calibration, scan the **QR code** printed in the terminal when you run `dimos-ar` `./start.sh` — it opens the composite marker page at true size (**60 mm × 120 mm** overall, with a **60 mm × 60 mm** AprilTag centered inside).

The scene should already have **Image Tracking** with `aruco_marker` (physical height **12.0 cm** for the full tracked image). If you re-import:

1. Ensure `Assets/Markers/apriltag_marker.png` is in the project (sync from `dimos-ar`: `python scripts/generate_marker.py --sync-lens` — see [`dimos-ar/docs/MARKER_ASSETS.md`](../../dimos-ar/docs/MARKER_ASSETS.md)).
2. On the marker asset, set texture to `apriltag_marker` and **Physical Height** to `12.0` cm.

## 2. UI frames (scene-placed, UIKit Frame)

These scene objects use the Spectacles UIKit **Frame** script component. The wizard and HUD scripts live on the **same** objects as their frames:

| Scene object | Components |
|--------------|------------|
| **SetupWizard** | UIKit Frame + `SetupWizard` script |
| **MainUI** | UIKit Frame + `UIManager` script |

Position them ~60–80 cm in front of the user if needed.

## 3. RobotManager hierarchy

**RobotManager** is the **scene object** root for robot/bridge logic (formerly `DimOS_Root`). **DimosManager** is the **script component** on the **DimOS** child — do not confuse the scene name with the TypeScript class.

```
RobotManager          ← scene object (hierarchy root)
├── DimOS              ← BridgeClient + DimosManager scripts
├── Rendering          ← LidarPointCloud, RobotMarker
│   ├── LidarPoints    (empty — point cloud parent)
│   └── RobotMarkerRoot
```

**Image Tracking → MarkerAnchor** holds `AlignmentController` (marker detection).

## 4. Wire `@input` references

| Component | Field | Target |
|-----------|-------|--------|
| SetupWizard | defaultBridgeIp | Your Mac's LAN IP, bare IP only (e.g. `192.168.1.166`) |
| SetupWizard | dimosManager | DimosManager (on **DimOS**) |
| SetupWizard | uiManager | UIManager (on **MainUI**) |
| SetupWizard | alignmentController | AlignmentController (on **MarkerAnchor**) |
| UIManager | mainUIFrame | **MainUI** scene object (sibling of SetupWizard, not the parent) |
| UIManager | dimosManager | DimosManager |
| UIManager | setupWizard | SetupWizard (script on **SetupWizard** object) |
| DimosManager | bridgeClient | BridgeClient (on **DimOS**) |
| DimosManager | alignmentController | AlignmentController |
| DimosManager | lidarPointCloud | LidarPointCloud (on **Rendering**) |
| DimosManager | robotMarker | RobotMarker (on **Rendering**) |
| AlignmentController | bridgeClient | BridgeClient |
| AlignmentController | markerTracking | Marker Tracking on **Image Tracking** |
| AlignmentController | debugGizmo | (Optional) SceneObject with 3D gizmo for tracking debug |
| BridgeClient | internetModule | **Internet Module** asset (see below) |
| LidarPointCloud | pointParent | **LidarPoints** (child of **Rendering**) |
| RobotMarker | markerRoot | **RobotMarkerRoot** (child of **Rendering**) |

### Internet Module (manual)

MCP cannot add this asset automatically:

1. **+ Add Asset → Internet Module**
2. On **BridgeClient** (under **DimOS**), assign it to **Internet Module**

## 5. Verify

Push to Spectacles. On launch, the setup wizard should appear immediately (Step 0: Connect to DimOS). After a successful connection, the status line shows bridge mode, robot model, stream state, and calibration status from `bridge_status`.

See [`dimos-ar/docs/LENS_DEVELOPMENT.md`](../../dimos-ar/docs/LENS_DEVELOPMENT.md) for protocol and MCP setup.
