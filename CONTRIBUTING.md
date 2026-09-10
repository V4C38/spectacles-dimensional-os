# Contributing — spectacles-dimensional-os

This monorepo has three main parts:

| Part | Path | Role |
|------|------|------|
| **dimos-ar** | [`dimos-ar/`](dimos-ar/) | `ARModule` (`dimos.ar`) |
| **ClientCore** | [`clients/core/`](clients/core/) | Headset-agnostic TypeScript. Groups 1–4 complete. |
| **Spectacles host** | [`clients/specs/`](clients/specs/) | Lens Studio project. Entry is `SpectaclesHost`. Rebuilt in [`clients/v2_plan.md`](clients/v2_plan.md) Groups 5–10. v19 `ARBridge/` and `App/` remain on disk as inactive reference until Group 10 deletes them. |

Host folders stay lowercase: `clients/specs/` (Lens Studio project) and `clients/webxr/` (empty).

The cross-platform contract is [`dimos-ar/PROTOCOL.md`](dimos-ar/PROTOCOL.md). The Mac runs the WebSocket server on port **8787**; Spectacles connects as a client.

Open the Lens project from [`clients/specs/spectacles-dimensional-os.esproj`](clients/specs/spectacles-dimensional-os.esproj), **not** the repo root.

`clients/core/` is the only editable portable source. The Lens cannot import TypeScript from outside its project, so `clients/specs/Assets/Scripts/core/` is a generated mirror of the four production packages. Never edit the mirror. Group 5 adds `clients/specs/scripts/sync-client-core.mjs`; `--check` fails CI on drift.

## Before you open a PR

```bash
./launcher/scripts/run-ci.sh
```

This runs `dimos-ar` (ruff, mypy, pytest), `clients/core` (Vitest), and `clients/specs/Tests` (Vitest), matching [`.github/workflows/ci.yml`](.github/workflows/ci.yml). Group 5 adds generated-mirror `--check` to that gate.

Do **not** run it inside the Cursor agent sandbox — DimOS logging writes under
`~/.local/state/dimos/logs/`, and sandboxed runs fail with
`PermissionError: [Errno 1] Operation not permitted`. Use a normal terminal, or
ask the agent to run with unrestricted (`all`) permissions.

## Scene wiring

The composition root is **`SpectaclesHost`**. Group 5 attaches it as a shell
with no presenter slots, socket, store, or tick. Later groups add the required
server host input, session, camera, presenters, and UX. Platform scene objects
stay `Camera Object`, `Lighting`, `SpectaclesInteractionKit`, and `World Mesh`.
Group 9 creates `Robot`, `GroundMarker`, `Lidar`, and `NavGoal`. `NavGoal` is a
path/spawn parent; `NavGoalMarker.prefab` is instantiated at runtime.
`GroundMarker` is a child of `Robot`. `Lidar` is never parented or anchored to
`Robot`.

Do **not** edit `.scene` files by hand. Use the Lens Studio MCP tools for scene-object investigation and manipulation.

v19 `ARBridgeCoordinator` / `ARBridgeServices` / `FrameCaptureController` stay
disabled as reference until the group that takes each asset deletes it. Do not
re-enable them or wire new code through them.

## Lens architecture

**Scene entry**

| Script | Role |
|--------|------|
| [`SpectaclesHost.ts`](clients/specs/Assets/Scripts/SpectaclesHost.ts) | Composition root. Constructs `ClientCore` dependencies, drives `UpdateEvent` ticks, routes typed facts, tears down. Does not mirror portable state. |

**Portable owners** (imported through the generated `Assets/Scripts/core/` mirror)

| Owner | Stores |
|-------|--------|
| `ARModuleSession` | Connection and newest wire facts (`hello`, `state`, `pose`, `nav_goal`, `lidar`) |
| `ClientTrackingOriginStore` | The one `T_odom_client` |
| `LocalizationCaptureEpisode` | Current localization request and observations |

**Spectacles logic** (tracked room)

