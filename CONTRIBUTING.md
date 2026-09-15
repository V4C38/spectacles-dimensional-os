# Contributing — spectacles-dimensional-os

This monorepo has four main parts:

| Part | Path | Role |
|------|------|------|
| **dimos-ar** | [`dimos-ar/`](dimos-ar/) | `ARModule` (`dimos.ar`) |
| **ClientCore** | [`clients/specs/Assets/Scripts/DimOSARClient/`](clients/specs/Assets/Scripts/DimOSARClient/) | Headset-agnostic TypeScript, currently in the Specs project. `clients/core/` is empty until ClientCore ships as an `.lspkg`. |
| **Specs client** | [`clients/specs/`](clients/specs/) | Lens Studio project. Composition root `DimOSSpecsClient`; portable core `DimOSARClient`. |
| **WebXR client** | [`clients/webxr/`](clients/webxr/) | WebXR host. Composition root `DimOSWebXRClient`. Select HMD on the landing page (Quest 3 / Quest 3S today). |

Host folders stay lowercase: `clients/specs/` (Lens Studio project) and `clients/webxr/` (Vite / XR Blocks app).

The cross-platform contract is [`dimos-ar/PROTOCOL.md`](dimos-ar/PROTOCOL.md). The Mac runs the WebSocket server on port **8787**; Specs and WebXR connect as clients.

Open the Lens project from [`clients/specs/spectacles-dimensional-os.esproj`](clients/specs/spectacles-dimensional-os.esproj), **not** the repo root.

Open Cursor from [`spectacles-dimensional-os.code-workspace`](spectacles-dimensional-os.code-workspace) only — one folder, this repo. Do not add `../dimos` as a second workspace root; import the installed `dimos` package. In Lens Studio, Asset Browser settings: **Automatically Synchronize Assets Directory** must be on, or edits from Cursor never reach the running Lens. If scripts look stale, close Lens, delete `clients/specs/Cache/` and the leftover `clients/specs/Assets/Assets/` tree, reopen the `.esproj`.

ClientCore production source is [`clients/specs/Assets/Scripts/DimOSARClient/`](clients/specs/Assets/Scripts/DimOSARClient/). Tests live in [`clients/specs/Tests/DimOSARClient/`](clients/specs/Tests/DimOSARClient/) so Lens Studio does not compile Vitest. `clients/core/` is empty (`.gitkeep`) until that code ships as an `.lspkg` and is imported back into the Lens. Do not duplicate it.

## Before you open a PR

```bash
./launcher/scripts/run-ci.sh
```

