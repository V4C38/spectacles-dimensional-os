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
| `LocalizationSubmission` | Outstanding capture timestamp and result acceptance deadline |
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
| `navigation/` | `DragPlacementPlane`, `NavigationController`, `NavGoalPresenter` |

**Specs UX** (what the wearer reads or presses)

`SetupWizard` / `UIPresenter` derive copy, visibility, and buttons from
`session.view()` and `episode.view()`. They call existing ClientCore commands
(`requestNavGoal`, `requestLidarSettings`, `requestUserMessage`,
`session.requestEstop`, `session.requestState`, `episode.requestStart`).
Specs setup retains PIN/IP connection entry followed by camera localization. A valid saved
PIN is tried automatically when Connect opens without an established session, and when
switching back to PIN mode. Editing the connection field cancels pending resolution/retries.
Restart is queued until the next update, after native button dispatch, and invalidates
panel scale animations before reopening Connect. Pending connection timers use
`DelayedCallbackEvent.cancel()`; `reset(0)` schedules a callback instead of cancelling it.
Specs setup uses a 29.16 cm width, 25% smaller than its shared baseline.
The runtime main menu uses a
Specs-only uniform scale of 0.2592, 25% smaller than the shared runtime baseline:
its frame and all descendant controls, labels, badges and hit targets scale together.
Its width is 23.328 cm. Specs-only `PanelLayout` profiles compact each page vertically,
up to heights 32.832 cm for setup and 19.6992 cm for runtime. `PanelHeightController` eases height changes over 280 ms around a
fixed top edge; native Frame still owns grabbing and following. Its content offset
keeps headers and mode/step bars fixed, and its follow width stays in world centimetres.
Setup uses Frame’s own follow control, scaled with its icon and collider to the
normal icon-button size after every native frame resize. `ControlPanelPresentation` shares panel/control/message
metrics, segmented spacing, copy, and setup/runtime scale. Specs converts design
metres to Lens centimetres, subtracts SUK Frame’s border/padding from `innerSize`,
and converts WebXR font em heights using SUK’s documented Lens 5.15 system-font
metrics: line height is `size / 32` cm; em height is `0.69492703` times that.
Native text has fitting disabled and uses the corresponding line-spacing
conversion. Bounding-box line cells alone are not glyph-size measurements. Native review asserts the rendered outer bounds and
physical scale. SUK CapsuleButton supplies the pill controls; native Frame,
RoundedRectangle, ScrollWindow, Slider and TextInputField supply styling,
scrolling, keyboard and hand interaction. Fields reuse SUK’s neutral gradients
and borders. Selected controls use one non-toggleable CapsuleButton: model state
selects Primary (filled yellow, white label) or Secondary through the public `button.visual`
setter. Replacing only the visual preserves the collider, interactable and callbacks;
resetting Element initialization would recreate interaction machinery. Native SUK
still owns hover, press and inactive feedback. Setup retains PIN/IP entry before localization; this extra
entry row is the intentional connection-page difference. Resizing is disabled.
Either palm summons the runtime panel at the hand; SUK Frame owns ongoing follow,
border grabbing, movement and billboarding. Grabbing it or losing tracking pins it.
Holding the message field edits a speech draft; release preserves it and only
Send submits it. STT/TTS remain host adapters. Setup opens 90 cm ahead, then
uses Frame’s native SmoothFollow and pins on grab. Setup opens 5 cm above
the viewer’s forward line. The setup status card is unboxed; guidance and
standalone Specs labels are centered except the left-aligned dimOS AR title.
Runtime palm menus are suppressed during
the wizard so a held palm cannot cover a restarted setup. Initial setup keeps Back
unavailable until Connect completes. Reopening setup from runtime permits Back
to dismiss it and restore the retained baseline. Skipping
or completing setup returns to the main runtime page.
The host supplies the calibrated world width to `smoothFollow.resize()` so its
distance clamp uses the visible width rather than the unscaled design size.
There is no custom follow loop, grab implementation, or window bar.

