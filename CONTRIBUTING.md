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
| `ARModuleSession` | Connection and newest wire facts (`hello`, `state`, `pose`, `nav_goal`, `nav_preview`, `lidar`) |
| `ClientTrackingOriginStore` | The one `T_odom_client` |
| `LocalizationCaptureEpisode` | Current localization request and observations |
| `RobotSelection` | Single-robot selection and eligibility |
| `AgentDraftSession` | Draft and dictation lifecycle |
| `NavigationInteraction` | Navigation interaction intent |
| `NavigationPreviewCoordinator` | Advisory request lifecycle and current preview |

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
| `localization/` | `HmdCameraSource` (tracking + async capture ports), `HmdCalibration`, `HmdProfiles`, `HmdCalibrationRunner` |
| `presentation/` | `WebXRRobotPresenter`, `WebXRARMarkerPresenter`, UI, and shared view/material resources |
| `navigation/` | `WebXRGroundPlacement`, `WebXRNavigationController`, `WebXRNavGoalView`, `WebXRJoystickController`, `WebXRRouteRenderer` |
| `sensors/` | `WebXRLidarRenderer` |
| `utilities/` | `WebXRCoordinates` (one `WEBXR_BASIS`), `BrowserClientClock` |

The same domains run from ARModule through ClientCore to each host:

| ARModule | ClientCore | Specs host | WebXR host |
|---|---|---|---|
| `localization/` | `localization/` | `localization/` | `localization/` |
| `navigation/` | `navigation/` | `navigation/` | `navigation/` |
| `sensors/` | `sensors/` | `sensors/` | `sensors/` |
| `robot/` | `robot/` | `presentation/RobotPresenter` | `presentation/WebXRRobotPresenter` |
| Agent ports in `module.py` and protocol | `agent/` | `agent/` | `agent/` |
| `websocket/` | `websocket/` | `websocket/` | `websocket/` |

Robot visuals remain in each host’s `presentation/`, matching Specs. WebXR-only
`input/` and `diagnostics/` adapt platform services. Shared UI primitives stay in
`presentation/`, while coordinate and clock adapters live in `utilities/`, matching
the Specs utility boundary. Host source filenames use PascalCase, and each exported
host class has a matching filename. Renderers live with their domain; there is no
combined presenters module. `main.ts` and the vendor declaration file retain their
standard entry/declaration names.

The landing page **Select HMD** list is `HMD_OPTIONS`. Current options: Quest 3 and Quest 3S. The selected profile is the camera calibration. Vite proxies same-origin `/ar` to `ws://127.0.0.1:8787`. WebXR imports ClientCore from `DimOSARClient/`; it does not copy it.

ClientCore owns the single robot’s selection (`RobotSelection`), agent draft and
dictation lifecycle (`AgentDraftSession`), navigation interaction intent
(`NavigationInteraction`), and preview request lifecycle (`NavigationPreviewCoordinator`).
`ARModuleSession` remains the owner of authoritative wire facts. There is no robot
registry or multi-connection model. Specs migration to these owners is a separate task.

WebXR converts detected surfaces and poses at its coordinate boundary, then renders
shared snapshots. Browser recognition/synthesis and the calibrated camera remain host
adapters. Holding the draft body records; Send explicitly submits its complete text.
Overflowing drafts use a draggable scrollbar or controller thumbstick; replies and
diagnostics also support press/pinch dragging. Clear resets the draft; each new
recording appends to its existing text. Agent and human fields share one primitive. Views own disposal of their resources.
Input capture authorizes actual button callbacks as well as gestures. Emergency Stop
interrupts capture from either hand and executes once on press.


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
`LocalizationCaptureEpisode` awaits one in-flight capture and keeps the video
stream running between failed batches. It stops hardware on success, pause,
failure, reset, and disposal.
The Specs wizard constructs it initially paused, starts it on the localization
step, and pauses when leaving that step. A pending server prompt is retained
while paused, so reentering the step resumes without a duplicate start request.
After a successful setup scan the handler remains enabled for relocalization;
only skipping or leaving setup without an origin pauses it. After 0.75 m of
robot travel the server prompts again, and the client waits for the geometric
gate before capturing. Marker-only capture rechecks the gate throughout a batch.
Capture uses frames from the existing video stream at 0.5-second spacing; do
not replace it with high-resolution still capture or downsample it further.

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

