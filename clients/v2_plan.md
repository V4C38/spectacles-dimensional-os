# AR clients — learning-first rebuild

This is a learning project. The measure of success is that you understand every
line and why it exists, not that a demo ships quickly. The architecture below is
settled. Groups 1–4 (`ClientCore`) are complete. Groups 5–10 are the Spectacles
host; their file lists are filled in below.

The app does **not** need to run between groups. Groups 1–4 are a library plus
tests. A headset sees room content after Group 9 and wearable UX after Group 10.

## What this system is

Three machines share a Wi‑Fi network:

1. A **Unitree Go2** (or later another DimOS robot). It walks and publishes
   odometry, a planned path, and a LiDAR cloud.
2. A **Mac** running [Dimensional OS](https://github.com/dimensionalOS/dimos)
   (DimOS) and **`ARModule`**. DimOS is the robot stack. `ARModule` is a DimOS
   module in this repo (`dimos-ar/dimos/ar/`), run as blueprint `unitree_go2_ar`
   (`dimos run unitree-go2-ar`). It talks to AR clients over a WebSocket on
   port **8787**. The accept loop is a collaborator
   (`dimos/ar/websocket/server.py`), not the module.
3. **Snap Spectacles** running this Lens. The glasses track themselves in the
   room and draw the robot, `nav_goal.path_poses`, and `lidar` in that room.

`ARModule` owns localization (fiducial marker and/or VPS), odometry scale
correction, LiDAR filtering, and navigation publish/subscribe. The headset does
not run a solver and does not know which provider is configured.

The cross-platform contract is [`dimos-ar/PROTOCOL.md`](../dimos-ar/PROTOCOL.md).
Keep that file, `dimos-ar/dimos/ar/websocket/protocol.py`, and the client
protocol module in sync.

A later **WebXR** client (Quest, browser) should reuse the same core. It will
not be identical — different camera, scene graph, and UI — but it must speak
the same protocol and own the same `T_odom_client`.

## Why the Lens is being rewritten

The current Lens (`clients/specs/Assets/Scripts/ARBridge/` and `App/`) speaks
**protocol v19**: a registration session, a continuous world-frame solver on
the old server, ping/pong clock sync, `robot_id` on every message, and an
agent/LLM channel. `ARModule` is **v2**. The two are not compatible.
`PROTOCOL.md` says the Lens protocol module has to be rewritten.

v19 also made the headset own too much: fiducial-marker progress, scale lock,
commit, ACK-gated camera streaming, incremental `world_frame_correction`, and
three overlapping status messages. `ARModule` is designed so the client has
**less state**. Localization is a capture episode. The only pose the client stores
from localization is the newest `localization_result`.

Call that module **`ARModule`**, not a bridge and not the WebSocket server.
The leftover folder name `ARBridge/` stays on disk as inactive reference until
the group that takes each file deletes the original. Rename happens in that
group, not as a pass. Groups 5–10 **build a new Spectacles host** that imports
`ClientCore` and **takes** only Lens/hardware pieces that still have a job.
They do not morph the v19 tree in place.

## What the client owns

| Concern | Owner |
|---------|--------|
| When to capture, and the robot's pose in `odom` after a successful episode | `ARModule` |
| Camera JPEGs, exposure time (`ts_capture` in `ts_client`), camera optical frame in the caller's tracking frame | Client |
| Axis conversion (DimOS `odom` ↔ this headset's convention) | Host (Specs / WebXR), not `ClientCore` |
| Newest `localization_result` as `T_odom_client` — the client's tracking origin in `odom` | Client |
| Drawing the robot, `nav_goal.path_poses`, and `lidar` in the headset's scene | Client (headset-specific) |
| Connect wizard, HUD, wrist menu | Client (this app only) |

On the wire everything `ARModule` sends is in **`odom`**: right-handed, Z-up,
metres (ROS / DimOS). Spectacles is left-handed Y-up (X right, Y up, Z
forward). The client converts on receipt and inverts the conversion on
anything it sends. Camera poses inside `localization_observations` are in the
caller's tracking frame, but that frame must itself be right-handed,
gravity-aligned Z-up, and metric — so Spectacles converts those on the way
out too.

`localization_result` is the client's tracking origin in `odom`. Apply the newest one.
Do not expect unsolicited updates. A later episode replaces it. `T_odom_client` is
scoped to the connection: on disconnect the client drops it,
because a restarted `ARModule` resets the `odom` origin and nothing on the
wire would reveal it.

`ARModule` opens an episode on every connection and again after a navigation
goal is reached once the robot has travelled past a threshold
(`dimos/ar/localization/policy.py`, `on_hello` / `on_goal_reached`). Capture
starts when `ARModule` sends `localization_observations_request`. A failed
episode produces no frame at all, so the client sends
`localization_start_request` to ask for another one until it has `T_odom_client`.

Telemetry (`pose`, `nav_goal`, `lidar`, `state`) is broadcast byte-identically
to every connected client, control is last-command-wins with no arbitration,
and localization is addressed per connection. A second client can change LiDAR
filtering or drive the robot; this client presents what it receives rather than
assuming it is alone.

## How we work

Same rules as the `ARModule` rebuild (`.cursorrules`):

- Work proceeds in the ten groups below. Within a group, finish one file at a
  time unless asked otherwise.
- For each file: explain what it does, why it exists, which protocol or Lens
  API it touches, then pause. After writing, walk through the finished code
  and name the TypeScript features used. When a Python idea appears, give the
  TypeScript spelling in one clause, and vice versa.
- Comments match current Lens / DimOS density — no module essays, no section
  banners. Explanations live in chat.
- Prefer what `ARModule` already defines over new client policy. If a value
  is on the wire, do not hardcode a second copy.
- When a real design fork appears, stop and ask.

The Lens does not need to compile between Groups 5–10. A group need not leave
the full Lens runnable, but every nontrivial portable or pure host helper
lands with its smallest regression check.

## Names and layers

Wire fields, types, and frames use the `dimos-ar` names. Do not invent a
second word for the same thing.

TypeScript files and classes use PascalCase, properties use camelCase, scene
objects use PascalCase, and wire fields retain protocol spelling such as
`nav_goal`, `path_poses`, `lidar`, and `T_odom_client`.

| Name | What it is | Not |
|------|------------|-----|
| **`ARModule`** | DimOS module (`unitree_go2_ar`). | bridge, WebSocket server, robot process |
| **`websocket/server.py`** | Accept loop collaborator. | `ARModule` itself |
| **`ClientCore`** | Headset-agnostic TypeScript: wire protocol, session, client tracking origin, localization capture, control. No Lens APIs. | |
| **`SpectaclesHost`** | Lens composition root. Constructs dependencies, drives time, routes typed facts, tears down. | bridge, `ARModule`, `ARModuleHost`, `ARBridgeCoordinator` |
| **Spectacles logic** | Adapters and 3D runtime: transport, device camera, apply poses to scene objects, ground placement as input. | |
| **Spectacles UX** | Wizard, HUD, wrist / palm, copy, buttons. | |
| **`localization_result` / `T_odom_client`** | Client's tracking origin in `odom`. | headset origin, world frame |
| **fiducial marker** | Printed tag on the robot (`fiducial_marker` provider). | AprilTag (except as the Go2 family), robot marker |
| **robot** | Scene body from `hello.robot` (`body_bounds_m`, `base_height_m`). | robot marker |
| **ground marker** | Nav UI under `pose`, placed with `base_height_m`. | |
| **`nav_goal` / `path_poses`** | Planned route. | path, by itself |
| **`lidar`** | Point cloud. | |
| **camera optical frame** | Wire camera pose (`camera_optical`: X right, Y down, Z view). | optical-camera |
| **caller's tracking frame** | Frame that camera pose is expressed in. Right-handed, gravity-aligned Z-up, metric. | host tracking convention |
| **`ts_client` / `time_sync`** | Client clock family and handshake pair. | client clock, clock offset by itself |
| **`capture_policy` / line-of-sight** | Geometric capture gate (`robot_los_*`). Distance and look-at are the measurements. | LOS, as a second name |
| **`localization_start_request`** | Client asks for a capture episode. | alignment request |
| **`state.nav.state`** | `idle` \| `following_path` \| `resolved`. | `state.nav` as the phase |
| **outbound / inbound** | Server → client / client → server, as in `PROTOCOL.md`. | flipping those from the headset |

The boundary between Spectacles logic and UX is concrete:

- **Spectacles logic is what exists or happens in the tracked room:**
  `localization_observations`, the robot, `nav_goal.path_poses`, `lidar`,
  ground hit, and scene-object transforms.
- **Spectacles UX is what the wearer reads or presses:** wizard steps, status
  copy, buttons, presets, debug text, and wrist / palm presentation.

Presenters that bind portable poses to `SceneObject`s are Spectacles logic,
even when the result is visible. UX may call them, but does not own their
scene state.

`ClientCore` lives at

```text
clients/core/
```

That directory is the only editable source for portable code. Hosts do not
hand-copy it. The Lens cannot import TypeScript from outside its project, so
`clients/specs/Assets/Scripts/core/` is a committed generated mirror of the
four production packages (`websocket`, `localization`, `navigation`,
`sensors`). Never edit the mirror. Lens `.meta` files stay in the Specs
project. [`clients/specs/scripts/sync-client-core.mjs`](specs/scripts/sync-client-core.mjs)
regenerates it; `--check` fails CI on drift. No symlinks.

The Specs host is `clients/specs/` (the Lens Studio project; v19 remains on
disk until Groups 5–10 complete). `clients/webxr/` is empty.

Its folders use the same names as `dimos/ar/`, so each client package maps
to one `ARModule` package. Axis conversion is not a portable package:
`ARModule` does none, and each host (Specs, WebXR) converts before it
calls `ClientCore`.

```text
core/                           dimos/ar/
├── websocket/                  websocket/      # types, framing, codec
├── localization/               localization/   # T_odom_client, capture episode
├── navigation/                 navigation/     # nav_goal_request, nav_goal
└── sensors/                    sensors/        # lidar_settings_request, lidar
```

A later DimOS agent relay adds `core/agent/` (see **Later: DimOS agent relay**).
Do not create that folder until that work starts.

Create a folder only when its group lands; do not add empty placeholders.
Connection facts (`hello`, `state`, `pose`) live in `websocket/` with the
codec. There is no portable `robot/` package: `hello.robot` and `estop_request`
stay on the wire types and session/control code. The Spectacles host adds
`robot/` in Group 9 for scene presentation only.

Portable tests live with `ClientCore`, not under `clients/specs/Assets/`
(Lens Studio would compile Vitest into the production Lens):

```text
clients/core/tests/
├── protocol.test.ts
├── session.test.ts
├── localization.test.ts
├── navigation.test.ts
└── sensors.test.ts
```

Host helper tests land under `clients/specs/Tests/unit/` as their source
lands. `clients/specs/Tests` still holds v19 tests until Group 10 removes
them. Do not put `*.test.ts` under `clients/specs/Assets/`.

Run portable tests with `cd clients/core && npm test`.

**The rule that makes it portable:** `ClientCore` must not use Lens
globals (`vec3`, `quat`, `print`, `getTime`, `BaseScriptComponent`,
`SceneObject`). Positions and orientations are wire tuples
(`[x, y, z]`, `[qx, qy, qz, qw]`). Specs converts to `vec3` / `quat` at
the adapter boundary.

Import direction is one way: host logic and UX import `ClientCore` (on Specs,
through the generated mirror). `ClientCore` never imports them.

Open the Lens from `clients/specs/spectacles-dimensional-os.esproj`, not the
repo root. Do not edit `.scene` files by hand; use the Lens Studio MCP tools.

## Portable boundaries

`ClientCore` depends on small TypeScript interfaces supplied by the host:

| Port | Portable code needs | Spectacles implementation |
|------|---------------------|----------------------------|
| Transport | Connect/close, send whole text/binary frames, receive them, and report connection events | `InternetModule` WebSocket adapter |
| Clock | Monotonic `now()` in the `ts_client` clock family | Lens `getTime()` adapter |
| Tracking | Current camera optical frame for line-of-sight checks, already in the wire tracking frame (right-handed Z-up) | Device tracking adapter, after Specs axis conversion |
| Capture | Explicit lifecycle: `start`, async `capture` (one JPEG with exposure timestamp, camera optical frame, and intrinsics, already Z-up), `stop` | Device colour-camera adapter, after Specs axis conversion |
| Capture geometry | Required line-of-sight distance, look-at tolerance, and frame cadence | Explicit Specs configuration |

The transport performs platform socket operations and carries whole frames;
newline framing is portable, not a host concern. The portable session owns
handshake and reconnect policy. The capture port matches the working v19
sequence (`DeviceCameraStream.requestNextFrame()` then
`Base64.encodeTextureAsync`): `capture` returns a Promise; `start` / `stop`
own hardware. It returns facts measured at exposure; it does not decide when
an episode starts. Axis conversion is a host job (Group 6 Specs / later
WebXR). Ports and compose speak only the wire tracking frame. A WebXR host
brings its own table.

All required dependencies and wire fields are validated. Missing inputs,
invalid messages, unsupported layouts, and impossible lifecycle transitions
fail explicitly instead of using hidden defaults.

## State and effects

Each mutable concern has one owner:

- The session owns connection facts, `hello`, `time_sync`, and the newest
  `state`, `pose`, `nav_goal`, and `lidar` values.
- `ClientTrackingOriginStore` owns the newest `localization_result` (`T_odom_client`).
- `LocalizationCaptureEpisode` owns its active request and captured observations.
- Spectacles presenters mutate only scene presentation and teardown.

`SpectaclesHost` constructs dependencies, drives time, routes typed facts,
and tears down. It does not mirror portable facts. UX reads derived views and
calls existing command APIs.

Portable code stores received events and inputs, then derives views from them.
It does not store duplicate booleans such as `handshakeReady`,
`worldFrameCommitted`, or `isCapturing`. The public derived view includes:

- connection: `disconnected` | `connecting` | `awaiting_hello` | `ready` |
  connection `failed`
- `hasTrackingOrigin`: whether a `localization_result` has been applied on this connection
- capture episode: `idle` | `waiting_for_geometric_gate` | `capturing` | `sending` |
  `awaiting_result` | episode `failed`
- capabilities from `hello.capabilities`
- navigation from `state.nav` (`state` / `outcome`)

State transitions produce wire-send effects. The session executes those
effects through the transport; Spectacles presenters consume derived state
to present or tear down scene. UX does not mirror portable state in a
second application store.

## Spectacles host layout (after Group 10)

```text
clients/specs/
├── scripts/
│   └── sync-client-core.mjs
├── Tests/
│   └── unit/
│       ├── spectaclesCoordinates.test.ts
│       └── spectaclesCameraSource.test.ts
└── Assets/Scripts/
    ├── core/                                  # generated; never edit here
    │   ├── websocket/
    │   │   ├── arModuleSession.ts
    │   │   ├── hostPorts.ts
    │   │   ├── protocol.ts
    │   │   └── protocolTypes.ts
    │   ├── localization/
    │   │   ├── clientTrackingOrigin.ts
    │   │   ├── clientTrackingTransforms.ts
    │   │   ├── geometricGate.ts
    │   │   └── localizationCaptureEpisode.ts
    │   ├── navigation/
    │   │   └── navGoalRequest.ts
    │   └── sensors/
    │       └── lidarSettingsRequest.ts
    ├── SpectaclesConfig.ts
    ├── SpectaclesHost.ts
    ├── coordinates/
    │   └── SpectaclesCoordinates.ts
    ├── websocket/
    │   ├── SpectaclesClock.ts
    │   └── SpectaclesWebSocketTransport.ts
    ├── localization/
    │   ├── DeviceCameraStream.ts
    │   └── SpectaclesCameraSource.ts
    ├── robot/
    │   └── RobotPresenter.ts
    ├── navigation/
    │   ├── GroundPlacement.ts
    │   ├── LineRenderer.ts
    │   ├── NavGoalMarker.ts
    │   ├── NavGoalPresenter.ts
    │   └── NavigationController.ts
    ├── sensors/
    │   ├── LidarPresenter.ts
    │   └── PointCloudRenderer.ts
    ├── ux/
    │   ├── ConnectWizard.ts
    │   ├── ConnectWizardView.ts
    │   ├── PalmGestureGate.ts
    │   ├── RuntimeHudView.ts
    │   ├── UIKit.ts
    │   ├── UILogger.ts
    │   └── WristMenuController.ts
    └── utilities/
        └── AnimationUtilities.ts              # create only if retained UX uses it
```

Platform scene objects remain `Camera Object`, `Lighting`,
`SpectaclesInteractionKit`, and `World Mesh`. Group 9 creates `Robot`,
`GroundMarker`, `Lidar`, and `NavGoal`; `NavGoal` is a path/spawn parent,
while `NavGoalMarker.prefab` is instantiated at runtime. `Lidar` is never
parented or anchored to `Robot`. `GroundMarker` is a child of `Robot`.

## Ten groups

### 1. Protocol — `core/websocket`

Complete. The contract every headset must get right.

Rewrite the protocol module to v2 (14 message types). Typed encode/decode for
JSON and the two binary layouts (`"LOCA"` observations, `"LDAR"` float32
points). Metres on the wire; no `robot_id`; no protocol version field.

Text framing belongs here, next to the codec: append `\n` when sending JSON,
accumulate and split received text on `\n` before decoding. `ARModule` splits
client-to-server text the same way (`dimos/ar/websocket/server.py`,
`split_inbound_text_lines`), so a WebXR host inherits framing rather than
reimplementing it.

Two wire layouts for the same idea need distinct decoders: `pose`,
`nav_goal_request` and `localization_result` are position `[x, y, z]` plus
scalar-last quaternion, while `nav_goal.pose` and every `nav_goal.path_poses`
entry are `[x, y, z, yaw]` radians. Hosts convert yaw through their own
axis table, not by negating a number at the call site.

No sockets. No scene. Tests against fixtures and `PROTOCOL.md`.

```text
clients/core/websocket/protocolTypes.ts
clients/core/websocket/protocol.ts
clients/core/tests/protocol.test.ts
```

Group 1 is complete only when all nine outbound and eight inbound message
types have portable representations. The binary types count too:
`lidar` belongs to the outbound union and `localization_observations` belongs
to the inbound union as a batch of `LocalizationObservation` records. Encoding
or decoding may operate on the records directly, but the public type inventory
must still match the 17-message contract.

Both binary layouts have strict portable decoders. `decodeLidar` validates
`"LDAR"` and its exact point payload; `decodeLocalizationObservations`
validates `"LOCA"`, every `record_len`, the reserved word, payload boundaries,
intrinsics JSON, and that no unexplained bytes remain. The client primarily
encodes `"LOCA"`, but its decoder provides round-trip and cross-language
contract verification before capture depends on it.

The runtime validators enforce the same invariants as the types and contract:

- `capabilities.*.reason` is required and is `null` exactly when available.
- `state.nav.outcome` is required and is non-null exactly when resolved.
- `distortion` is empty when `distortion_model` is `none`.

Tests cover omitted required-null fields as well as wrong non-null values
and non-finite coordinates and quaternions. JSON fixtures cover every outbound message and every valid navigation
phase, unavailable capabilities, confidence bounds, and observation-count
validation. Binary tests cover multiple `"LOCA"` observations and malformed
record lengths and intrinsics. Compatibility uses committed golden bytes
produced by the Python codec (or decodes TypeScript `"LOCA"` bytes with it in
a repeatable test), rather than only rebuilding the Python layout independently
in the TypeScript test.

### 2. Session and tracking origin — `core/websocket`, `core/localization`

Complete. How a client talks to `ARModule` and where it thinks it is.

On connect the client sends `hello_request { ts_client }` as the first text
frame, and it must be the only JSON object in that frame. `hello` returns
`client_id`, `time_sync`, `hello.robot` (`body_bounds_m`, `footprint_m`,
`base_height_m` — Group 9 places a ground marker under `pose` with the last of
these), and `hello.capabilities` (`lidar`, `navigation`, `localization`,
`estop`). `time_sync` is the clock pair (`ts_client`, `ts_server`). There is
no ping/pong burst; WebSocket Ping/Pong is liveness only. `ARModule` sends
`state` immediately after the handshake, so `ready` and the first `state`
arrive together.

Connection lifecycle and cached `hello` / `state` / `pose` live in
`websocket/`, next to the codec. `T_odom_client` lives in `localization/`.

Build the portable session over the transport and clock ports. It recognizes
every outbound (server → client) v2 message and exposes typed subscriptions,
including `localization_observations_request` for group 3. Group-specific
handlers attach without reopening the session.

Store `state`, `pose`, `nav_goal`, and binary `lidar` as session facts. Route
`localization_result` to `ClientTrackingOriginStore`, which alone stores `T_odom_client` and
clears it on disconnect along with the rest of the connection's facts. Define
one named transform composition path for mapping `odom` content into the
caller's tracking frame; callers never compose or invert it independently.

The session owns connection transitions, hello timeout, disconnect cleanup,
and reconnect scheduling. A host transport only carries out connect, close,
send, and receive operations.

No camera. Fixtures are enough. `state.nav.state` is `idle` |
`following_path` | `resolved`, with `state.nav.outcome` (`succeeded` |
`failed`) non-null exactly when `resolved`. There is no
`world_frame_committed` on the wire — `hasTrackingOrigin` means the client has applied
a `localization_result`.

```text
clients/core/websocket/hostPorts.ts
clients/core/websocket/arModuleSession.ts
clients/core/localization/clientTrackingOrigin.ts
clients/core/localization/clientTrackingTransforms.ts
clients/core/tests/session.test.ts
clients/core/tests/localization.test.ts
```

Hello timeout and reconnect delay are required session configuration. The
session does not pick Spectacles numbers.

Group 2 is complete only when the session recognizes every outbound v2
message, `hello.time_sync.ts_client` must echo the `hello_request` that opened
the connection, and `T_odom_client` has a single owner. Wrong-phase transport
events throw; protocol and timeout failures go to `failed` and schedule
reconnect. Compose is one SE(3) inverse of `T_odom_client`, in both
directions, for points, poses, and yaw poses. Tests cover
handshake, hello timeout, echo mismatch, reconnect, tracking-origin replacement,
tracking origin cleared on disconnect, and invalid lifecycle transitions.

### 3. Capture episode — `core/localization`

Complete. The only remaining client-owned localization job. It lands in
`localization/` beside `T_odom_client`.

`localization_observations_request` carries `capture_policy` and an exact
`observation_count` (`wait_timeout_s` when the policy is
`robot_los_preferred`). The client waits for the line-of-sight gate when one
applies, captures that many frames, sends one `"LOCA"` batch, and ends the
episode (or ends it on disconnect). `ts_capture` is exposure time in
`ts_client`. Intrinsics ride per record. Camera pose is the camera optical
frame (X right, Y down, Z along the view direction) in the caller's tracking
frame — right-handed, gravity-aligned Z-up, and metric.

Policies are geometric, not provider names:

- `robot_los_required` — wait for line-of-sight (distance + look-at), then N frames
- `robot_los_preferred` — wait until `wait_timeout_s`, then N anyway
- `any_angle` — N with no line-of-sight gate

**The gate only exists once the client has `T_odom_client`.** Distance and look-at are
measured against `pose` composed with `T_odom_client` — and that composition
has no value before the first `localization_result`. While it has no tracking origin the
client captures immediately under every policy, exactly as v19 did
(`FrameCaptureController` passed a null robot position until commit), and the
wizard tells the wearer to look at the robot. Once it has `T_odom_client`, later episodes
gate for real.

The tracking port supplies the current camera optical frame for the
line-of-sight gate. The capture port supplies one JPEG, its exposure
timestamp, the camera optical frame at that exposure, and intrinsics. This
group does not import Spectacles `DeviceCamera` or tracking globals. Spacing
between frames is required capture-geometry configuration like the gate
values, not a wire field; the old practical cadence (~1.5 s) is the starting
number.

The protocol names `capture_policy` but does not carry numeric distance,
look-at, or cadence values. Those are required capture-geometry configuration,
validated at construction. Group 3 fixes their names and values before code is
written; the episode never substitutes hidden defaults.

An episode may begin whenever a request arrives after hello, including again
during runtime after the robot has travelled. The connect wizard is only one
consumer of the same episode state. Episode facts derive `waiting_for_geometric_gate`,
`capturing`, `sending`, `awaiting_result`, and `failed`; those states are not
separately mutated flags.

`ARModule` sends nothing when localization fails, so the episode carries its own
result deadline: after the batch goes out the client waits in `awaiting_result`
until a `localization_result` arrives or the deadline passes, then reports
`failed`. While it has no tracking origin it then sends `localization_start_request` to ask for
a fresh episode, and repeats until a result lands. Back off between attempts
rather than retrying immediately — `ARModule` may withhold the prompt for a
provider cooldown (30 s for client VPS, `dimos/ar/localization/policy.py`) and
deliver `localization_observations_request` late. Once it has `T_odom_client`, a failed
later episode does not self-retry; `ARModule` prompts again on the next
qualifying navigation goal, and the wearer can send
`localization_start_request` from the HUD.

No standing capture session, no ACK/`seq`, no motion-triggered recapture, no
separate `camera_info` message.

```text
clients/core/websocket/hostPorts.ts
clients/core/localization/geometricGate.ts
clients/core/localization/localizationCaptureEpisode.ts
clients/core/tests/localization.test.ts
```

Capture geometry and episode timeouts are required construction inputs. The
episode does not pick hidden defaults. Spectacles starting numbers (v19 Lens
cadence plus `PROTOCOL.md`):

| Field | Value | Role |
|-------|-------|------|
| `minDistanceM` | 0.35 | Closest line-of-sight capture |
| `maxDistanceM` | 3.0 | Farthest line-of-sight capture |
| `lookAtMaxAngleDeg` | 45 | Optical +Z vs direction to robot |
| `frameSpacingS` | 1.5 | Cadence between frames in one batch |
| `resultTimeoutS` | 15 | Wait for `localization_result` after the batch |
| `retryBackoffS` | 2 | `localization_start_request` delay while missing `T_odom_client` |

Group 3 is complete only when `LocalizationCaptureEpisode` is a sibling of `ARModuleSession`, the
geometric gate is off while the client has no tracking origin for every policy including fiducial
`robot_los_required`, and a missing `localization_result` is `failed` then a
`localization_start_request` loop until a result lands. Once it has `T_odom_client`
the gate is real (`robot_los_required` waits, `robot_los_preferred` waits until
the gate or `wait_timeout_s`, `any_angle` does not wait) and a failed episode
does not self-retry. Tests cover first-episode skip-gate, the no-origin retry
loop, gating after `T_odom_client`, frame spacing, one `"LOCA"` batch, disconnect, overlapping
requests, and invalid geometry.

### 4. Control — `core/navigation`, `core/sensors`

Complete. Outbound commands, portable. `nav_goal_request` lives in `navigation/`.
`lidar_settings_request` lives in `sensors/`. `estop_request` and
`state_request` stay with the session in `websocket/`.

`nav_goal_request` (position and orientation both required, in `odom` after
axis conversion), `estop_request` (event, no latch — resume is a new
`nav_goal_request`),
`lidar_settings_request` (`enabled` plus height band and range, all
required), `state_request`.

Command validation and capability checks use current session facts. Commands
emit send effects through the session; this group does not keep navigation
execution state, place markers, or draw a path.

Ready is checked before capability, because `view().capabilities` is `null`
until hello. A not-ready send throws `send requires a ready session`. A
missing capability throws `hello.capabilities.<name> is not available`.
The client throws; `ARModule` no-ops the same missing capability
(`dimos/ar/module.py`). File names are the wire messages so they do not
collide with `ARModuleSession`'s cached `nav_goal` / `lidar`. Arguments are already
`odom` (right-handed Z-up); the host converts first. `nav_goal_request`
takes `Vec3` + `Quat`, not yaw. `requestState` has no capability key.

```text
clients/core/websocket/arModuleSession.ts
clients/core/navigation/navGoalRequest.ts
clients/core/sensors/lidarSettingsRequest.ts
clients/core/tests/navigation.test.ts
clients/core/tests/sensors.test.ts
clients/core/tests/session.test.ts
```

Group 4 is complete only when all seven inbound types have a send path
(`hello_request` and the two localization sends already exist). Capability
and ready checks throw; lidar band and pose go through the existing encode
validators; no host axis table and no `compose` import; no mirrored
nav/lidar UX state. Tests cover happy send (exact JSON text), not-ready,
unavailable capability, and one invalid-number case each.
`SpectaclesCoordinates.ts` is absent until Group 6.

### 5. Integration boundary and scaffold

The Specs host starts here. Not coordinates, not a socket, not camera, not
the room.

Portable `CameraCaptureSource.capture()` currently returns a synchronous
object. Working Spectacles capture is asynchronous:
`DeviceCameraStream.requestNextFrame()` then `Base64.encodeTextureAsync`.
Change the port to an explicit lifecycle (`start`, async `capture`, `stop`)
so Group 8 can keep that sequence. Update `LocalizationCaptureEpisode` to
await one in-flight capture, ignore stale completions after replacement or
disconnect, and stop hardware on send, failure, reset, and disposal. Extend
`clients/core/tests/localization.test.ts` with deferred Promise, rejection,
replacement, disconnect, and teardown cases.

Add [`clients/specs/scripts/sync-client-core.mjs`](specs/scripts/sync-client-core.mjs),
generate the four production package mirrors under
`clients/specs/Assets/Scripts/core/`, and add `--check` to
[`launcher/scripts/run-ci.sh`](../launcher/scripts/run-ci.sh) and
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml). Never edit the
mirror by hand.

Create [`clients/specs/Assets/Scripts/SpectaclesHost.ts`](specs/Assets/Scripts/SpectaclesHost.ts)
as a shell `BaseScriptComponent` with no presenter slots, socket, store, or
tick. Use Lens MCP to create the `SpectaclesHost` scene object and attach the
script. Do not edit `.scene` files by hand.

Use Lens MCP to disable the v19 `ARBridgeCoordinator` scene object and the
v19 `FrameCaptureController` component on `Camera Object`. Keep those assets
as reference until the taking group removes them. Only one runtime owns
connection and camera lifecycle.

`.cursorrules` and `CONTRIBUTING.md` already name this structure. This group
does not rewrite them.

```text
clients/core/websocket/hostPorts.ts
clients/core/localization/localizationCaptureEpisode.ts
clients/core/tests/localization.test.ts
clients/specs/scripts/sync-client-core.mjs
clients/specs/Assets/Scripts/core/
clients/specs/Assets/Scripts/SpectaclesHost.ts
launcher/scripts/run-ci.sh
.github/workflows/ci.yml
```

Group 5 is complete only when the capture port is async with start/stop,
episode tests cover in-flight Promise cases, the mirror `--check` is in CI,
`SpectaclesHost` exists as a shell, and v19 connection/camera owners are
disabled. This group creates no coordinate helper, room placeholders, socket,
or camera adapter.

### 6. Coordinates

This headset's axis table. Not the session and not the scene.

Add [`clients/specs/Assets/Scripts/coordinates/SpectaclesCoordinates.ts`](specs/Assets/Scripts/coordinates/SpectaclesCoordinates.ts)
with one `SPECTACLES_BASIS` and named conversions for points, quaternions,
poses, and yaw-poses between the right-handed metric caller tracking frame
and left-handed centimetre Spectacles space.

Inbound `odom` uses `clientTrackingTransforms` then `SpectaclesCoordinates`.
Outbound ground placement uses the inverse Spectacles basis then
`clientTrackingToOdomPose`. Callers never negate a yaw or swap axes at the
call site.

This file is the Spectacles implementation of the generic left-handed Y-up
example in [`dimos-ar/PROTOCOL.md`](../dimos-ar/PROTOCOL.md). Do not write
the helper's name, this host, or any other client into that document. Do not
change the wire contract.

Test both directions and round trips in
[`clients/specs/Tests/unit/spectaclesCoordinates.test.ts`](specs/Tests/unit/spectaclesCoordinates.test.ts),
including nontrivial rotations and yaw.

```text
clients/specs/Assets/Scripts/coordinates/SpectaclesCoordinates.ts
clients/specs/Tests/unit/spectaclesCoordinates.test.ts
```

Group 6 is complete only when both directions and round trips are tested,
including nontrivial rotations and yaw. No session, transport, or scene
objects. A WebXR host brings its own table against the same `ClientCore`.

### 7. Connection runtime

How Spectacles talks to `ARModule`. No camera and no room drawing.

Add explicit Spectacles values in `SpectaclesConfig.ts` for `helloTimeoutS`,
`reconnectDelayS`, and endpoint port **8787**. Capture geometry and episode
timeouts land with Group 8; they are the Group 3 numbers, not a second table.
`SpectaclesHost` owns the required server host input. `ARModuleSession` owns
reconnect policy. The host does not pick a hidden default host or port.

Take confirmed socket mechanics from v19 into `SpectaclesWebSocketTransport`:
whole-frame send/receive, Blob-to-`Uint8Array`, connect watchdog, and safe
retirement of a connecting native socket. Leave behind v19 text framing,
ping/pong clock sync, retry policy, IP persistence, and bridge names.
Newline framing stays in `ClientCore`.

Forward transport open/close/text/binary events into the matching
`ARModuleSession.onTransport*` methods. Construct one clock, transport,
tracking-origin store, and session.

Bind Lens lifecycle: start the session once, call `session.tick()` on
`UpdateEvent`, stop it on teardown, and release every subscription.

```text
clients/specs/Assets/Scripts/SpectaclesConfig.ts
clients/specs/Assets/Scripts/websocket/SpectaclesClock.ts
clients/specs/Assets/Scripts/websocket/SpectaclesWebSocketTransport.ts
clients/specs/Assets/Scripts/SpectaclesHost.ts
```

**Take:** v19 `InternetModule` WebSocket connect, Blob binary receive, connect
watchdog, safe socket retirement. **Leave:** v19 text framing, ping/pong clock
sync, retry policy, IP persistence, `ARBridgeSession`, `InboundProcessor`.

Group 7 is complete only when a ready session can exist without camera or
room drawing. No capture episode and no presenters.

### 8. Localization camera

The only remaining host-owned localization job. Put working v19 camera
mechanics behind the ClientCore ports.

Keep the working v19 sequence: `DeviceCameraStream.requestNextFrame()` → pose
lookup at `timestampSeconds` → camera optical extrinsics/intrinsics →
`Base64.encodeTextureAsync` JPEG.

Put that sequence behind one `SpectaclesCameraSource` that implements both
the tracking and capture ports. It owns pose history and delegates stream
lifecycle to taken `DeviceCameraStream`. No second camera controller or
capture state store.

Construct `LocalizationCaptureEpisode` with the same
`ClientTrackingOriginStore` used by the session. Tick camera pose sampling
before `episode.tick()`, poll `episode.view()` for later UX, and call
`episode.dispose()` during host teardown. Capture geometry and episode
timeouts come from `SpectaclesConfig.ts` (the Group 3 numbers).

An observation contains exposure `ts_capture`, optical pose in the
right-handed metric tracking frame, scaled intrinsics, and JPEG bytes. Axis
conversion happens in this adapter before the values enter `ClientCore`.

```text
clients/specs/Assets/Scripts/localization/DeviceCameraStream.ts
clients/specs/Assets/Scripts/localization/SpectaclesCameraSource.ts
clients/specs/Assets/Scripts/SpectaclesHost.ts
clients/specs/Tests/unit/spectaclesCameraSource.test.ts
```

**Take:** `DeviceCameraStream`, JPEG encode path. **Leave:** ACK/`seq`,
standing `capture_policy`, `camera_info`, `FrameCaptureController`,
registration-gated streaming.

Host tests cover pure helper cases only (pose history, stale completion,
scaled intrinsics). Scene and DeviceCamera behaviour is editor / on device.

Group 8 is complete only when an episode can capture and send `"LOCA"`
through the async port, and hardware stops on send, failure, reset, and
disposal.

### 9. Room presentation and navigation input

What exists in the tracked room. No wizard, HUD, or wrist menu.

Use Lens MCP to create and wire `Robot`, `GroundMarker`, `Lidar`, and
`NavGoal`, and to adapt `NavigationTargetMarker.prefab` into
`NavGoalMarker.prefab`. Do not edit scene files directly. `NavGoal` is a
path/spawn parent; `NavGoalMarker.prefab` is instantiated at runtime.
`GroundMarker` is a child of `Robot`. `Lidar` is never parented or anchored
to `Robot`.

`SpectaclesHost` routes typed session facts to presenters and uses session
view changes for hide/teardown. Presenters never cache portable pose,
capability, navigation, or tracking-origin state. Hide all room content
whenever `hasTrackingOrigin` is false.

`RobotPresenter` derives the body and ground-marker geometry from
`hello.robot.body_bounds_m`, `footprint_m`, and `base_height_m`, then applies
composed `pose`. `pose` carries the odometry scale correction and `lidar`
does not, so the two drift apart with distance from the `odom` origin: draw
each from `odom` independently.

Build a thin `LidarPresenter`; reuse MeshBuilder and material mechanics from
v19 `PointCloudRenderer`. Transform every point from `odom` independently.
No robot anchoring, mock clouds, `AppState` modes, or old protocol constants.

Split v19 navigation mechanics into `GroundPlacement` for world-mesh input,
`NavigationController` for placement lifecycle and command effects, and
`NavGoalPresenter` for received `nav_goal` / `path_poses`. There is no host
navigation execution store.

Route a ground hit through Spectacles → caller tracking → `odom` before
`requestNavGoal`. Route received robot, lidar, goal, and path data through
`odom` → caller tracking → Spectacles.

```text
clients/specs/Assets/Scripts/robot/RobotPresenter.ts
clients/specs/Assets/Scripts/sensors/LidarPresenter.ts
clients/specs/Assets/Scripts/sensors/PointCloudRenderer.ts
clients/specs/Assets/Scripts/navigation/GroundPlacement.ts
clients/specs/Assets/Scripts/navigation/LineRenderer.ts
clients/specs/Assets/Scripts/navigation/NavGoalMarker.ts
clients/specs/Assets/Scripts/navigation/NavGoalPresenter.ts
clients/specs/Assets/Scripts/navigation/NavigationController.ts
clients/specs/Assets/Scripts/SpectaclesHost.ts
```

**Take:** MeshBuilder / material from `PointCloudRenderer`, world-mesh hit
from `GroundPlacement`, line drawing, nav-goal prefab mechanics. **Leave:**
`AppState`, `RobotMarker`, mock clouds, v19 protocol constants, host
navigation execution state, robot-anchored lidar.

Group 9 is complete only when robot, lidar, and `nav_goal` draw from composed
odom independently, and a ground hit can emit `nav_goal_request`. A WebXR
host redoes this group against the same `ClientCore`.

### 10. Derived UX and v19 removal

What the wearer reads or presses, then delete the leftover v19 runtime.

Adapt useful v19 UIKit, wrist/palm, logging, and animation mechanics into
`ux/`. `ConnectWizard` and `RuntimeHudView` derive copy, visibility, and
button availability from `session.view()` and `episode.view()` only. They do
not own duplicate lifecycle enums or booleans.

Call existing core commands directly: `requestNavGoal`,
`requestLidarSettings`, `session.requestEstop`, `session.requestState`, and
`episode.requestStart`. No parallel command or app-state layer.

The old “register the robot” step becomes: wait for
`localization_observations_request`, capture, apply the first
`localization_result`. There is no fiducial-marker progress bar, scale-lock
walk, or commit on the wire.

A failed first episode is visible retry via `localization_start_request`.
The HUD offers that same request once the wearer is past the wizard. Losing
the connection drops `T_odom_client`, so runtime content hides until the next
`localization_result` lands. The same capture presentation can appear again
during runtime when a new episode is requested.

HUD and debug pose copy consume the Group 6 `SpectaclesCoordinates` helper;
do not invent a second basis.

Then delete the inactive v19 `ARBridge/` and `App/` scripts, obsolete scene
components and objects, agent and registration prefabs, and v19-only tests
after all retained assets have v2 owners. Verify there are no production
imports or scene components named `ARBridge`, `AppState`, `Registration`,
`operatingMode`, `RobotMarker`, or v19 `*Client` classes.

STT / TTS and `agent_skill` presentation wait for the later DimOS agent
relay.

```text
clients/specs/Assets/Scripts/ux/ConnectWizard.ts
clients/specs/Assets/Scripts/ux/ConnectWizardView.ts
clients/specs/Assets/Scripts/ux/PalmGestureGate.ts
clients/specs/Assets/Scripts/ux/RuntimeHudView.ts
clients/specs/Assets/Scripts/ux/UIKit.ts
clients/specs/Assets/Scripts/ux/UILogger.ts
clients/specs/Assets/Scripts/ux/WristMenuController.ts
clients/specs/Assets/Scripts/utilities/AnimationUtilities.ts
```

Create `AnimationUtilities.ts` only if retained UX uses it.

**Take:** UIKit, wrist/palm, logging, animation helpers that still have a
job. **Leave:** `AppState`, `operatingMode`, `RegistrationWizard`,
`ARBridgeCoordinator`, v19 agent channel, registration session.

Group 10 is complete only when wizard/HUD are derived-view only, v19 runtime
is gone, host tests and normal Lens compile checks pass, and
`./launcher/scripts/run-ci.sh` is green. Compile-with-logs only if a real
Lens error needs investigation. A WebXR host redoes this group.

## What is not in this client

These existed in the v19 Lens and are not on the v2 wire. Do not reimplement
them:

- Registration session (`registration_command`, `registration_status`,
  `registration_pose`, commit, scale lock, tag profile)
- `world_frame_correction` and client-side drift / approximate tracking-origin math
- v19 agent channel (`user_command`, `agent_response`, `ar_skill`,
  `operatingMode: "agent"`). Not on the v2 wire yet. A later DimOS-native
  relay (below) replaces that channel; do not port the v19 messages.
- `robot_id` on messages, `protocol_version`, ping/pong clock sync
- Separate `runtime_snapshot` / `bridge_status` / `nav_status`
- ACK-gated `camera_frame` streaming and a standing `capture_policy` message
- Joystick / teleop

Existing v19 files are reference for Spectacles camera, connect, placement,
and drawing — not a directory map to copy.

## Later: DimOS agent relay

Not started. Do not implement during Groups 1–10. Server work is
`dimos-ar/plan.md` Group 9. Client work below starts only after that
protocol lands.

User-facing loop is plain text. No audio on the wire.

1. Host STT → inbound `human_input` `{ text }`.
2. `ARModule` publishes DimOS `human_input: Out[str]`. `McpClient` is the agent.
3. Agent skills that already exist in DimOS (navigation, …) stay on those
   streams. Overlay remains `nav_goal` / `state.nav`. No second nav channel.
4. `ARModule` `@skill` methods (first: `draw_geometry`) each broadcast one
   outbound `agent_skill` `{ name, args }`.
5. Assistant text comes back as outbound `agent` `{ text }`. Host TTS.

### Protocol (lockstep with `dimos-ar`)

When this work starts, the 14-type contract becomes 17. Update in the same
change: `dimos-ar/dimos/ar/websocket/protocol.py`, `dimos-ar/PROTOCOL.md`,
`clients/core/websocket/protocol.ts`.

| Frame | Direction | Body |
|-------|-----------|------|
| `human_input` | inbound | `{ text }` non-blank, max 4000 chars. No audio. |
| `agent` | outbound | `{ text }` assistant-only, non-blank. Do **not** apply the 4000-char inbound cap (long replies would fail the session). |
| `agent_skill` | outbound | `{ name, args }` — `args` is an opaque JSON object. |

Also: `hello.capabilities.agent`, and `state.agent.idle` (not a separate
`agent_idle` frame). Conversation is process-global (broadcast). No client
IDs or private routing. Codec for `agent_skill` stays generic; per-skill
schemas are docs for hosts.

### ClientCore

```text
clients/core/agent/humanInput.ts
clients/core/agent/drawGeometry.ts
clients/core/tests/agent.test.ts
```

`humanInput.ts` is a sibling of nav/sensors: `requestHumanInput` through the
session, capability + ready checks. Session facts: latest `agent` text,
`state.agent.idle`, latest `agent_skill` keyed by `name` plus `args.id`.
Clear on disconnect.

Host decoder: ignore unknown `name`; fail closed on a known name with
invalid args.

### Spectacles host (after Group 10)

Do not wire this into the v19 Lens. When the v2 host exists:

- `AsrModule` final transcript → `requestHumanInput`.
- Inbound `agent.text` → TTS + HUD line.
- `state.agent.idle` is the only busy fact.
- `draw_geometry` compose `args.transform` through `T_odom_client`.
- Dispatch `agent_skill` on `name`. No operating-mode enum, no agent
  activity store, no client-side tool execution.
- STT and TTS never leave the host.

v19 `AgentSpeechController` / `AsrModule` is the Spectacles STT reference,
not a protocol to keep.

## Tests and CI

`clients/core` is its own Vitest project (`npm test` there).
Groups 1–4 are fully unit-tested without Lens Studio. Cover malformed
input and invalid lifecycle transitions as well as successful fixtures. Use
fake ports to test handshake, reconnect, tracking-origin replacement,
tracking origin cleared on disconnect, repeated capture episodes, the
result-deadline retry loop, and emitted wire effects.

Groups 5–10 keep Vitest for portable helpers and pure host helpers
(`SpectaclesCoordinates`, camera source). Scene behaviour is checked in the
editor / on device. Group 5 adds generated-mirror `--check` to
`./launcher/scripts/run-ci.sh` and `.github/workflows/ci.yml`.
`clients/specs/Tests` holds remaining v19 tests until Group 10 removes them.

`./launcher/scripts/run-ci.sh` from the repo root remains the pre-commit
gate (DimOS tests + `ClientCore` Vitest + Lens Vitest). Run it outside
the Cursor sandbox.

`dimos-ar/PROTOCOL.md` is the existing contract; implementing it does not
change the server protocol. If work reveals a contract change, update in the
same change:

- `dimos-ar/dimos/ar/websocket/protocol.py`
- `dimos-ar/PROTOCOL.md`
- `clients/core/websocket/protocol.ts`

Keep `PROTOCOL.md` on the `ARModule` package paths. It stays client-agnostic:
the axis-conversion matrix is a generic left-handed Y-up example, not a pointer
at `SpectaclesCoordinates`. Group 6 implements that example on this host. Keep
examples on the actual wire fields (`localization_result.position` and
`.orientation`, not a nonexistent `.pose`) and describe `"LOCA"` offsets from
one origin consistently.

`.cursorrules` and `CONTRIBUTING.md` point protocol-sync at
`clients/core/websocket/protocol.ts`. Delete the
v19 `ARBridge/Network/Protocol.ts` module only when its imports have migrated
(Group 10).

## Outcome

After Group 10 the Spectacles Lens speaks v2, owns `T_odom_client`, captures
only when asked, draws odom content in the room, and presents derived UX.
`ClientCore` is the reference core for a later WebXR client. Production
TypeScript should land smaller than today's ~17k LOC because the session
state the headset used to own is gone.
