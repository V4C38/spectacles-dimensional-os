# Lens Studio scene setup

Scripts live under `Assets/Scripts/`. After pulling, wire the scene in Lens Studio
(MCP can attach scripts; these steps are manual when asset references are needed).
The live `SetupWizard` scene object is bound to
`Assets/Scripts/Setup/SetupWizard.ts`.

## 1. Robot-mounted AprilTag

**Print** a plain **70 mm × 70 mm** AprilTag 36h11 sticker from `dimos-xr/assets/apriltag_robot_a4.pdf` (A4) or `apriltag_robot_letter.pdf` (US Letter) at **100% scale**. Regenerate with `python scripts/generate_marker.py` from `dimos-xr/`. Mount the tag flat on the robot (default Go2 mount: shoulder plate, tag facing up). Verify the printed outer edge measures 70 mm before calibrating.

Image Tracking / MarkerAnchor are removed. Tag alignment uses **FrameCaptureController** on **Camera Object** and **TagAlignmentSession** on **DimOSManager**.

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
| **MainTitle** | top title text — editor-authored only; runtime code never changes this |
| **MainStatus** | bridge / robot status text |
| **RestartSetup** | authored `RectangleButton` scene object |
| **RestartSetupLabel** | text child under **RestartSetup** |
| **DebugMode** | authored `RectangleButton` scene object |
| **DebugModeLabel** | text child under **DebugMode** |
| **EmergencyStop** | authored `RectangleButton` scene object replacing the old LiDAR button |
| **EmergencyStopLabel** | text child under **EmergencyStop** |
| **SubMenu** | authored UIKit `Frame` containing mode-specific settings content; collapsed by default |
| **ModeManual** | Manual mode button (3-state: off / active / active + settings) |
| **TextModeManual** | text child under **ModeManual** — label source for Manual button |
| **ModeAgent** | Agent mode button (3-state: off / active / active + settings) |
| **TextModeAgent** | text child under **ModeAgent** — label source for Agent button |
| **ModeManualMenu** | manual-mode content container under **SubMenu** |
| **TextManualMode** | authored descriptive text under **ModeManualMenu** |
| **EnableNavigation** | authored toggle button under **ModeManualMenu** |
| **EnableNavigationLabel** | text child under **EnableNavigation** — runtime label is `Navigation Marker: on/off` |
| **ShowLiDAR** | authored cycle button under **ModeManualMenu** — cycles LiDAR display mode |
| **ShowLiDARLabel** | text child under **ShowLiDAR** |
| **ModeAgentMenu** | agent-mode content container under **SubMenu** |
| **TextAgentMode** | authored descriptive text under **ModeAgentMenu** |

`UIManager` binds those authored children by name and remains presentation-only.
Setup/runtime lifecycle transitions are owned through `DimosManager` + app state.
**ShowLiDAR** cycles LiDAR display mode (`lidarMode` app state: off / obstacles / full).
The red obstacle layer always renders from live bridge `lidar` messages when connected,
independent of LiDAR mode. **DebugMode** on the main bar is reserved for future
debug features (unwired in code). `EmergencyStop` lives on the main HUD.
**ModeManual** and **ModeAgent** are mutually exclusive mode selectors. Tapping the
inactive mode activates it and closes settings. Tapping the active mode toggles its
settings submenu (`Manual (Settings)` / `Agent (Settings)`). Selecting **Manual**
no longer auto-starts navigation placement; the manual submenu exposes **Enable
Navigation** (`Navigation Marker: on/off`), and both the main HUD toggle and
robot-local toggle reflect the same shared app-state boolean.

## 3. RobotManager hierarchy

**RobotManager** is the **scene object** root for robot/bridge logic (formerly `DimOS_Root`). **DimosManager** is the **script component** on the **DimOS** child — do not confuse the scene name with the TypeScript class.

```
RobotManager          ← scene object (hierarchy root)
├── DimOS              ← BridgeClient + DimosManager scripts
├── Rendering          ← PointCloudRenderer, RobotMarker
│   ├── LidarPoints    ← LidarHeightVisual + LidarObstacleVisual children
│   ├── RobotMarkerRoot
│   │   ├── RobotToggleButton
│   │   ├── RobotDirectionArrow
│   │   └── RobotPlacementHandle
│   └── RobotUIRoot
```

**Camera Object** holds `FrameCaptureController` (still capture + pose streaming). **DimOSManager** holds `TagAlignmentSession`, wired to `BridgeClient` and `FrameCaptureController`. Camera capture requires Experimental APIs (enabled in the `.esproj`) and runs on device only.

