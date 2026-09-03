# Spectacles AR client — learning-first rebuild

This is a learning project. The measure of success is that you understand every
line and why it exists, not that a demo ships quickly. The architecture below is
settled; group-level file lists are filled in when that group starts.

The app does **not** need to run between groups. Groups 1–4 are a library plus
tests. A headset sees something only after group 6.

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
the same protocol and own the same alignment state.

## Why the Lens is being rewritten

The current Lens (`lens-studio/Assets/Scripts/ARBridge/` and `App/`) speaks
**protocol v19**: a registration session, a continuous world-frame solver on
the old server, ping/pong clock sync, `robot_id` on every message, and an
agent/LLM channel. `ARModule` is **v2**. The two are not compatible.
`PROTOCOL.md` says the Lens protocol module has to be rewritten.

v19 also made the headset own too much: fiducial-marker progress, scale lock,
commit, ACK-gated camera streaming, incremental `world_frame_correction`, and
three overlapping status messages. `ARModule` is designed so the client has
**less state**. Alignment is a capture episode. The only pose the client stores
from localization is the newest `localization_result`.

Call that module **`ARModule`**, not a bridge and not the WebSocket server.
The leftover folder name `ARBridge/` stays on disk until this rebuild replaces
it.

## What the client owns

| Concern | Owner |
|---------|--------|
| When to capture, and the robot's pose in `odom` after a successful episode | `ARModule` |
| Camera JPEGs, exposure time (`ts_capture` in `ts_client`), camera optical frame in the caller's tracking frame | Client |
| Axis conversion (DimOS `odom` ↔ this headset's convention) | Client |
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
Do not expect unsolicited updates. A later episode replaces it. Alignment is
scoped to the connection: on disconnect the client drops `T_odom_client`,
because a restarted `ARModule` resets the `odom` origin and nothing on the
wire would reveal it.

`ARModule` opens an episode on every connection and again after a navigation
goal is reached once the robot has travelled past a threshold
(`dimos/ar/localization/policy.py`, `on_hello` / `on_goal_reached`). Capture
starts when `ARModule` sends `localization_observations_request`. A failed
episode produces no frame at all, so the client sends
`localization_start_request` to ask for another one until it is aligned.

Telemetry (`pose`, `nav_goal`, `lidar`, `state`) is broadcast byte-identically
to every connected client, control is last-command-wins with no arbitration,
and localization is addressed per connection. A second client can change LiDAR
filtering or drive the robot; this client presents what it receives rather than
assuming it is alone.

## How we work

Same rules as the `ARModule` rebuild (`.cursorrules`):

- Work proceeds in the six groups below. Within a group, finish one file at a
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

Group-level file lists in this document stay rough until that group starts.

## Names and layers

Wire fields, types, and frames use the `dimos-ar` names. Do not invent a
second word for the same thing.

| Name | What it is | Not |
|------|------------|-----|
| **`ARModule`** | DimOS module (`unitree_go2_ar`). | bridge, WebSocket server, robot process |
| **`websocket/server.py`** | Accept loop collaborator. | `ARModule` itself |
| **`ARModuleClient`** | Headset-agnostic TypeScript: protocol, session, alignment, capture episode, control. No Lens APIs. | |
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

The boundary between the final two layers is concrete:

- **Spectacles logic is what exists or happens in the tracked room:**
  `localization_observations`, the robot, `nav_goal.path_poses`, `lidar`,
  ground hit, and scene-object transforms.
- **Spectacles UX is what the wearer reads or presses:** wizard steps, status
  copy, buttons, presets, debug text, and wrist / palm presentation.

Presenters that bind portable poses to `SceneObject`s are Spectacles logic,
even when the result is visible. UX may call them, but does not own their
scene state.

`ARModuleClient` lives at

```text
lens-studio/Assets/Scripts/ARModuleClient/
```

Lens Studio compiles everything under `Assets/Scripts/`. A file without
`@component` is not a scene object — it is a module. Spectacles scripts import
it with a relative path, the same way today's `Protocol.ts` is imported:

```ts
import { decodeHello, odomToClient } from "../ARModuleClient/protocol";
```

Vitest (`lens-studio/Tests`) already imports from `Assets/Scripts/` the same
way. A later WebXR app copies this folder, or extracts it to a package.

**The rule that makes it copyable:** `ARModuleClient` must not use Lens
globals (`vec3`, `quat`, `print`, `getTime`, `BaseScriptComponent`,
`SceneObject`). Positions and orientations are wire tuples
(`[x, y, z]`, `[qx, qy, qz, qw]`). Spectacles converts to `vec3` / `quat` at
the adapter boundary.

Import direction is one way: Spectacles logic and UX import `ARModuleClient`.
`ARModuleClient` never imports them.

Open the Lens from `lens-studio/spectacles-dimensional-os.esproj`, not the
repo root. Do not edit `.scene` files by hand; use the Lens Studio MCP tools.

## Portable boundaries

`ARModuleClient` depends on small TypeScript interfaces supplied by the host:

| Port | Portable code needs | Spectacles implementation |
|------|---------------------|----------------------------|
| Transport | Connect/close, send whole text/binary frames, receive them, and report connection events | `InternetModule` WebSocket adapter |
| Clock | Monotonic `now()` in the `ts_client` clock family | Lens `getTime()` adapter |
| Tracking | Current camera optical frame for line-of-sight checks | Device tracking adapter |
| Capture | One JPEG with exposure timestamp, camera optical frame, and intrinsics | Device colour-camera adapter |
| Coordinate basis | Convert poses and points between `odom` and the caller's tracking frame | Spectacles left-handed Y-up basis |
| Capture geometry | Required line-of-sight distance, look-at tolerance, and frame cadence | Explicit Spectacles configuration |

The transport performs platform socket operations and carries whole frames;
newline framing is portable, not a host concern. The portable session owns
handshake and reconnect policy. The capture port returns facts measured at
exposure; it does not decide when an episode starts. The coordinate basis is
selected when the client is constructed, so the same math and composition
code works for a WebXR host whose tracking frame uses different axes.

All required dependencies and wire fields are validated. Missing inputs,
invalid messages, unsupported layouts, and impossible lifecycle transitions
fail explicitly instead of using hidden defaults.

## State and effects

Each mutable concern has one owner:

- The session owns connection facts, `hello`, `time_sync`, and the newest
  `state`, `pose`, `nav_goal`, and `lidar` values.
- Alignment owns the newest `localization_result` (`T_odom_client`).
- The capture episode owns its active request and captured observations.
- Spectacles controllers own scene presentation and teardown.

Portable code stores received events and inputs, then derives views from them.
It does not store duplicate booleans such as `handshakeReady`,
`worldFrameCommitted`, or `isCapturing`. The public derived view includes:

- connection: `disconnected` | `connecting` | `awaiting_hello` | `ready` |
  connection `failed`
- aligned: whether a `localization_result` has been applied on this connection
- capture episode: `idle` | `waiting_for_gate` | `capturing` | `sending` |
  `awaiting_result` | episode `failed`
- capabilities from `hello.capabilities`
- navigation from `state.nav` (`state` / `outcome`)

State transitions produce wire-send effects. The session executes those
effects through the transport; Spectacles controllers consume derived state
to present or tear down scene and UI. UX does not mirror portable state in a
second application store.

## Six groups

### 1. Protocol and coordinates — `ARModuleClient`

The contract, and the one piece of math every headset must get right.

Rewrite the protocol module to v2 (14 message types). Typed encode/decode for
JSON and the two binary layouts (`"LOCA"` observations, `"LDAR"` float32
points). Axis conversion as a named, tested helper — Spectacles' basis is the
first table, not a special case baked into every caller. Metres on the wire;
no `robot_id`; no protocol version field.

Text framing belongs here, next to the codec: append `\n` when sending JSON,
accumulate and split received text on `\n` before decoding. `ARModule` splits
client-to-server text the same way (`dimos/ar/websocket/server.py`,
`split_inbound_text_lines`), so a WebXR host inherits framing rather than
reimplementing it.

Two wire layouts for the same idea need distinct decoders: `pose`,
`nav_goal_request` and `localization_result` are position `[x, y, z]` plus
scalar-last quaternion, while `nav_goal.pose` and every `nav_goal.path_poses`
entry are `[x, y, z, yaw]` radians. Convert yaw to the client basis through the
same helper, not by negating a number at the call site.

No sockets. No scene. Tests against fixtures and `PROTOCOL.md`.

The coordinate helper receives a basis implementation. Spectacles and WebXR
select different basis tables without changing protocol or transform
composition code.

### 2. Session and alignment — `ARModuleClient`

How a client talks to `ARModule` and where it thinks it is.

On connect the client sends `hello_request { ts_client }` as the first text
frame, and it must be the only JSON object in that frame. `hello` returns
`client_id`, `time_sync`, `hello.robot` (`body_bounds_m`, `footprint_m`,
`base_height_m` — group 5 places a ground marker under `pose` with the last of
these), and `hello.capabilities` (`lidar`, `navigation`, `localization`,
`estop`). `time_sync` is the clock pair (`ts_client`, `ts_server`). There is
no ping/pong burst; WebSocket Ping/Pong is liveness only. `ARModule` sends
`state` immediately after the handshake, so `ready` and the first `state`
arrive together.

Build the portable session over the transport and clock ports. It recognizes
every outbound (server → client) v2 message and exposes typed subscriptions,
including `localization_observations_request` for group 3. Group-specific
handlers attach without reopening the session.

Store `state`, `pose`, `nav_goal`, and binary `lidar` as session facts. Route
`localization_result` to alignment, which alone stores `T_odom_client` and
clears it on disconnect along with the rest of the connection's facts. Define
one named transform composition path for mapping `odom` content into the
caller's tracking frame; callers never compose or invert it independently.

The session owns connection transitions, hello timeout, disconnect cleanup,
and reconnect scheduling. A host transport only carries out connect, close,
send, and receive operations.

No camera. Fixtures are enough. `state.nav.state` is `idle` |
`following_path` | `resolved`, with `state.nav.outcome` (`succeeded` |
`failed`) non-null exactly when `resolved`. There is no
`world_frame_committed` on the wire — “aligned” means the client has applied
a `localization_result`.

### 3. Capture episode — `ARModuleClient`

The only remaining client-owned localization job.

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

**The gate only exists once the client is aligned.** Distance and look-at are
measured against `pose` composed with `T_odom_client` — and that composition
has no value before the first `localization_result`. While unaligned the
client captures immediately under every policy, exactly as v19 did
(`FrameCaptureController` passed a null robot position until commit), and the
wizard tells the wearer to look at the robot. Once aligned, later episodes
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
consumer of the same episode state. Episode facts derive `waiting_for_gate`,
`capturing`, `sending`, `awaiting_result`, and `failed`; those states are not
separately mutated flags.

`ARModule` sends nothing when localization fails, so the episode carries its own
result deadline: after the batch goes out the client waits in `awaiting_result`
until a `localization_result` arrives or the deadline passes, then reports
`failed`. While unaligned it then sends `localization_start_request` to ask for
a fresh episode, and repeats until a result lands. Back off between attempts
rather than retrying immediately — `ARModule` may withhold the prompt for a
provider cooldown (30 s for client VPS, `dimos/ar/localization/policy.py`) and
deliver `localization_observations_request` late. Once aligned, a failed
later episode does not self-retry; `ARModule` prompts again on the next
qualifying navigation goal, and the wearer can send
`localization_start_request` from the HUD.

No standing capture session, no ACK/`seq`, no motion-triggered recapture, no
separate `camera_info` message.

### 4. Control — `ARModuleClient`

Outbound commands, portable.

`nav_goal_request` (position and orientation both required, in `odom` after
axis conversion), `estop_request` (event, no latch — resume is a new
`nav_goal_request`),
`lidar_settings_request` (`enabled` plus height band and range, all
required), `state_request`.

Command validation and capability checks use current session facts. Commands
emit send effects through the session; this group does not keep navigation
execution state, place markers, or draw a path.

### 5. Spectacles logic

This headset's sensors and scene. Not the core.

Implement the ports: WebSocket transport (whole text and binary frames,
Spectacles-safe connect), Lens clock, current camera tracking, device colour
capture, and Spectacles coordinate basis. Add the composition root that
constructs `ARModuleClient` and ticks it. The transport executes reconnect
attempts requested by the portable session.

Apply composed poses to the robot, `nav_goal.path_poses`, and `lidar`.
`pose` carries the odometry scale correction and `lidar` does not, so the two
drift apart with distance from the `odom` origin: draw each from `odom`
independently, and never re-anchor `lidar` on the robot.
Ground placement converts a tracked-room hit into a `nav_goal_request`.
Scene presenters and controllers read the portable derived view and own scene
presentation and teardown.

No panels, no wizard copy, no wrist menu. Those are group 6.

A WebXR client redoes this group against the same `ARModuleClient`.

### 6. Spectacles UX

What the wearer sees and presses.

Connect wizard (IP, handshake status). Runtime HUD (editor panel vs
Spectacles palm / wrist). `estop_request`, LiDAR presets as labels over
`lidar_settings_request`, debug overlay. Status copy from `state` and
`hello.capabilities` — not from a registration session.

The old “register the robot” step becomes: wait for
`localization_observations_request`, capture, apply the first
`localization_result`. There is no fiducial-marker progress bar, scale-lock
walk, or commit on the wire.

A failed episode is visible, not silent: the wizard reports the retry while the
client keeps sending `localization_start_request`, and the HUD offers that
same request once the wearer is past the wizard. Losing the connection drops
alignment, so runtime content hides until the next `localization_result`
lands.

The same capture presentation can appear again during runtime when a new
episode is requested. Wizard and HUD derive copy, progress, visibility, and
button availability from the portable connection, alignment, episode,
capability, and navigation views. They do not own duplicate lifecycle enums
or booleans.

A WebXR client redoes this group.

## What is not in this client

These existed in the v19 Lens and are not on the v2 wire. Do not reimplement
them:

- Registration session (`registration_command`, `registration_status`,
  `registration_pose`, commit, scale lock, tag profile)
- `world_frame_correction` and client-side drift / approximate-align math
- Agent channel (`user_command`, `agent_response`, `ar_skill`, speech,
  world annotations, `operatingMode: "agent"`)
- `robot_id` on messages, `protocol_version`, ping/pong clock sync
- Separate `runtime_snapshot` / `bridge_status` / `nav_status`
- ACK-gated `camera_frame` streaming and a standing `capture_policy` message
- Joystick / teleop

Existing v19 files are reference for Spectacles camera, connect, placement,
and drawing — not a directory map to copy.

## Tests and CI

Vitest stays in `lens-studio/Tests` and imports `ARModuleClient` the same way
it imports today's protocol. Groups 1–4 should be fully unit-tested without
Lens Studio. Cover malformed input and invalid lifecycle transitions as well
as successful fixtures. Use fake ports to test handshake, reconnect,
alignment replacement, alignment cleared on disconnect, repeated capture
episodes, the result-deadline retry loop, and emitted wire effects.
Groups 5–6 keep tests for portable helpers; scene behaviour is checked in the
editor / on device. `Tests/vitest.config.ts` lists v19 paths in its coverage
`include`; point it at `ARModuleClient` as those files land.

`./launcher/scripts/run-ci.sh` from the repo root remains the pre-commit
gate (DimOS tests + Lens Vitest). Run it outside the Cursor sandbox.

`dimos-ar/PROTOCOL.md` is the existing contract; implementing it does not
change the server protocol. If work reveals a contract change, update in the
same change:

- `dimos-ar/dimos/ar/websocket/protocol.py`
- `dimos-ar/PROTOCOL.md`
- `lens-studio/Assets/Scripts/ARModuleClient/protocol.ts`

When the new protocol module becomes authoritative, update `.cursorrules` and
`CONTRIBUTING.md` to replace the old
`lens-studio/Assets/Scripts/ARBridge/Network/Protocol.ts` path. Delete the old
module only when its imports have migrated.

## Outcome

After group 6 the Spectacles Lens speaks v2, owns `T_odom_client`, captures
only when asked, and draws odom content in the room. `ARModuleClient` is the
reference core for a later WebXR client. Production TypeScript should land
smaller than today's ~17k LOC because the session state the headset used to
own is gone.
