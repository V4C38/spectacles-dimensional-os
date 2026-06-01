# Lens Studio scene setup

Scripts live under `Assets/Scripts/`. After pulling, wire the scene in Lens Studio
(MCP can attach scripts; these steps are manual when asset references are needed).
The live `SetupWizard` scene object is bound to
`Assets/Scripts/Setup/SetupWizard.ts`.

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
| **EmergencyStop** | authored `RectangleButton` scene object replacing the old LiDAR button |
| **EmergencyStopLabel** | text child under **EmergencyStop** |
| **SubMenuToggle** | authored `RectangleButton` scene object used to expand/collapse the mode submenu |
| **SubMenuToggleLabel** | text child under **SubMenuToggle** |
| **SubMenu** | authored UIKit `Frame` containing the mode selector and mode-specific content |
| **ModeManual** | authored toggle button for Manual mode |
| **TextModeManual** | text child under **ModeManual** |
| **ModeAgent** | authored toggle button for Agent mode |
| **TextModeAgent** | text child under **ModeAgent** |
| **ModeManualMenu** | manual-mode content container under **SubMenu** |
| **TextManualMode** | authored descriptive text under **ModeManualMenu** |
| **EnableNavigation** | authored toggle button under **ModeManualMenu** |
| **EnableNavigationLabel** | text child under **EnableNavigation** |
| **ExecuteMovement** | authored toggle button under **ModeManualMenu** |
| **ExecuteMovementLabel** | text child under **ExecuteMovement** |
| **ModeAgentMenu** | agent-mode content container under **SubMenu** |
| **TextAgentMode** | authored descriptive text under **ModeAgentMenu** |

`UIManager` binds those authored children by name and remains presentation-only.
Setup/runtime lifecycle transitions are owned through `DimosManager` + app state.
`DebugMode` now drives LiDAR point-cloud visibility directly, `EmergencyStop`
lives on the main HUD, and the expand/collapse button shows or hides the
mode-based submenu. Selecting **Manual** no longer auto-starts navigation
placement; the manual submenu exposes **Enable Navigation** plus the
**Execute movement** toggle, and both the main HUD toggle and robot-local
toggle reflect the same shared app-state boolean.

## 3. RobotManager hierarchy

**RobotManager** is the **scene object** root for robot/bridge logic (formerly `DimOS_Root`). **DimosManager** is the **script component** on the **DimOS** child — do not confuse the scene name with the TypeScript class.

```
RobotManager          ← scene object (hierarchy root)
├── DimOS              ← BridgeClient + DimosManager scripts
├── Rendering          ← LidarPointCloud, RobotMarker
│   ├── LidarPoints    (empty — point cloud parent)
│   ├── RobotMarkerRoot
│   │   ├── RobotToggleButton
│   │   ├── RobotDirectionArrow
│   │   └── RobotPlacementHandle
│   └── RobotUIRoot
```

**Image Tracking → MarkerAnchor** holds `AlignmentController` (marker detection).

### `RobotMarkerRoot` authored robot UI

The robot marker is split into a rotated marker subtree plus a separate floating
frame:

| Child object | Purpose |
|--------------|---------|
| **RobotToggleButton** | Reachy-style authored toggle root with sphere mesh/material, `Look At`, `RoundButton`, and VFX/title children under **RobotMarkerRoot** |
| **RobotDirectionArrow** | heading indicator under **RobotMarkerRoot**; authored mesh points along local `+Z`, but runtime applies a `+90deg` local yaw correction so it visually matches the app's semantic forward axis (`RobotMarkerRoot` local `+X`) |
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
| **PortalCircle** | drag surface / placement ring |
| **ConfirmButton** | explicit confirm or cancel action |
| **PlaceText** | helper text visible while placing |
| **Dots** | retained in both placing and executing states |
| **Arrow** | present in the prefab but ignored by the current implementation |

Gameplay code now binds the `SurfacePlacementMarker` already present in
`Scene.scene`, so scene edits to that marker should be reflected directly at
runtime.

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
| UIManager | dimosManager | DimosManager |
| UIManager | setupWizard | SetupWizard (script on **SetupWizard** object) |
| DimosManager | bridgeClient | BridgeClient (on **DimOS**) |
| DimosManager | alignmentController | AlignmentController |
| DimosManager | lidarPointCloud | LidarPointCloud (on **Rendering**) |
| DimosManager | placementRayOrigin | **Camera Object** (tracked camera root used for placement ray fallback) |
| DimosManager | robotMarker | RobotMarker (on **Rendering**) |

> **Note:** `DimosManager` no longer has a `lineMaterial` input. The path line material (`InteractorLineMaterial`) is loaded automatically from the SpectaclesInteractionKit package at runtime. If a `lineMaterial` field was previously wired in the Inspector, it can be safely removed.
| AlignmentController | bridgeClient | BridgeClient |
| AlignmentController | markerTracking | Marker Tracking on **Image Tracking** |
| AlignmentController | debugGizmo | (Optional) SceneObject with 3D gizmo for tracking debug |
| BridgeClient | internetModule | **Internet Module** asset (see below) |
| LidarPointCloud | pointParent | **LidarPoints** (child of **Rendering**) |
| RobotMarker | markerRoot | **RobotMarkerRoot** (child of **Rendering**) |

`SetupWizard` still has a `uiManager` script input for scene compatibility, but
runtime HUD visibility is now derived from app phase instead of `UIManager`
owning lifecycle side effects.

### Internet Module (manual)

MCP cannot add this asset automatically:

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
connection, the status line shows bridge mode, robot model, stream state, and
calibration status from `bridge_status`.

For the navigation foundation pass, validate in this order:

1. Replay/web first: run `dimos-ar/blueprints/go2_ar.py` and verify `hello`, `bridge_status`,
   `path`, and `nav_status` from the web client.
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
6. Drag flow: grab `PortalCircle`, verify drag moves on a stable horizontal
   plane, remains surface-aligned while visible, release, drag again without
   accepting on release, and confirm `ConfirmButton` is the only acceptance
   path. In `executeMovement=false`, the marker should still enter its executing
   state locally without sending `nav_goal`.
7. Execute/cancel flow: after tapping **Confirm**, verify the marker keeps
   `Dots`, does not shrink `PortalCircle`, hides `PlaceText`, and changes the
   button to **Cancel** with `Special` styling. Tapping **Cancel** should fire
   once, follow the same stop path as emergency stop, and return the marker to
   placing at the same pose.
8. Robot-local controls: confirm the robot marker menu toggle follows odometry,
   the robot-local **Enable Navigation** button mirrors the HUD state, and the
   emergency stop path works from both the HUD and robot-local menu.

See [`dimos-ar/docs/LENS_DEVELOPMENT.md`](../../dimos-ar/docs/LENS_DEVELOPMENT.md) for protocol and MCP setup.