### `RobotMarkerRoot` authored robot UI

The robot marker is split into a rotated marker subtree plus a separate floating
frame:

| Child object | Purpose |
|--------------|---------|
| **RobotToggleButton** | Reachy-style authored toggle root with sphere mesh/material, `Look At`, `RoundButton`, and VFX/title children under **RobotMarkerRoot** |
| **RobotDirectionArrow** | 3D Cylinder/Cone heading gizmo under **RobotMarkerRoot**; **RobotDirectionShaft** is scene-authored along local `+X` (`{x:90,y:90,z:0}` on the shaft). No runtime yaw compensation — semantic heading lives on **RobotMarkerRoot** via `RobotMarker.getRotation()` / `setRotation()` |
| **RobotPlacementHandle** | dedicated manual-placement handle under **RobotMarkerRoot** with authored `Physics Collider`, `Interactable`, and `InteractableManipulation` targeting **RobotMarkerRoot** |
| **RobotUIRoot** | separate UIKit `Frame` under **Rendering** that is world-positioned above **RobotMarkerRoot** and billboarded for readability |
| **RobotMenuTitle** | robot label text under **RobotUIRoot** |
| **RobotMenuStatus** | nav / bridge state text under **RobotUIRoot** |
| **RobotMenuStop** | authored `RectangleButton` under **RobotUIRoot** |
| **RobotMenuStopLabel** | text child under **RobotMenuStop** |
| **RobotMenuEnableNavigation** | authored toggle `RectangleButton` under **RobotUIRoot** |
| **RobotMenuEnableNavigationLabel** | text child under **RobotMenuEnableNavigation** |

The 3D sphere toggle only shows/hides **RobotUIRoot** during runtime. It does
**not** pause the Lens, hide **MainUI**, or change bridge state.

During manual alignment, this same robot-local marker is reused for placement:
spawn it once below the setup wizard panel, then let the user grab the
dedicated **RobotPlacementHandle** to place **RobotMarkerRoot** on the robot.
Manual placement must be exclusive: disable the robot toggle/menu interactions
while the placement handle is active. Do not keep the marker anchored to the
follow-enabled wizard frame after that initial spawn. `RobotUIRoot` should
follow the robot marker by world position only; it must not stay parented under
the rotated robot subtree.

Lens may visually level the initial spawn pose for usability, but the submitted
manual candidate must remain the raw world transform of `RobotMarkerRoot`. The
bridge is the single owner of calibration-time yaw-only leveling.

### Surface placement prefab contract

Manual navigation placement no longer uses an authored `NavPlacementRoot`
hierarchy. Keep `SurfacePlacement.lspkg` installed and use
`Assets/Prefabs/SurfacePlacementMarker.prefab` plus the scene-authored
`SurfacePlacementMarker` instance as the runtime contract.

`NavigationMarkerView` now binds the scene-authored `SurfacePlacementMarker`
instead of spawning a duplicate at runtime. Placement mechanics should still
stay aligned with the SurfacePlacement package's continuous update structure,
but project code intentionally forks the hit-resolution behavior: while the
marker is visible and not executing, valid surface hits always own placement,
and the marker must not fall back to a camera-driven pose.

Code resolves the required runtime subtree from the bound scene instance and
must not re-author or rename nodes inside the prefab/scene hierarchy. The
authoritative nodes are:

| Prefab node | Purpose |
|-------------|---------|
| **CalibrationSceneVisual** | root subtree for the floor marker; should not add a conflicting root `LookAt` behavior over placement rotation |
| **Circle_Seeking** | drag surface / placement ring (legacy name: **PortalCircle**) |
| **Circle_Executing** | saturated ring shown while navigating |
| **NavigationHeadingRoot** | dedicated heading pivot for semantic nav yaw; keep non-arrow visuals out of this subtree |
| **MoveDirectionArrow** | flat textured plane under **NavigationHeadingRoot**; keep it parallel to the ground with one stable authored correction rather than layered runtime compensation |
| **ConfirmButton** | explicit confirm or cancel action |
| **Dots** | retained in both placing and executing states |
| **Arrow** | present in the prefab but ignored by the current implementation |

Gameplay code now binds the `SurfacePlacementMarker` already present in
`Scene.scene`, so scene edits to that marker should be reflected directly at
runtime.

`RotationRoot` is reserved for billboard/UI content such as `ConfirmButton`
and `Dots`. Do not use it as the semantic heading pivot.