World robot labels use the same Inter regular/semibold fonts and shared
20/28/13 mm em sizes, top anchors, status dot and spacing as WebXR. The native
Inter em/line-cell ratio is calibrated separately from the system UI font.
Hovering the robot or its attached navigation marker highlights both affordances.
After a drag detaches the marker, their hover visuals are independent;
Cancel is excluded and draft ownership is respected. Selection and navigation
Cancel dispatch on press. Setup and navigation outcomes share WebXR’s traced
ring/check/cross geometry. Authored setup/runtime controls and obsolete marker
VFX/text are removed through Lens Studio MCP; Frame/odometry/debug hosts remain.

Specs adds a straight, tapered beam alongside the existing SIK V2 cursor. It mirrors
the rendered cursor's position, visibility and alpha without independent hover logic,
smoothing or growth/retraction. The beam starts 10 cm ahead of the tracked thumb/index fingertip midpoint (clamped for close
cursors), has a 0.08–0.055 cm white radius and uses 45% of the cursor's rendered opacity.
The existing fixed-tube `BendyLaser` shader is reused with collinear control points.
Native ray-only targets retain SIK's own ray; direct/poke input, tracking loss and pause
hide the addon. `BendyLaserProbe.ts` checks the real cursor, controls and shader.

`SpecsNavigationTargetPriority` scopes a workaround to the installed SIK 0.17.2 target
chooser: when the robot box wins, try SIK's own chooser without that box and accept the
result only if it belongs to the navigation marker (including Cancel). Other targets
keep their normal behavior. This lets an unselected marker inside the robot bounds
receive the actual SIK cursor, hover and drag without disabling the box for other rays
or editing the package. Teardown restores the chooser. `NavMarkerOverlapProbe.ts`
checks native physics hits, unselected drag commands, robot picking and UI occlusion.
Physical tracking and stereo still need a device check.
Specs floor placement uses a stable horizontal reference seeded from the robot floor.
A bounded, three-second survey accepts five near-horizontal samples over at least
300 ms and uses their median after rejecting height outliers and the scanned robot
body. Missing scans retain the reference. Probes and floor circles render 1.5 cm
above their support plane; this clearance never enters navigation coordinates.
Direct marker drags use a horizontal gesture plane. Mesh differences up to 10 cm
are ignored; larger steps change only its target height. Height and position ease
with 100 ms time constants; the raw mesh hit is never returned. Specs heading uses
the existing 3 cm jitter gate and an 80 ms filter without changing WebXR defaults.
Release submits the displayed filtered pose. The native filled-disc hit cylinder
is centered on the visible circle, with a 2 cm edge margin and 4 cm height.
Release, cancellation and localization changes retire the gesture plane. Its result
must be finite and within the 20 m direct-placement ray segment.
Selected floor placement retains its separate floor-validity checks.

## WebXR architecture

WebXR uses the same compact page/state layout rhythm, with its launcher connection
flow replacing the Specs PIN/IP entry. Both setup and runtime height changes ease
for 280 ms around a fixed top edge; headers and tabs stay fixed while the footer,
grab bar, resize corners, and their hit zones follow the animated bottom edge.
Incoming bodies wait until they fit, and automatic resizing pauses during a grab.
Every WebXR runtime page reserves a 4 cm design-space gap above Emergency Stop,
including throughout height transitions.
Message and diagnostics viewports remain bounded and scrollable. WebXR's
`PanelLayout` and `PanelHeightController` own this presentation geometry without
changing its calibrated setup/runtime widths or user-selected window scale.


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
registry or multi-connection model. Both hosts adapt input and native rendering to these owners.

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
`LocalizationCaptureEpisode` awaits one in-flight capture. Specs opts into stopping
the application stream while runtime batches await results or retry eligibility.
Repeated runtime misses back off to 2, 5, 10, then 30 seconds between submissions;
success or an explicit retry resets that budget. The geometry gate is checked
before capture and again before JPEG encoding. Native encodes are serialized even
across cancellation, and stale outputs are discarded before sending. Initial setup
retains its deliberate preview behavior; hiding/leaving the scan releases the
preview texture. Shared defaults preserve WebXR behavior.
Thirty-second diagnostic summaries report stream/listener counts, encode time and
bytes, FPS and worst frame time. These are application metrics, not a claim that
system tracking cameras are physically powered off.
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

