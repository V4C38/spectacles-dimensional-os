# Contributing — spectacles-dimensional-os

This monorepo has three main parts:

| Part | Path | Role |
|------|------|------|
| **dimos-ar** | [`dimos-ar/`](dimos-ar/) | `ARModule` (`dimos.ar`) |
| **ClientCore** | [`clients/core/`](clients/core/) | Headset-agnostic TypeScript |
| **Spectacles Lens** | [`clients/specs/`](clients/specs/) | Current v19 Lens Studio project — setup wizard, runtime HUD, navigation, robot visuals |

Host folders stay lowercase: `clients/specs/` (Lens Studio project) and `clients/webxr/` (empty).
The client rewrite plan is [`clients/v2_plan.md`](clients/v2_plan.md).

The cross-platform contract is [`dimos-ar/PROTOCOL.md`](dimos-ar/PROTOCOL.md). The Mac runs the WebSocket server on port **8787**; Spectacles connects as a client.

Open the Lens project from [`clients/specs/spectacles-dimensional-os.esproj`](clients/specs/spectacles-dimensional-os.esproj), **not** the repo root.

## Before you open a PR

```bash
./launcher/scripts/run-ci.sh
```

This runs `dimos-ar` (ruff, mypy, pytest), `clients/core` (Vitest), and `clients/specs/Tests` (Vitest), matching [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

Do **not** run it inside the Cursor agent sandbox — DimOS logging writes under
`~/.local/state/dimos/logs/`, and sandboxed runs fail with
`PermissionError: [Errno 1] Operation not permitted`. Use a normal terminal, or
ask the agent to run with unrestricted (`all`) permissions.

## Scene wiring

Wire cross-tree references on [`ARBridgeServices`](clients/specs/Assets/Scripts/App/ARBridgeServices.ts) (`bridgeSession`, `frameCaptureController`, `robotMarker`, `pointCloudRenderer`, `navigationMarkerPrefab`). Point `ARBridgeCoordinator` at `ARBridgeServices`; point `RegistrationWizard` and `UIManager` at `ARBridgeCoordinator`. On `UIManager`, also wire `mainUIFrame`, `registrationWizard`, and `wristMenuRoot` (required for the Spectacles wrist menu).

Do **not** edit `.scene` files by hand. Use the Lens Studio MCP tools for scene-object investigation and manipulation.

## Lens architecture

**Scene entry scripts**

| Script | Role |
|--------|------|
| [`ARBridgeServices.ts`](clients/specs/Assets/Scripts/App/ARBridgeServices.ts) | Composition root — `@input`s and plain runtime service instances |
| [`ARBridgeCoordinator.ts`](clients/specs/Assets/Scripts/App/ARBridgeCoordinator.ts) | Phase/mode lifecycle, disconnect teardown |
| [`RegistrationWizard.ts`](clients/specs/Assets/Scripts/App/Registration/RegistrationWizard.ts) | Connect → register → hand off to runtime |
| [`UIManager.ts`](clients/specs/Assets/Scripts/App/UI/UIManager.ts) | HUD from derived app state |

**Bridge layer** (`clients/specs/Assets/Scripts/ARBridge/`)

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

## App-layer naming (`clients/specs/Assets/Scripts/App/`)

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

- `dimos-ar/dimos/ar/websocket/protocol.py`
- `dimos-ar/PROTOCOL.md`
- `clients/core/websocket/protocol.ts`

Never edit DimOS source — import from the installed `dimos` package. Keep `dimos-ar/dimos/ar/` platform-agnostic. Portable TypeScript stays in `clients/core/`; Specs-specific code stays in `clients/specs/`.

## Tests

```bash
# Portable client (Vitest)
cd clients/core && npm test

# Lens v19 (Vitest)
cd clients/specs/Tests && npm test

# ARModule (DimOS .venv)
cd dimos-ar
/path/to/dimos/.venv/bin/python3 -m pytest
```

Vitest for ClientCore lives in `clients/core/tests/`. Lens v19 tests stay under `clients/specs/Tests/unit/`. Do not put `*.test.ts` under `clients/specs/Assets/`.