This runs `dimos-ar` (ruff, mypy, pytest), `clients/specs/Tests` (Vitest, including ClientCore), and `clients/webxr` (`client-webxr-tests`), matching [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

Do **not** run it inside the Cursor agent sandbox — DimOS logging writes under
`~/.local/state/dimos/logs/`, and sandboxed runs fail with
`PermissionError: [Errno 1] Operation not permitted`. Use a normal terminal, or
ask the agent to run with unrestricted (`all`) permissions.

## Scene wiring

The composition root is **`DimOSSpecsClient`**. Platform scene objects stay
`Camera Object`, `Lighting`, `SpectaclesInteractionKit`, and `World Mesh`.
`RobotPresenter` is the one Specs-world robot location: the script writes its
transform, and navigation reads it. The floor marker is
`NavigationTargetMarker.prefab`, wired as `DimOSSpecsClient.navGoalMarkerPrefab`.
`LidarPresenter` is never parented or anchored to `RobotPresenter`.

Do **not** edit `.scene` files by hand. Use the Lens Studio MCP tools for scene-object investigation and manipulation.

## Lens architecture

**Scene entry**

| Script | Role |
|--------|------|
| [`DimOSSpecsClient.ts`](clients/specs/Assets/Scripts/DimOSSpecsClient/DimOSSpecsClient.ts) | Composition root. Constructs `ClientCore` dependencies, drives `UpdateEvent` ticks, routes typed facts, tears down. Does not mirror portable state. |

**Portable owners** (under `Assets/Scripts/DimOSARClient/`)

| Owner | Stores |
|-------|--------|
| `ARModuleSession` | Connection and newest wire facts (`hello`, `state`, `pose`, `nav_goal`, `lidar`) |
| `ClientTrackingOriginStore` | The one `T_odom_client` |
| `LocalizationCaptureEpisode` | Current localization request and observations |

**Specs logic** (tracked room)

| Module | Role |
|--------|------|
| `SpecsCoordinates.ts` | One `SPECS_BASIS`; DimOS `odom` ↔ Specs |
| `websocket/` | `SpecsWebSocketTransport` |
| `localization/` | `SpecsCameraStream`, `SpecsCameraSource` (tracking + async capture ports) |
| `presentation/RobotPresenter.ts` | Composed `pose` on the authored `RobotPresenter` scene object |
| `sensors/` | `PointCloudRenderer` — each `lidar` point from `odom` independently |
| `navigation/` | `GroundPlacement`, `NavigationController`, `NavGoalPresenter` |

**Specs UX** (what the wearer reads or presses)

`SetupWizard` / `UIPresenter` derive copy, visibility, and buttons from
`session.view()` and `episode.view()`. They call existing ClientCore commands
(`requestNavGoal`, `requestLidarSettings`, `requestUserMessage`,
`session.requestEstop`, `session.requestState`, `episode.requestStart`).
`AppState.operatingMode` is the Specs-host Agent/Manual gate. STT and TTS stay
on the host; the wire carries text and typed agent facts only.

## WebXR architecture

**Entry**

| Script | Role |
|--------|------|
| [`DimOSWebXRClient.ts`](clients/webxr/src/DimOSWebXRClient.ts) | Composition root. Constructs `ClientCore` dependencies, drives XR ticks, routes typed facts, tears down. Does not mirror portable state. |

**WebXR logic**

| Module | Role |
|--------|------|
| `WebXRCoordinates.ts` | One `WEBXR_BASIS`; DimOS `odom` ↔ WebXR |
| `websocket/` | `BrowserWebSocketTransport` |
| `camera/` | `HmdCameraSource` (tracking + async capture ports), `HmdCalibration`, `hmdProfiles` |
| `presentation/` | Robot, Lidar renderer, Route renderer, AR markers, UI, `MainMenuView` |
| `navigation/` | `WebXRGroundPlacement`, `WebXRNavigationController`, `WebXRNavGoalView`, `WebXRJoystick` |

The landing page **Select HMD** list is `HMD_OPTIONS`. Current options: Quest 3 and Quest 3S. Unaccepted calibration profiles fail before XR entry. Vite proxies same-origin `/ar` to `ws://127.0.0.1:8787`. WebXR imports ClientCore from `DimOSARClient/`; it does not copy it.

## Runtime HUD

- **Editor:** after `hasTrackingOrigin`, the runtime HUD is a floating panel.
- **Specs:** the HUD is hidden until the wearer shows their palm;
  `WristMenuController` interpolates toward the wrist root while
  `PalmGestureGate` debounces show/hide.
- **Debug:** pose copy and capture status come from session and episode views
  through `SpecsCoordinates` (one `SPECS_BASIS`). `AppState.debugModeEnabled`
  gates the debug overlay and agent-mode access when the agent capability is off.
- **Restart setup:** the HUD offers a full wizard restart (`restartSetup()`).

## Runtime camera capture

One owner: `SpecsCameraSource` implements both ClientCore tracking and
capture ports. It owns pose history and delegates stream lifecycle to
`SpecsCameraStream`.

Working sequence (keep it): `SpecsCameraStream.requestNextFrame()` → pose at
`timestampSeconds` → optical extrinsics/intrinsics → `Base64.encodeTextureAsync`.
The portable port is `start` / async `capture` / `stop`.
`LocalizationCaptureEpisode` awaits one in-flight capture and stops hardware on
send, failure, reset, and disposal.

Do not add ACK/`seq`, a standing camera-policy message, a `camera_info` wire
message, or a second capture state store. Capture policy is a field on
`localization_observations_request`.

WebXR's one camera owner is `HmdCameraSource`: same ClientCore ports, `getUserMedia`, and an accepted `HmdCalibrationProfile`.

## Host-layer naming (`clients/specs/Assets/Scripts/DimOSSpecsClient/` and `clients/webxr/src/`)

Same suffix = same role.

| Suffix | Role |
|--------|------|
| **`*Presenter`** | Typed session facts → scene visuals. No portable pose cache. |
| **`*Placement`** / feature **`*Controller`** | World-mesh input and command effects (`GroundPlacement`, `NavigationController`, `WebXRGroundPlacement`, `WebXRNavigationController`). No host navigation execution store. |
| **`*View`** | HUD or prefab visual binding; no domain logic (`MainMenuView`, `WebXRNavGoalView`) |
| **`*Renderer`** | World drawing (lines, point clouds) (`PointCloudRenderer`, `LineRenderer`, `WebXRLidarRenderer`, `WebXRRouteRenderer`) |
| **`utilities/`** | Cross-cutting helpers, only if retained UX uses them |

TypeScript files and classes use PascalCase, properties use camelCase, scene
objects use PascalCase, wire fields keep protocol spelling (`nav_goal`,
`path_poses`, `lidar`, `T_odom_client`).

## Protocol changes

When the WebSocket contract changes, update in the same change:

- `dimos-ar/dimos/ar/websocket/protocol.py`
- `dimos-ar/PROTOCOL.md`
- `clients/specs/Assets/Scripts/DimOSARClient/websocket/protocol.ts`

Never edit DimOS source — import from the installed `dimos` package. Keep `dimos-ar/dimos/ar/` platform-agnostic. ClientCore lives in `clients/specs/Assets/Scripts/DimOSARClient/` until the `.lspkg` split; do not put Specs, Lens, or WebXR APIs in that tree. Specs-specific code stays under `DimOSSpecsClient/`. WebXR-specific code stays under `clients/webxr/src/`.

## Tests

```bash
# ClientCore + Specs helpers
cd clients/specs/Tests && npm test

# WebXR host
cd clients/webxr && npm test

# ARModule (DimOS .venv)
cd dimos-ar
/path/to/dimos/.venv/bin/python3 -m pytest
```

Vitest for ClientCore lives in `clients/specs/Tests/DimOSARClient/`. Specs helper
tests live under `clients/specs/Tests/DimOSSpecsClient/`.
WebXR tests live under `clients/webxr/tests/`.
Do not put `*.test.ts` under `clients/specs/Assets/`.