In offline replay, marker registration can continue after playback ends. A capture
newer than the retained odometry history uses the last replay robot pose when no
timestamp-matched pose exists; the physical marker represents the robot at that
pose. New replay clients receive that retained pose with its original timestamp
and corrected AR coordinates. Empty history, historical gaps, live-robot pose
freshness, VPS timing, and marker quality checks retain their normal rules.

## Host-layer naming (`clients/specs/Assets/Scripts/DimOSSpecsClient/` and `clients/webxr/src/`)

Same suffix = same role.

| Suffix | Role |
|--------|------|
| **`*Presenter`** | Typed session facts → scene visuals. No portable pose cache. |
| **`*Placement`** / feature **`*Controller`** | World-mesh input and command effects (`DragPlacementPlane`, `NavigationController`, `WebXRGroundPlacement`, `WebXRNavigationController`). No host navigation execution store. |
| **`*View`** | HUD or prefab visual binding; no domain logic (`MainMenuView`, `WebXRNavGoalView`) |
| **`*Renderer`** | World drawing (lines, point clouds) (`PointCloudRenderer`, `WorldMeshRenderer`, `WebXRLidarRenderer`, `WebXRRouteRenderer`) |
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
Floor circles and dashed connectors belong only to robot/navigation feedback.


The dimOS AR design tokens and `SurfaceButton`, `SurfaceText`, and
`ScrollableTextView` primitives live under WebXR `presentation/`. Pill buttons,
rounded fields, panel corners, colors, and motion are shared across setup and the
runtime menu; the landing page consumes the same semantic colour tokens as CSS variables. Primary and selected controls use white fills with dark text; secondary and disabled controls retain neutral fills. Desktop landing and launcher pages use compact dark macOS-style chrome, while immersive controls retain their spatial forms. Both
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

WebXR internal UI fills and button faces use explicit render order without depth-buffer
writes. Opaque control bodies, the outer panel and robot pill retain depth occlusion. Button text uses a
physical half-millimeter offset rather than the SDK's local-unit gap. All control
surfaces, including fields and inactive tabs, have rounded side/back geometry with
no duplicate front cap. Bodies use a darker shade of the animated face color at full
opacity, including the navigation marker’s Cancel button. Panel controls use 75% of
(the inactive resting offset + 0.1 mm) as physical thickness, fixed during
hover/selection and panel resizing. Each panel button casts a soft shadow on its
supporting surface only while raised; there is no resting socket or footprint. The
resting back sits 0.2 mm above the surface, with the shadow plane at 0.1 mm. As the
button lifts, its shadow spreads down and slightly right with a soft edge, while
staying on that same supporting plane.
The head-following setup panel targets 10 cm below the viewer’s forward line and
eases position and orientation with a 200 ms time constant. Robot outlines
unfold from the body box's floor: horizontal expansion precedes height, and hiding
runs the same progress backward over 240 ms, retaining opacity until the final horizontal collapse, without altering the selection collider.

The landing page binds the same `ARModuleSession` used in AR and ticks only its
connection lifecycle before immersive entry. Camera capture, localization, and
navigation retain their tracking/setup gates. The robot and available capabilities
are the primary landing content; server/robot addresses and build/package versions
from optional `hello.server_info` are a compact footnote.