| Module | Role |
|--------|------|
| `coordinates/SpectaclesCoordinates.ts` | One `SPECTACLES_BASIS`; DimOS `odom` ↔ Spectacles |
| `websocket/` | `SpectaclesClock`, `SpectaclesWebSocketTransport` |
| `localization/` | `DeviceCameraStream`, `SpectaclesCameraSource` (tracking + async capture ports) |
| `robot/RobotPresenter.ts` | Body and ground marker from `hello.robot` + composed `pose` |
| `sensors/` | `LidarPresenter`, `PointCloudRenderer` — each `lidar` point from `odom` independently |
| `navigation/` | `GroundPlacement`, `NavigationController`, `NavGoalPresenter` |

**Spectacles UX** (what the wearer reads or presses)

`ConnectWizard` / `RuntimeHudView` derive copy, visibility, and buttons from
`session.view()` and `episode.view()` only. They call existing core commands
(`requestNavGoal`, `requestLidarSettings`, `session.requestEstop`,
`session.requestState`, `episode.requestStart`). No `AppState`, no
`operatingMode`, no parallel command layer.

STT / TTS and `agent_skill` wait for the later DimOS agent relay. Do not port
the v19 agent channel.

## Runtime HUD

- **Editor:** after `hasTrackingOrigin`, the runtime HUD is a floating panel.
- **Spectacles:** the HUD is hidden until the wearer shows their palm;
  `WristMenuController` interpolates toward the wrist root while
  `PalmGestureGate` debounces show/hide.
- **Debug:** pose copy and capture status come from session and episode views
  through `SpectaclesCoordinates`. No second basis and no `AppState.debugMode`.
- **Recapture:** the HUD offers `localization_start_request`. There is no
  registration session to restart.

## Runtime camera capture

One owner: `SpectaclesCameraSource` implements both ClientCore tracking and
capture ports. It owns pose history and delegates stream lifecycle to
`DeviceCameraStream`.

Working sequence (keep it): `DeviceCameraStream.requestNextFrame()` → pose at
`timestampSeconds` → optical extrinsics/intrinsics → `Base64.encodeTextureAsync`.
The portable port is `start` / async `capture` / `stop`.
`LocalizationCaptureEpisode` awaits one in-flight capture and stops hardware on
send, failure, reset, and disposal.

Do not add ACK/`seq`, a standing `capture_policy` message, `camera_info`,
`FrameCaptureController`, or a second capture state store.

## Host-layer naming (`clients/specs/Assets/Scripts/`)

Same suffix = same role.

| Suffix | Role |
|--------|------|
| **`*Presenter`** | Typed session facts → scene visuals. No portable pose cache. |
| **`*Placement`** / feature **`*Controller`** | World-mesh input and command effects (`GroundPlacement`, `NavigationController`). No host navigation execution store. |
| **`*View`** | HUD or prefab visual binding; no domain logic |
| **`*Renderer`** | World drawing (lines, point clouds) |
| **`utilities/`** | Cross-cutting helpers, only if retained UX uses them |

TypeScript files and classes use PascalCase, properties use camelCase, scene
objects use PascalCase, wire fields keep protocol spelling (`nav_goal`,
`path_poses`, `lidar`, `T_odom_client`).

## Protocol changes

When the WebSocket contract changes, update in the same change:

- `dimos-ar/dimos/ar/websocket/protocol.py`
- `dimos-ar/PROTOCOL.md`
- `clients/core/websocket/protocol.ts`

Never edit DimOS source — import from the installed `dimos` package. Keep `dimos-ar/dimos/ar/` platform-agnostic. Portable TypeScript stays in `clients/core/`; Specs-specific code stays in `clients/specs/`. Never edit the generated mirror.

## Tests

```bash
# Portable client (Vitest)
cd clients/core && npm test

# Specs host helpers (and remaining v19 tests until Group 10)
cd clients/specs/Tests && npm test

# ARModule (DimOS .venv)
cd dimos-ar
/path/to/dimos/.venv/bin/python3 -m pytest
```

Vitest for ClientCore lives in `clients/core/tests/`. Host helper tests land
under `clients/specs/Tests/unit/` as their source lands (`spectaclesCoordinates`,
`spectaclesCameraSource`). v19 tests remain there until Group 10 removes them.
Do not put `*.test.ts` under `clients/specs/Assets/`.