WebXR setup marks the connection complete after `hello`. Localization guidance follows
the capture policy (AprilTag, VPS, or mixed), and its 5 fps preview shares the
calibrated capture stream without opening another camera or resizing capture frames.
World annotations show a sphere at the exact composed location and a glass label.
Floor circles and dotted connectors belong only to robot/navigation feedback.


The dimOS AR design tokens and `SurfaceButton`, `SurfaceText`, and
`ScrollableTextView` primitives live under WebXR `presentation/`. Pill buttons,
rounded fields, panel corners, colors, and motion are shared across setup and the
runtime menu; the landing page consumes the same tokens as CSS variables. Both
mode switching and setup progress use the segmented-tab primitive. Setup and
runtime show the same robot status badge above their panel.

A menu summoned by a controller button or a palm-up gesture follows that source’s
position, with an upright viewer-facing orientation. Grabbing or resizing detaches
it; the released panel stays at its world pose. Detached panels do not follow the
head or close when the summoning palm turns away.

For WebXR visual changes, include screenshots and a short normal-speed interaction
video. Playwright retains browser video and review scene timestamps; run
`npm run review:video` in `clients/webxr` (requires FFmpeg) to create a roughly
30–40 second `interaction-review.mp4` in each immersive test artifact directory.
These recordings use headset emulation and do not replace physical Quest checks.

WebXR internal UI fills and controls use explicit render order without depth-buffer
writes. The outer panel and robot pill retain depth occlusion. Button text uses a
physical half-millimeter offset rather than the SDK's local-unit gap. Robot outlines
unfold from the body box's floor: horizontal expansion precedes height, and hiding
runs the same progress backward over 320 ms, retaining opacity until the final horizontal collapse, without altering the selection collider.

The landing page binds the same `ARModuleSession` used in AR and ticks only its
connection lifecycle before immersive entry. Camera capture, localization, and
navigation retain their tracking/setup gates. The robot and available capabilities
are the primary landing content; server/robot addresses and build/package versions
from optional `hello.server_info` are a compact footnote.

LiDAR Full mode uses a fixed floor-relative height spectrum; obstacle mode remains
the default after setup and uses red-to-white distance colors. Portable color policy
lives in ClientCore `sensors/lidarColors.ts`. WebXR draws capped round point sprites
in one draw call with reusable buffers and skips unchanged clouds. Setup success
counts visible XR ticks, so system overlays cannot consume its checkmark animation.

Routes use round world-space dots at 50% preview / 75% confirmed opacity; executing routes are solid at 75%. The renderer
anchors the visible remainder at the robot and clips both ends to the actual
rendered circle bounds, including the scaled aiming circle. ClientCore retains the last successful preview during updates and the executing route
during transient empty frames. This changes only presentation; planner paths and confirmed goal poses remain authoritative.

Immersive panels start at 60% of their previous size while preserving resize limits.
Selected floor aiming tracks movement heading before press; press captures that pose
and release confirms once. Floor aiming and its laser are limited to five ray meters;
direct marker dragging retains the normal interaction range and live goal updates.

WebXR near pinch/trigger targets share the SDK hit list and activation lifecycle with
rays; near targeting takes precedence and the gesture mode stays captured until release.
Direct input is sampled from thumb/index joints or controller grip space. Palm menus
use handedness-correct metacarpals and open fingers, and only their summoning source
can follow/dismiss them. Grabbing or source loss pins the panel.

Setup continuously faces the viewer in yaw/pitch with no roll. Runtime UI starts 20%
smaller than setup and follows 18 cm forward / 12 cm above its source. Whole-panel
appearance transforms are separate from user placement and resizing. Browser reviews
frame actual panel bounds closely without changing production sizes.

Browser diagnostics are warnings/errors by default. `?diagnostics=1` enables throttled
development traces; scene inspection (`?debug=1`) does not enable logging. All sinks
share bounded deduplication and retain the first warning/error immediately.
