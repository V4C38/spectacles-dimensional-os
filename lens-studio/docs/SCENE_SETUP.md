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

### `MainUI` authored children

`MainUI` is no longer an empty frame shell. Author these children directly in the
scene so the HUD can be edited visually in Lens Studio:

| Child object | Purpose |
|--------------|---------|
| **MainTitle** | top title text |
| **MainStatus** | bridge / robot status text |
| **RestartSetup** | authored `RectangleButton` scene object |
| **RestartSetupLabel** | text child under **RestartSetup** |
| **DebugMode** | authored `RectangleButton` scene object |
| **DebugModeLabel** | text child under **DebugMode** |
| **ShowLidar** | authored `RectangleButton` scene object |
| **ShowLidarLabel** | text child under **ShowLidar** |

`UIManager` binds those authored children by name. The setup wizard and
navigation controls remain runtime-instantiated on purpose.

## 3. RobotManager hierarchy

**RobotManager** is the **scene object** root for robot/bridge logic (formerly `DimOS_Root`). **DimosManager** is the **script component** on the **DimOS** child — do not confuse the scene name with the TypeScript class.

```
RobotManager          ← scene object (hierarchy root)
├── DimOS              ← BridgeClient + DimosManager scripts
├── Rendering          ← LidarPointCloud, RobotMarker
│   ├── LidarPoints    (empty — point cloud parent)
│   └── RobotMarkerRoot
│       └── RobotMenuRoot
│           ├── RobotMenuToggle
│           └── RobotMenuCard
```

**Image Tracking → MarkerAnchor** holds `AlignmentController` (marker detection).

### `RobotMarkerRoot` authored robot UI

The robot-local menu is now a real scene subtree under **RobotMarkerRoot**:

| Child object | Purpose |
|--------------|---------|
| **RobotMenuRoot** | root container that follows the robot marker |
| **RobotMenuToggle** | Reachy-style 3D sphere toggle with exact imported Reachy mesh/material |
| **RobotMenuCard** | robot-local UI card container |
| **RobotMenuTitle** | robot label text |
| **RobotMenuStatus** | nav / bridge state text |
| **RobotMenuStop** | authored `RectangleButton` |
| **RobotMenuStopLabel** | text child under **RobotMenuStop** |
| **RobotMenuConfirm** | authored `RectangleButton` |
| **RobotMenuConfirmLabel** | text child under **RobotMenuConfirm** |

The 3D sphere toggle only shows/hides **RobotMenuCard**. It does **not** pause
the Lens, hide **MainUI**, or change bridge state.

### Reachy assets

The exact Reachy sphere assets live in:

- `Assets/Reachy/Main_sphere_default_normals.mesh`
- `Assets/Reachy/ActivityIndicator.ss_graph`
- `Assets/Reachy/ActivityIndicator_LookAtInteraction.mat`

## 4. Wire `@input` references

| Component | Field | Target |
|-----------|-------|--------|
| SetupWizard | defaultBridgeIp | Your Mac's LAN IP, bare IP only (e.g. `192.168.1.166`) |
| SetupWizard | dimosManager | DimosManager (on **DimOS**) |
| SetupWizard | uiManager | UIManager (on **MainUI**) |
| SetupWizard | alignmentController | AlignmentController (on **MarkerAnchor**) |
| UIManager | mainUIFrame | **MainUI** scene object (sibling of SetupWizard, not the parent) |
| UIManager | navigationControlsFrame | **NavigationControls** scene object under **MainUI** |
| UIManager | dimosManager | DimosManager |
| UIManager | setupWizard | SetupWizard (script on **SetupWizard** object) |
| DimosManager | bridgeClient | BridgeClient (on **DimOS**) |
| DimosManager | alignmentController | AlignmentController |
| DimosManager | lidarPointCloud | LidarPointCloud (on **Rendering**) |
| DimosManager | placementRayOrigin | **Camera Object** (tracked camera root used for placement ray fallback) |
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

### Native Spectacles modules (code-wired)

`DimosManager` now obtains `WorldQueryModule` and `GestureModule` directly in code via
`require("LensStudio:WorldQueryModule")` and `require("LensStudio:GestureModule")`.
Do not create Inspector asset inputs for those modules.

## 5. Runtime-built vs scene-authored

Keep this split intentional:

- **Scene-authored:** `MainUI` title/status/restart/debug/lidar objects, robot-local menu subtree, Reachy toggle sphere
- **Runtime-instantiated:** `SetupWizard` inner content, navigation controls content under `NavigationControls`

## 6. Verify

Push to Spectacles. On launch, the setup wizard should appear immediately (Step 0: Connect to DimOS). After a successful connection, the status line shows bridge mode, robot model, stream state, and calibration status from `bridge_status`.

For the navigation foundation pass, validate in this order:

1. Replay/web first: run `dimos-ar/blueprints/go2_ar_nav.py` and verify `hello`, `bridge_status`,
   `path`, and `nav_status` from the web client.
2. Lens compile and scene wiring: confirm `DimosManager` has `placementRayOrigin` wired and the
   Lens compiles without TypeScript errors.
3. Setup flow: on device, walk through connect -> auto align -> manual align fallback and confirm
   both paths reach committed calibration.
4. Placement flow: enable pin-drop mode, verify live preview, pinch confirm, execute toggle
   off/on behavior, and path rendering.
5. Robot-local controls: confirm the robot marker menu toggle follows odometry and the emergency
   stop path works from both the HUD and robot-local menu.

See [`dimos-ar/docs/LENS_DEVELOPMENT.md`](../../dimos-ar/docs/LENS_DEVELOPMENT.md) for protocol and MCP setup.