### Robot marker assets

The authored robot marker assets now live under the project-level mesh and material folders:

- `Assets/Meshes/Main_sphere_default_normals.mesh`
- `Assets/Materials/Shaders/AnimatedNoiseWaves.ss_graph`
- `Assets/Materials/ActivityIndicator_*.mat`

## 4. Wire `@input` references

| Component | Field | Target |
|-----------|-------|--------|
| SetupWizard | dimosManager | DimosManager (on **DimOS**) |
| SetupWizard | uiManager | UIManager (on **MainUI**) |
| SetupWizard | tagAlignmentSession | TagAlignmentSession |
| UIManager | mainUIFrame | **MainUI** scene object (sibling of SetupWizard, not the parent) |
| UIManager | dimosManager | DimosManager |
| UIManager | setupWizard | SetupWizard (script on **SetupWizard** object) |
| BridgeClient | defaultBridgeIp | Your Mac's LAN IP, bare IP only (e.g. `192.168.1.166`) |
| DimosManager | bridgeClient | BridgeClient (on **DimOS**) |
| DimosManager | frameCaptureController | FrameCaptureController (on **Camera Object**) |
| DimosManager | pointCloudRenderer | PointCloudRenderer (on **PointCloudRenderer** under **Rendering**) |
| DimosManager | placementRayOrigin | **Camera Object** (tracked camera root used for placement ray fallback) |
| DimosManager | robotMarker | RobotMarker (on **Rendering**) |

> **Note:** `DimosManager` no longer has a `lineMaterial` input. `PathRenderer` clones `InteractorLineMaterial.mat` from **Spectacles Interaction Kit** at runtime (`requireAsset` on the SIK package path). If a `lineMaterial` field was previously wired in the Inspector, it can be safely removed.
| FrameCaptureController | bridgeClient | BridgeClient |
| FrameCaptureController | cameraObject | **Camera Object** |
| TagAlignmentSession | bridgeClient | BridgeClient |
| TagAlignmentSession | frameCapture | FrameCaptureController |
| BridgeClient | internetModule | **Internet Module** asset (see below) |
| PointCloudRenderer | pointParent | **LidarPoints** (must contain **LidarHeightVisual** child for full LiDAR) |
| PointCloudRenderer | obstacleVisual | **LidarObstacleVisual** (`RenderMeshVisual` → `LidarObstacle.mat`) |
| RobotMarker | markerRoot | **RobotMarkerRoot** (child of **Rendering**) |

### LiDAR materials

Both lidar layers use the vertex-color unlit shader:

| Asset | Role |
|-------|------|
| `Assets/Materials/Shaders/unlit_LiDAR.ss_graph` | Vertex-color unlit pass used by the LiDAR materials |
| `Assets/Materials/LidarHeight.mat` | Height/debug cubes (alpha blend, vertex-colored height gradient) |
| `Assets/Materials/LidarObstacle.mat` | Proximity obstacle cubes (alpha blend, red) |

If preview logs `missing a material pass` or `!passList.empty()`, confirm
`LidarHeight.mat` / `LidarObstacle.mat` still reference `Assets/Materials/Shaders/unlit_LiDAR.ss_graph` and
that duplicate `unlit 2` / `uber_unlit` shader copies are not present.

### Lens Studio MCP (assets + scene)

Prefer MCP for: listing/creating/moving/deleting assets, reading or patching scripts under `Assets/`, inspecting the scene graph, and setting component properties — instead of hand-editing YAML scene/material files.

For Lens scene objects specifically, prefer MCP scene operations over direct
`Scene.scene` editing. Treat raw `Scene.scene` edits as a fallback for cases the
Lens Studio MCP cannot express.

**Manual-only exception:** Internet Module (see below).

`SetupWizard` still has a `uiManager` script input for scene compatibility, but
runtime HUD visibility is now derived from app phase instead of `UIManager`
owning lifecycle side effects.

### Internet Module (manual)

MCP cannot add this asset automatically (use MCP for almost all other assets):

1. **+ Add Asset → Internet Module**
2. On **BridgeClient** (under **DimOS**), assign it to **Internet Module**

### Native Spectacles modules (code-wired)

`DimosManager` now obtains `WorldQueryModule` directly in code via
`require("LensStudio:WorldQueryModule")`. Do not create an Inspector asset
input for that module.

### Real-world placement prerequisites

