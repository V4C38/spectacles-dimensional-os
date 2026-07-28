# Contributing — spectacles-dimensional-os

This monorepo has two main parts:

| Part | Path | Role |
|------|------|------|
| **dimos-ar** | [`dimos-ar/`](dimos-ar/) | Platform-agnostic WebSocket bridge on top of DimOS (`ARBridge`, protocol, robot profiles) |
| **Spectacles Lens** | [`lens-studio/`](lens-studio/) | Lens Studio client — setup wizard, runtime HUD, navigation, robot visuals |

The cross-platform contract is [`dimos-ar/PROTOCOL.md`](dimos-ar/PROTOCOL.md) (currently **v16**). The Mac runs the WebSocket server on port **8787**; Spectacles connects as a client.

Open the Lens project from [`lens-studio/spectacles-dimensional-os.esproj`](lens-studio/spectacles-dimensional-os.esproj), **not** the repo root.

## Before you open a PR

```bash
./launcher/scripts/run-ci.sh
```

This runs `dimos-ar` (ruff, mypy, pytest) and `lens-studio/Tests` (Vitest), matching [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

Do **not** run it inside the Cursor agent sandbox — DimOS logging writes under
`~/.local/state/dimos/logs/`, and sandboxed runs fail with
`PermissionError: [Errno 1] Operation not permitted`. Use a normal terminal, or
ask the agent to run with unrestricted (`all`) permissions.

## Scene wiring

Wire cross-tree references on [`ARBridgeServices`](lens-studio/Assets/Scripts/App/ARBridgeServices.ts) (`bridgeSession`, `frameCaptureController`, `robotMarker`, `pointCloudRenderer`, `navigationMarkerPrefab`). Point `ARBridgeCoordinator` at `ARBridgeServices`; point `RegistrationWizard` and `UIManager` at `ARBridgeCoordinator`. On `UIManager`, also wire `mainUIFrame`, `registrationWizard`, and `wristMenuRoot` (required for the Spectacles wrist menu).

Do **not** edit `.scene` files by hand. Use the Lens Studio MCP tools for scene-object investigation and manipulation.

## Lens architecture

**Scene entry scripts**

| Script | Role |
|--------|------|
| [`ARBridgeServices.ts`](lens-studio/Assets/Scripts/App/ARBridgeServices.ts) | Composition root — `@input`s and plain runtime service instances |
| [`ARBridgeCoordinator.ts`](lens-studio/Assets/Scripts/App/ARBridgeCoordinator.ts) | Phase/mode lifecycle, disconnect teardown |
| [`RegistrationWizard.ts`](lens-studio/Assets/Scripts/App/Registration/RegistrationWizard.ts) | Connect → register → hand off to runtime |
| [`UIManager.ts`](lens-studio/Assets/Scripts/App/UI/UIManager.ts) | HUD from derived app state |

**Bridge layer** (`lens-studio/Assets/Scripts/ARBridge/`)

| Module | Role |
|--------|------|
| `Network/` | `ARBridgeSession`, `WebSocketTransport`, `InboundProcessor`, `Protocol.ts` |
| `Session/InboundRouter` | Fan-out inbound signals to domain clients |
| `Registration/RegistrationClient` | Single owner of bridge registration session |
| `Navigation/NavigationClient` | Goal send/cancel, nav status |
| `Telemetry/`, `Status/`, `Camera/` | Pose, bridge status, capture lifecycle |

**Operating modes** (runtime, after registration): `manual` and `agent` both keep the navigation UI armed (marker, path, cancel). Goal provenance is `nav_status.goal.source` (`user` \| `agent`). `registrationMode` disarms navigation.

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

## Protocol changes

When the WebSocket contract changes, update in the same change:

- `dimos-ar/dimos/ar/network/protocol.py`
- `dimos-ar/PROTOCOL.md`
- `lens-studio/Assets/Scripts/ARBridge/Network/Protocol.ts`

Never edit DimOS source — import from the installed `dimos` package. Keep `dimos-ar/dimos/ar/` platform-agnostic; Spectacles-specific code stays under `lens-studio/`.

## Tests

```bash
# Lens (Vitest)
cd lens-studio/Tests && npm test

# Bridge (DimOS .venv)
cd dimos-ar
/path/to/dimos/.venv/bin/python3 -m pytest
```

Vitest covers unit files under `lens-studio/Tests/unit/` (protocol, `AppState`, `InboundRouter`, registration, navigation, camera lifecycle, and related utilities). Do not put `*.test.ts` under `lens-studio/Assets/`.