LiDAR Full mode uses a fixed floor-relative height spectrum; obstacle mode remains the default
after setup. WebXR requests a conservative centre-based stream range and renders a 60 cm halo
from the yaw-oriented body bounds, with red dots fading to transparent. Specs retains its
existing colour policy. Portable color policy lives in ClientCore `sensors/lidarColors.ts`.
WebXR draws capped round point sprites in one draw call with reusable buffers and skips
unchanged clouds. Setup success counts visible XR ticks, so system overlays cannot consume its
checkmark animation.

Routes use round world-space dots at 60% preview / 85% confirmed opacity; executing routes use
an 8 mm shared-vertex ribbon at 85%, avoiding alpha accumulation at segment joins. The renderer
anchors the visible remainder at the robot and clips both ends to the actual rendered circle
bounds, including the scaled aiming circle. ClientCore retains the last successful preview
during updates and the executing route during transient empty frames. This changes only
presentation; planner paths and confirmed goal poses remain authoritative.

Immersive panels start at 60% of their previous size while preserving resize limits. Selected
floor aiming starts with a small circle and half-height dashed stem while the authoritative
marker and executing route stay visible. One complete press/release opens the full preview,
which follows floor aim and movement heading. A second gesture captures and submits the
displayed pose once; aim loss cancels only the candidate. Floor aiming and its laser are limited
to five ray meters; direct marker dragging retains the normal interaction range and live goal
updates.

WebXR near pinch/trigger targets share the SDK hit list and activation lifecycle with
rays; near targeting takes precedence and the gesture mode stays captured until release.
Direct input is sampled from thumb/index joints or controller grip space. Palm menus
use handedness-correct metacarpals and open fingers, and only their summoning source
can follow/dismiss them. Grabbing or source loss pins the panel.

Setup and localization-review panels open centered 0.9 m ahead, then follow head position and
yaw/pitch smoothly with no roll. A manual grab pins the panel until its next opening. Runtime UI starts 20% smaller
than setup and follows 18 cm forward and 12 cm above a controller, or 20 cm above a summoning
hand. Whole-panel appearance scales from 85% to full size independently of placement and
resizing. Primary controls and headings sit 8 mm forward, secondary controls 4 mm; hover adds 3
mm and pressing depresses them. Button labels retain a physical 0.5 mm gap across user resizing.
Browser reviews frame actual panel bounds closely without changing production sizes.

Browser diagnostics are warnings/errors by default. `?diagnostics=1` enables throttled
development traces; scene inspection (`?debug=1`) does not enable logging. All sinks
share bounded deduplication and retain the first warning/error immediately.

Navigation completion requires the authoritative goal-reached event. ClientCore retires local
goal intent and retained routes on terminal facts, then keeps the marker at the destination for
a 750 ms visible-frame animation: 250 ms circle trace, 150 ms checkmark/X buildup, and a 350 ms
hold of the fully completed circle and glyph. Success is green, cancellation red, and failure amber. A newer non-preview goal interrupts
feedback, including a new goal at the same destination. Only after feedback does the marker
reattach to the robot. Cancel appears by rising from the circle center and scaling from zero
to its authored size over 280 ms; the dotted connector grows with it. Small pre-commit probes
use the shared dash pattern and sit exactly at the placement/laser endpoint without a height
offset. ARModule rejects planner frames timestamped before the current request or
a completed/stopped episode; transient empty paths still do not imply success.

WebXR Sensors is a runtime submenu with Off / Obstacles / Full LiDAR tabs. Point limits
(250–4000) are local rendering preferences; per-mode ranges use the existing server settings.
Obstacle range is clearance beyond the body bounds, while Full range is measured from the
robot center. Preferences persist locally. Dashed world strokes use a per-eye two-pixel width
floor and smoothly blend to solid as their period shrinks from ten to six pixels. Navigation
circles share the same animated opacity across the robot, probe, and goal variants.

Headset resume and extended tracking loss show a dismissable alignment review in the setup
manager. Reference-space transforms compensate known resets; unknown resets retire the old
transport/capture episode while retaining the last alignment pending user review. Dismissal
does not verify alignment. Dismiss closes the UI in both clients; Realign enters the existing setup flow.