The manual navigation flow should keep the marker surface-owned at all times
while it is visible and not executing. The controller continuously resolves the
marker pose against floor hits near the current marker position, and drag moves
on a stable horizontal plane before being snapped back onto the detected
surface. For reliable device placement:

1. Run on Spectacles with a session/environment where `WorldQueryModule` can
   produce stable surface hits.
2. Keep **Camera Object** wired to `DimosManager.placementRayOrigin`; the
   project may still use it as a reference transform, but marker placement must
   not fall back to a camera-owned pose while the marker is visible.
3. Do not add a dedicated world-mesh asset just to make placement work. Full
   world mesh can still be useful for debugging or occlusion, but responsive nav
   placement should come from `WorldQueryModule`.
4. The current placement filter should stay package-like: upward-facing floor
   normals are the authoritative check for horizontal placement.

## 5. Runtime-built vs scene-authored

Keep this split intentional:

- **Scene-authored:** `MainUI` title/status/restart/debug/emergency-stop objects, submenu toggle, Manual/Agent mode selector, mode content containers, robot marker/toggle/arrow subtree, floating `RobotUIRoot` frame, manual-mode `EnableNavigation` toggle
- **Runtime-instantiated:** `SetupWizard` inner content only
- **Scene-authored and code-bound:** `SurfacePlacementMarker`

The runtime architecture is intentionally split this way:

- `DimosManager`: main public facade/orchestrator
- `AppState`: minimal durable app/runtime state
- `SetupWizard`: setup-flow UI adapter
- `UIManager`: runtime HUD presentation

## 6. Verify

Push to Spectacles. On launch, the setup wizard should appear immediately at the
Start step, then proceed through Connect and Calibrate. After a successful
connection, the status line shows bridge connectivity, robot identity, stream
state, and calibration status from `hello` plus `bridge_status`.

If calibrate shows **`Bridge Error (CODE)`**, look up the code in
[`dimos-xr/ERROR_CODES.md`](../../dimos-xr/ERROR_CODES.md).

For the navigation foundation pass, validate in this order:

1. Bridge first: run `dimos-xr/blueprints/dimos_xr.py` from the DimOS `.venv`
   with the desired `DIMOS_XR_STACK`, then verify the bridge starts and the
   `bridge_status` stream is healthy.
2. Lens compile and scene wiring: confirm `DimosManager` has `placementRayOrigin` wired and the
   Lens compiles without TypeScript errors.
   Do not run compile-with-logs as the default verification step; only use it
   after a compile/runtime error occurs and additional diagnostics are needed.
3. Setup flow: on device, walk through connect -> auto align -> manual align fallback and confirm
   both paths reach committed calibration. For manual alignment, confirm the marker spawns
   once below the wizard panel, then stays world-anchored while the user grabs and places it.
   After tapping **Complete**, confirm the placed marker stays visible and fixed while the
   bridge commit is pending instead of snapping back to the wizard.
4. Runtime HUD flow: verify the MainUI submenu expands/collapses, **Manual** and
   **Agent** selection is exclusive, and switching to **Manual** does not start
   placement until **Enable Navigation** is toggled on.
5. Manual placement flow: in **Manual** mode, toggle **Enable Navigation** from
   either HUD, confirm the other toggle updates immediately, and verify the
   scene-authored `SurfacePlacementMarker` resets near the robot pose and then
   stays snapped to the detected floor while placing.
6. Drag flow: grab `Circle_Seeking`, verify drag moves on a stable horizontal
   plane, remains surface-aligned while visible, release, drag again without
   accepting on release, and confirm `ConfirmButton` is the only acceptance
   path.
7. Show LiDAR: with bridge connected, toggle **Show LiDAR** off and confirm red
   obstacle cubes remain visible; toggle on to show the height layer. Offline
   (no bridge), Show LiDAR on shows height-only mock preview (no mock obstacles).
8. Execute/cancel flow: after tapping **Confirm**, verify the marker keeps
   `Dots`, does not shrink `Circle_Seeking`, hides `PlaceText`, and changes the
   button to **Cancel** with `Special` styling. Tapping **Cancel** should fire
   once, follow the same stop path as emergency stop, and return the marker to
   placing at the same pose.
9. Robot-local controls: confirm the robot marker menu toggle follows odometry,
   the robot-local **Enable Navigation** button mirrors the HUD state, and the
   emergency stop path works from both the HUD and robot-local menu.

See [`dimos-xr/PROTOCOL.md`](../../dimos-xr/PROTOCOL.md) for the WebSocket protocol schema.
