# Contributing — Spectacles Lens Studio

Open the project from [`lens-studio/spectacles-dimensional-os.esproj`](lens-studio/spectacles-dimensional-os.esproj), not the repo root.

## Scene wiring

Wire cross-tree references on [`ARBridgeServices`](lens-studio/Assets/Scripts/App/ARBridgeServices.ts) (`bridgeSession`, `frameCaptureController`, `robotMarker`, `pointCloudRenderer`, `navigationMarkerPrefab`). Point `ARBridgeCoordinator` at `ARBridgeServices`; point `RegistrationWizard` and `UIManager` at `ARBridgeCoordinator`. On `UIManager`, also wire `mainUIFrame`, `registrationWizard`, and `wristMenuRoot` (required for the Spectacles wrist menu).

Do **not** edit `.scene` files by hand. Use the Lens Studio MCP tools for scene-object investigation and manipulation.

## Runtime HUD

- **Editor:** after registration, `UIManager` shows MainUI as a floating panel.
- **Spectacles:** MainUI is hidden until the user shows their palm; `WristMenuController` interpolates the panel toward `wristMenuRoot` while `PalmGestureGate` debounces show/hide.
- **Debug mode:** `MainMenuView` exposes a toggle wired to `AppState.debugMode`. When enabled, `RobotMarker` shows direction overlays and `UILogger` streams diagnostics into the on-device log panel, including a dedicated camera capture status line driven by derived `CameraCaptureState`.
- **Restart registration:** MainUI "Restart" calls back into `RegistrationWizard`, which re-enters registration via `ARBridgeCoordinator.enterRegistration()`.

## Runtime camera capture

Ownership (do not duplicate lifecycle elsewhere):

| Component | Owns |
|-----------|------|
| `CameraCaptureSession` | Capture intent (`obsBudget`), gate debounce, `beginCameraCapture` / `endCameraCapture` |
| `FrameCaptureController` | `deriveCameraCapture`, `applyCapture`, `DeviceCameraStream` start/stop |
| `CameraClient` | `camera_info`, JPEG pipeline, ACK-gated cadence |
| `StatusClient` | Inbound `capture_policy` |
| `WorldFrameRefiner` / `SimilarityAligner` (bridge) | `CaptureEpisodeState`; sets `capturing_budgeted_complete` on the frame ACK |

Runtime arming uses **pose speed** from `TelemetryClient`, not `nav_status`. The bridge sends `capture_policy` after the first `camera_info`; the Lens must not use hardcoded gate defaults at runtime. Gate failure while intent remains active yields `waiting`; capture ends on `capturing_budgeted_complete`, registration end, or disconnect.

**Log signatures:**

| Log | Meaning |
|-----|---------|
| Lens `FrameCaptureController: camera capture ON state=... reason=...` | Physical camera started |
| Lens `FrameCaptureController: camera capture OFF state=waiting reason=gate_pause` | Gated pause; intent still active |
| Lens `FrameCaptureController: camera capture OFF state=off reason=episode_complete` | Budgeted episode finished |
| Bridge `AR camera intrinsics received` | Usually once per hardware activation (`camera_info`) |

## App-layer naming (`lens-studio/Assets/Scripts/App/`)

Same suffix = same role across feature modules.

| Suffix | Role |
|--------|------|
| **`*Presenter`** | Domain/app state → scene visuals (prefab lifecycle, drives views/renderers) |
| **`*Flow`** | Multi-step wizard lifecycle (`RegistrationFlow`) |
| **`*Placement`** / feature **`*Controller`** | Ongoing feature shell: state machine, bridge I/O (`NavigationController`) |
| **`*View`** / **`*UiView`** | HUD or prefab visual binding; no domain logic |
| **`*Renderer`** | World drawing (lines, point clouds) |
| **`*Controller`** (input) | User input only (`GroundPlacement`) |
| **`App/Utilities/`** | Cross-cutting helpers (`AnimationUtilities`, `Utilities.ts`) |

Wiring (no renames): [`ARBridgeServices.ts`](lens-studio/Assets/Scripts/App/ARBridgeServices.ts) = composition root; [`ARBridgeCoordinator.ts`](lens-studio/Assets/Scripts/App/ARBridgeCoordinator.ts) = phase orchestration.

## Protocol changes

When the WebSocket contract changes, update in the same change:

- `dimos-ar/dimos/ar/network/protocol.py`
- `dimos-ar/PROTOCOL.md`
- `lens-studio/Assets/Scripts/ARBridge/Network/Protocol.ts`

## Tests

```bash
cd lens-studio/Tests && npm test
```

Vitest covers unit files under `lens-studio/Tests/unit/` (protocol, `AppState`, `InboundRouter`, registration, navigation, camera lifecycle — `CameraCaptureSession`, `FrameCaptureController`, `cameraClientCadence` — `palmGestureGate`, `cameraStopBurst`, and related utilities).

Bridge tests run from the DimOS `.venv` under `dimos-ar/`.