Emergency stop sends immediately and shows reusable viewer-relative feedback for 2.5 visible
seconds, with a 350 ms pressed-button latch. The notification is a compact pill with an animated circle/slash icon and the single line
“Emergency stop requested”; the wire protocol has no stop acknowledgement. Notifications
follow the lower third of the view smoothly, tilt upward by 12 degrees toward the wearer,
and never capture interaction rays. Lasers begin three centimeters ahead of
the input pose and fade in over five centimeters; reveal/hide take 180/240 ms. Main panels
have four millimeters of backing thickness. Real camera-background blur remains deferred
pending physical Quest support and performance verification.


## ClientCore ownership audit

The portable core is the dependency root: it imports relative core modules only and contains
no browser, Three.js, XR Blocks, Lens, or UIKit APIs. Both hosts use the following owners:

| Responsibility | Portable owner | Host responsibility |
|---|---|---|
| Navigation execution, routes, feedback and freshness | `NavigationGoalLifecycle` | Transform coordinates and render snapshots |
| Independent source probes and one confirmed draft | `NavigationPlacementSession`, coordinated by `NavigationInteraction` | Resolve surfaces and map opaque input-source IDs |
| Advisory preview request serialization | `NavigationPreviewCoordinator` | Draw a separate preview route |
| Joystick filtering, command rate and release zero | `JoystickNavigationController` | Gamepad button/axis mapping |
| Capture entry/skip/back and alignment review | `SetupFlow`, `LocalizationCaptureEpisode` | Connection UX, camera adapter, panel layout/following |
| Sensor modes, per-mode ranges and local point budget | `LidarDisplayController` | Persist preferences and draw points; Specs retains its existing range preset |
| Robot visibility, title and activity derivation | `robot/RobotMarkerState` | Meshes, native labels and viewer-facing animation |
| Agent optical-pose publication | `ClientPosePublisher` | Supply timestamped optical tracking |
| Notification priority and visible lifetime | `NotificationCenter` | Text, glyph animation, pill geometry and viewer placement |

WebXR's composition root accepts structural camera and bindable-transport ports. Specs no
longer keeps a second navigation execution state machine. Its native world-mesh drag and
centimeter/quaternion conversions remain host adapters. MainMenuView's page selection,
layout, depth, resizing and grab geometry are presentation state. Browser frame timestamps,
camera calibration, plane polygons, GPU shaders, DOM landing views and native connection
methods remain host-specific. Pure route tessellation remains with its renderer because it
implements that host's floor coordinates and visual stroke/circle clipping.

Selected placement keeps the active goal/route visible while editing a full-size dashed draft. Both
sources have independent pre-confirm probes. The first source to confirm owns the draft;
the other source cannot replace it. Selected floor dragging also previews before confirmation.
Direct marker dragging retains live commands in both selection modes, including after a goal is committed. Robot collider picking is ignored only
for the draft owner; detected walls, invalid floors, UI occlusion and range gates remain.

Robot bounds, dashed routes, connectors and preview circles share
`WORLD_DASH_STYLE`: 12 mm dashes, 10 mm gaps and a 2.75 mm base stroke. Confirmed
previews retain the normal marker radius and selected scale. Their arrow retains its length
while using 80% of the normal width and opacity;
pre-confirm floor probes remain small and use the same dotted outline at the laser endpoint.
Drag-direction heading changes use shared time-based smoothing, with a 3 cm jitter gate.

### Localization delay investigation

A default AprilTag batch has three frames at 0.5-second spacing: its deliberate collection
interval is one second, followed by camera/encoding, transport, detection and fusion time.
The inspected saved configuration uses the fiducial provider only; VPS's 30-second cooldown
cannot explain that configuration's latency. The client result timeout is 15 seconds with a
2-second retry backoff, so repeated missing results can produce a much longer perceived wait.
A browser camera frame is paired with its exposure/presentation timestamp and matching pose;
these correctness checks and the server's two-inlier/quality gates remain intact.

Use `?diagnostics=1` for `localization-stage`, `localization-camera-wait` and
`localization-camera-encoded` events. The Diagnostics page also reports episode, batch and
result-wait seconds and batch count. Specs emits matching batch/result/failure stages. Server
`localization processing timing` records client ID, newest capture timestamp, total episode
processing milliseconds (including CPU/HTTP admission), success and deferral. Fiducial misses distinguish absent/unknown
markers, PnP failure, reprojection error, gravity-tilt rejection and fusion/inlier rejection.
No image or credential data is added to diagnostics.

For a physical comparison, use the same configured printed tag, distance and viewing angle
on each headset. Compare first request → batch sent → server queue/detection → result applied
and count rejected/retried batches. Record calibration/profile and camera timestamp failures.
The automated batch test measures one second of frame spacing and immediate result
application; it does not establish a physical Quest localization latency. The reported
30-second session was not available in the saved logs, so its specific bottleneck still
requires one captured physical trace rather than an inferred timeout adjustment.


ARModule localization policy, cooldowns, anchor commits and result delivery run on its
module event loop, including connect callbacks. `LocalizationRunner` bounds one job per
client and retires generations on replacement/disconnect. `LocalizationWorker` holds
CPU admission until the native operation really finishes after cancellation; marker
jobs receive frozen pose history. VPS uses a loop-owned async HTTP session and one
serialized robot/headset workflow. No localization handler awaits an episode from the
WebSocket read loop. ClientCore checks capture-derived result timestamps before origin
updates; hosts do not duplicate that acceptance state. See `dimos-ar/PROTOCOL.md` for
provisional timing limits and the recorded-data rejection of the proposed voxel-map
packet translation. The fixed 1.25 XY heuristic now covers poses, paths and LiDAR
at the AR boundary; native sensor filtering/planning stays unchanged, and Core
undoes the advertised factor only when calculating native sensor distances.


## Native Specs visual review

Use [the CLAD review command](clients/specs/tools/README.md) on a Mac with the
Spectacles ’24-compatible Lens Studio 5.15 CLAD backport. The review creates a
disposable project, attaches its harness through MCP, compiles TypeScript and
records actual Preview screenshots and continuous normal-speed video. It runs
the production session/state owners, SUK controls, world geometry and shaders;
fixtures replace hardware ports. Source `.scene` files are never edited by hand.

The default local workflow needs no self-hosted CI runner. Hosted CI continues
portable Specs tests and the WebXR browser suite; WebXR screenshots, raw video
and assembled review clips are uploaded as `webxr-visual-review`. Both hosts use
[`tools/visual-review.mjs`](tools/visual-review.mjs) for video assembly. Native
Specs artifacts are collected locally and can be attached to a PR after review.
The Python review tooling tests run in hosted CI without Lens Studio.

World presentation metrics and route geometry live in ClientCore/presentation.
Host adapters convert metres and coordinate bases before drawing. Specs uses
native shader graphs generated from readable `.customCode` sources for the pose
indicator, adaptive box/route strokes and round LiDAR sprites.
The native custom shaders consume display RGB directly; shared palette colors
must not be linearized before upload. Three.js handles its own color conversion.
Its local default is 1500 LiDAR points; the Sensors page permits 250–4000. Server range and local
point limit retain their separate meanings.

Hardware sign-off covers real hand targeting/pinch/grab behavior, camera capture
and calibration, native ASR/TTS, WebSocket reconnects, tracking resets/resume,
robot navigation and stop handling, stereo appearance and headset performance.
Desktop fixtures cannot establish those results.

## Cross-client integration verification

The shared [integration catalog and media contract](tools/integration-tests/README.md)
defines comparable client paths, deterministic fixtures and explicit platform
exceptions. WebXR's main review uses hands; controller-specific behavior has a
separate short video. Specs uses native SIK interaction events and Lens Studio
5.15 CLAD without converting the production project. Hardware boundaries are
simulated; production state owners and renderers remain in use.

Keep reusable harnesses in `clients/specs/Tests/integration-tests/` and
`clients/webxr/tests/integration-tests/`. Generated results go under each
harness's ignored `test-results/<run-id>/` folder. Every applicable case needs
a real assertion and a numbered image. The golden-path video runs at normal
speed and includes complete animations; failures belong in regression images.
Older results may be removed only after a fresh complete run passes.

When a headset is using the production WebXR page during local CI, set
`CI_WEBXR_BUILD_DIR=/tmp/webxr-ci-build ./launcher/scripts/run-ci.sh` to keep
the currently served build intact. Tests still use their isolated HTTPS server.


## Runtime ownership and teardown

ARModule delegates accepted native/corrected poses, source clock/reference epochs,
history and travel to `robot/odometry.py`. Localization policy reads that travel
through a callback. Telemetry reads the accepted native position; it keeps no
second robot-pose cache. `NavigationPreviewService` owns preview tasks and costmap
freshness. `ARAgentService` owns marker handles, assistant message adaptation and
client-pose freshness; DimOS skill entry points remain on ARModule.
WebSocket startup propagates binding failures and each connection has its own
identity even when multiple peers share an IP. `ARModuleConfig.ip_relay_url`
defaults to the existing relay service; set it to `None` to disable PIN publication.
Localization provider snapshots are explicit `SnapshotLocalizer` ports.

ClientCore owns capture suspension and resumption. Losing visibility retires partial
camera batches but preserves a submitted batch's result acceptance and original
deadline. Capture adapters reject pending work when stopped; stale callbacks cannot
release the current generation's inflight gate. Invalid exposure timestamps fail
capture rather than becoming receipt times. Agent message revisions are local
session facts, not new wire sequence numbers. LiDAR mode derives from confirmed
server settings; point budgets and saved range preferences stay local.

`SetupFlow` exposes read-only facts and command transitions using the canonical
`SetupStep`. Both hosts consume Core activity derivation and `RobotSelection`
eligibility. Coupled controls are applied from one snapshot per view.
`SpecsConnectionController` owns PIN resolution, retry/poll events and invalidation;
UI disposal retires those operations before the session stops. Native views remove
their subscriptions and destroy their generated UI, retaining authored scene hosts.
`WebXRSessionController` owns immersive events, stable reference spaces and tracking
recovery; `WebXRInputController` owns input capture/dispatch and menu placement.
Cached world geometry is immutable. Resource owners dispose generated meshes and
materials, restore borrowed SDK hand state and leave authored/native assets intact.

## WebXR manipulation

Manipulation is organized under `manipulation/` in Python, ClientCore, and WebXR.
ARModule delegates to an optional integration Spec; ClientCore owns intent and
correlation; WebXR owns input, assets, visuals, and resource disposal. Measured arm
facts remain in `ARModuleSession`, independently of base pose. The optional
OpenYAM composition uses official DimOS planning/control and does not require the
custom grasp package. See `dimos-ar/dimos/ar/manipulation/README.md` for runtime,
frames, launcher profiles, interaction semantics, and validation.

Environment-depth occlusion is shared WebXR presentation infrastructure and only
applies to explicitly marked bounds/path visuals. Navigation markers and end
effector handles retain their existing on-top behavior. Robot-type defaults remain
separate from saved robot-instance calibration profiles. No Spectacles host
manipulation code or scene wiring is included.

Manipulation runtime updates advance independently of snapshot polling. The optional
DimOS adapter owns upstream compatibility details; runtime owners use its typed
backend port. ClientCore supplies one immutable interaction snapshot to WebXR.
WebXR controls and model resources have separate owners under `manipulation/`,
with robot visual corrections under `manipulation/profiles/`. Asset URLs identify
resources; explicit model metadata selects articulation and visual profiles.
Shutdown teardown may skip its stop call only after a `quiescent: true` receipt.
