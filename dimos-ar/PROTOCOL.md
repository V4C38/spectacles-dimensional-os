# Protocol — ARModule WebSocket message schema

Cross-platform contract between `ARModule` and any AR client.

Keep this document and `dimos/ar/websocket/protocol.py` in sync. Implementing
clients update their protocol module in the same change.

## Changelog

### v2 — user_message_request / agent_message

- **`user_message_request`** — client → ARModule `{ text }`. Client command
  (`*_request`). Replaces inbound `human_input_request`. Non-blank, max 4000
  characters. No audio. Gated on `hello.capabilities.agent`. ARModule publishes
  DimOS `human_input: Out[str]`.
- **`agent_message`** — ARModule → clients `{ text }` assistant-only, non-blank.
  Replaces outbound `agent`. Do not apply the inbound 4000-character cap.
- **`agent_skill`** — unchanged. Skill invocation, not a chat turn.

### v2 — nav_goal_request / nav_joystick_request and nested navigation capabilities

- **19 message types** — 9 outbound, 10 inbound.
- **`nav_goal_request`** — client → ARModule `{ position, orientation }`. Client
  command (`*_request`). Overlay telemetry stays the bare noun `nav_goal`.
  ARModule publishes DimOS `goal_request`.
- **`nav_joystick_request`** — client → ARModule `{ linear, angular, duration? }`.
  Client command (`*_request`), same naming as `nav_goal_request`. `linear` and
  `angular` are metres per second and radians per second. Go2 direct drive uses
  `linear.x`, `linear.y`, and `angular.z`; nonzero `linear.z`, `angular.x`, or
  `angular.y` is rejected. Optional `duration` is a one-shot hold in seconds
  (`0 < duration <= 2.0`); omit or send `0` to publish once. Boolean and
  non-finite values are rejected. Not odom-scale-corrected. ARModule publishes
  DimOS `tele_cmd_vel`; `MovementManager` muxes with `nav_cmd_vel`.
- **`human_input_request`** — client → ARModule `{ text }`. Superseded by
  `user_message_request` above. ARModule publishes DimOS `human_input: Out[str]`.
- **`hello.capabilities.navigation`** — parent `{ available, reason }` is true
  when **any** nested input is available. Nested keys `nav_goal` and
  `nav_joystick` are always present with the same `{ available, reason }`
  shape. Point-and-click and `nav_goal_request` gate on `nav_goal`;
  `nav_joystick_request` gates on `nav_joystick`. Parent `available` is not a
  substitute for `nav_goal`.

### v2 — client pose and named AR markers

- **18 message types** — 9 outbound, 9 inbound. Superseded by the
  nav_joystick_request count above.
- **`client_pose`** — client → ARModule `{ position, orientation, ts }`. Same
  odom fields as outbound robot `pose`. Inbound `ts` is Lens `getTime()`
  (seconds since start) and is metadata only. Freshness is server receive
  time (`now - received_at` > 2 s is stale). Latest-wins; do not queue.
- **`ar_place_marker` / `ar_remove_marker`** — `agent_skill` names. Place
  requires `{ id, x, y, z }` and optional `title`. Remove requires `{ id }`.
  `id` is the handle (required, non-blank, max 64). Same `id` upserts.

### v2 — agent messages

- **17 message types** — 9 outbound, 8 inbound. Superseded by the client-pose
  count above.
- **`human_input`** — client → ARModule `{ text }`. DimOS stream name (no
  `_request` suffix), same documented exception style as
  `localization_observations`. Non-blank, max 4000 characters. No audio.
- **`agent`** — ARModule → clients `{ text }` assistant-only, non-blank.
  Superseded by `agent_message` above.
- **`agent_skill`** — ARModule → clients `{ name, args }`. `args` is an opaque
  JSON object. Unknown `name` values are ignored on the host.
- **`hello.capabilities.agent`** — `available=true` when the running blueprint
  configured `ARModule` with a DimOS agent. Otherwise `available=false` with
  reason `current blueprint has no DimOS agent`.
- **`state.agent.idle`** — always present. `true` when the capability is
  unavailable, before the first `agent_idle` publication, or when `McpClient`
  reports idle. Conversation is process-global (broadcast).

### v2 — ARModule-owned localization

- **14 message types** — 7 outbound, 7 inbound. Superseded by the agent-message
  count above.
- **Server-to-client `*_request` is allowed** when ARModule needs the client to act.
  `localization_observations_request` is that exception. Other client commands
  still use `*_request`; other server replies still use the bare noun.
- **`localization_observations_request`** — ARModule → one client. Fields:
  `capture_policy` (`robot_los_required` | `robot_los_preferred` | `any_angle`),
  `observation_count`, and `wait_timeout_s` when the policy is `robot_los_preferred`.
  No provider names on the wire.
- **`localization_start_request`** — client → ARModule JSON with no camera payload.
  A client asks for an episode with it; no frame is sent when localization fails,
  so this is also how a client retries.
- **`localization_observations`** — renamed from `localization_request`. Same
  binary layout; FourCC remains `"LOCA"`.
- **`localization_result`** — renamed from `localization`. Sent only after a
  successful capture episode. Never unsolicited.
- **`state.alignment` removed.** `localization_observations_request` is the only
  prompt to capture.
- **`hello.capabilities`** — keys `lidar`, `navigation`, `localization`, `estop`,
  `agent`. Any key may be `available=false` with `reason`. `localization` is
  false when no provider is configured; `lidar` / `navigation` / `estop` follow
  the selected robot profile; `agent` follows the running blueprint.
- **`ts_capture`** — exposure time on `localization_observations` (was `capture_ts`).
  Same clock family as `ts_client` / `ts_server` / `ts_odom`.

### v1 — minimal alignment protocol

Fresh protocol for the v2 rebuild. Not compatible with v19, and not compatible
with any earlier draft of this document.

- **Wire frame:** **`odom`** — the robot's drifting leg-odometry frame, in
  DimOS's right-handed Z-up axes. ARModule performs **no axis conversion**. Each
  client converts on receipt; clients do not share one scene convention.
- **12 message types** — 6 outbound, 6 inbound. Superseded by v2 above.
- **No `robot_id` echo** on inbound messages. One ARModule process serves one
  robot, declared once in `hello`.
- **No registration session.** Alignment is a capture episode, not a continuous
  solver.
- **Merged status.** `state` replaces `runtime_snapshot`, `bridge_status` and
  `nav_status`.
- **Clock sync in `hello`.** Client sends `hello_request` with `ts_client`;
  server replies with `hello` including echoed `ts_client` and paired `ts_server`
  (when the request arrived). ARModule stores the offset per connection and
  converts inbound `ts_capture` from client time to server time. WebSocket
  Ping/Pong (RFC 6455) remains for liveness only.
- **Request/result naming.** Client commands use `*_request`; server replies and
  telemetry use the bare noun (`state`, `nav_goal`, `localization_result`, …).
  `hello` is the handshake reply. See v2 for the `localization_observations_request`
  exception.

## Transport

- Plain WebSocket on port **8787**. The DimOS machine runs the server; AR devices
  connect as clients.
- JSON text frames for control and telemetry. Binary frames for
  `localization_observations` (client → server) and `lidar` (server → client).
- Every JSON message is an object with a `type` field.
- **Text framing:** outbound JSON text frames end with a single newline (`\n`).
  Clients accumulate incoming text and split on `\n` to recover complete
  messages. Binary frames are not newline-delimited.
- All binary layouts are **little-endian**.

## Coordinate conventions

Every position and orientation on the wire is in the **`odom`** frame, in
DimOS's axes:

| Axis | Direction |
|------|-----------|
| X | Forward |
| Y | Left |
| Z | Up |

Right-handed, Z-up, metres. This is the ROS convention that DimOS follows
throughout.

Poses are position `[x, y, z]` and orientation `[qx, qy, qz, qw]` — quaternion,
scalar-last.

### What `odom` is

`odom` is the selected stack's robot reference pose. Every compatible DimOS
stack must publish `odom: PoseStamped`. On a mobile platform this pose usually
drifts (dead reckoning from a boot origin). A fixed-base stack may publish a
stable pose, including identity, for as long as the base does not move.

Two consequences for clients on a drifting stack:

- Content anchored in `odom` slowly diverges from the physical room.
- ARModule issues corrections through `localization_result` (see below). A client
  should apply the newest one it has rather than assuming its first alignment
  holds forever.

Fiducial marker localization and robot-side VPS anchoring look up that pose at
shutter time. Robot-side VPS also needs an onboard camera extrinsic
(`T_base_camera_optical`). Declared DimOS ports for LiDAR and navigation stay
on `ARModule`; they no-op when `hello.capabilities` reports them unavailable.

DimOS Go2 drivers currently stamp this frame as `frame_id="world"` on incoming
messages; ARModule normalizes that to `odom` at the import boundary and uses
`odom` everywhere on the wire and in client-facing docs.

### Axis conversion is the client's job

ARModule never remaps axes. A client with a different convention converts on
receipt and inverts the conversion on anything it sends.

Informative example, for a left-handed Y-up client (X right, Y up, Z forward):

```text
x_client = -y_odom
y_client =  z_odom
z_client =  x_odom
```

Orientation must be converted with the same basis change, which for a
handedness flip is easy to get subtly wrong. This matrix is the contract;
each client owns its implementation.

### Odometry scale correction

The Go2 under-reports how far it has travelled, because its odometry is derived
from leg kinematics and feet slip during stance. ARModule corrects this with a
fixed per-robot constant before anything reaches the wire, so clients do not
need to know it exists.

What carries the correction, and what does not:

| Data | Corrected |
|------|-----------|
| `pose` position, X and Y | yes |
| `nav_goal` pose and `path_poses` X and Y | yes |
| `nav_goal_request` position X and Y (inverted on ingress) | yes |
| Height (Z) on any message | no |
| Orientation on any message | no |
| `speed_mps` and any other rate or direction | no |
| `nav_joystick_request` linear and angular | no |
| `lidar` points | no |

Height is excluded because slip costs horizontal travel, not altitude.
Orientation is excluded because heading error is not a linear factor and there
is nothing sound to scale. LiDAR is excluded because its points are metric range
measurements rather than dead-reckoned positions, and stretching them would
misreport the size of the room.

The practical consequence for a client: **`lidar` and `pose` are both correct but
are not perfectly mutually consistent**, and they diverge with distance from the
odometry origin. Do not derive one from the other, and do not use `pose` to
re-anchor the cloud. Each `localization_result` re-anchoring resets the divergence.

## Multiple clients

Any number of clients may connect at once.

- **Telemetry is broadcast.** Every client receives identical `pose`, `nav_goal`,
  `lidar` and `state`. Payloads are byte-identical, so there is no per-client
  view to reconcile.
- **Localization is per connection.** `localization_observations_request` and
  `localization_result` are addressed to one connection, since each client has
  its own tracking origin.
- **Control is last-command-wins.** ARModule does not arbitrate. The most
  recent `nav_goal_request`, `nav_joystick_request`, or `estop_request` takes
  effect regardless of which client sent it. ARModule publishes joystick
  commands on DimOS `tele_cmd_vel`; `MovementManager` muxes that stream against
  planner `nav_cmd_vel`.

`hello` assigns each connection a `client_id` for logging and future features.
Navigation overlay uses `nav_goal` and `pose`. `state.nav` tracks planner
navigation regardless of who issued the goal.

## Handshake

On connect the client sends `hello_request`, then the server sends `hello` and
`state`.

### `hello_request` (client → server, first text frame)

```json
{
  "type": "hello_request",
  "ts_client": 1234.567
}
```

| Field | Type | Notes |
|-------|------|-------|
| `ts_client` | float | Client local time when the frame was sent (`ts_client`). |

The client must send exactly one JSON object in the first text frame. ARModule
records `ts_server` on receipt, stores the client/server offset for this
connection, and replies with `hello`.

### `hello` (server → client)

```json
{
  "type": "hello",
  "client_id": "c3f1a9",
  "time_sync": {
    "ts_client": 1234.567,
    "ts_server": 5678.901
  },
  "robot": {
    "display_name": "Unitree Go2",
    "body_bounds_m": [0.70, 0.50, 0.55],
    "footprint_m": [0.70, 0.50],
    "base_height_m": 0.33
  },
  "capabilities": {
    "lidar": { "available": true, "reason": null },
    "navigation": {
      "available": true,
      "reason": null,
      "nav_goal": { "available": true, "reason": null },
      "nav_joystick": { "available": true, "reason": null }
    },
    "localization": { "available": true, "reason": null },
    "estop": { "available": true, "reason": null },
    "agent": { "available": false, "reason": "current blueprint has no DimOS agent" }
  }
}
```

| Field | Type | Notes |
|-------|------|-------|
| `client_id` | string | Server-assigned, unique per connection. |
| `time_sync.ts_client` | float | Echo of `hello_request.ts_client`. |
| `time_sync.ts_server` | float | Server time when `hello_request` arrived. |
| `robot.display_name` | string | For client UI. |
| `robot.body_bounds_m` | `[L, W, H]` | Axis-aligned envelope in `odom` axes: length X, width Y, height Z. |
| `robot.footprint_m` | `[L, W]` | Ground footprint for nav UI. |
| `robot.base_height_m` | float | Height of the odometry pose origin above the ground, so a client can place a ground marker under a `pose`. |
| `capabilities.*.available` | bool | Feature gate for client UI. Keys are `lidar`, `navigation`, `localization`, `estop`, and `agent`. |
| `capabilities.*.reason` | string \| null | Human-readable, non-null exactly when `available` is `false`. |
| `capabilities.navigation.nav_goal` | `{ available, reason }` | Can send `nav_goal_request`. Always present. |
| `capabilities.navigation.nav_joystick` | `{ available, reason }` | Can send `nav_joystick_request`. Always present. |

`navigation.available` is true when any nested input is available. Clients that
need a specific input check that nested key; Specs point-and-click checks
`nav_goal`.

ARModule keeps `ts_server - ts_client` as the per-connection offset. The client
may use the same pair for its own UI timing; localization does not require the
client to know server time.

Which localization provider is configured is a deployment fact and is not on
the wire. `hello.capabilities.localization.available` is `false` (with `reason`)
when no provider is configured. `lidar`, `navigation`, and `estop` may also be
`available=false` with `reason` when the selected robot profile does not offer
them. `agent` is `available=false` with `reason` when the current blueprint
did not configure a DimOS agent. Capture geometry is a `capture_policy` on each
`localization_observations_request`, not a hello field.

## Outbound messages (server → client)

### `hello`

Sent once per connection after `hello_request`. See handshake above.

### `state`

Merged runtime snapshot. Sent on connect, in response to `state_request`, and
whenever any field changes.

```json
{
  "type": "state",
  "server": {
    "connected_clients": 1
  },
  "lidar": {
    "enabled": true,
    "min_height_m": 0.1,
    "max_height_m": 1.5,
    "max_range_m": 5.0
  },
  "nav": {
    "state": "idle",
    "outcome": null
  },
  "agent": {
    "idle": true
  }
}
```

**`server.connected_clients`:** live WebSocket connections to this process.

**`nav.state`:** `"idle"` | `"following_path"` | `"resolved"`

ARModule derives this from DimOS `path` and `goal_reached`. DimOS also declares a
`recovery` phase on `navigation_state`, but that stream is never published; it is
not on the wire until it can actually be emitted.

**`nav.outcome`:** non-null exactly when `nav.state` is `"resolved"`:
`"succeeded"` | `"failed"`

Where the robot is going, use **`nav_goal`** (route + terminal pose) and **`pose`**
(robot). `state.nav` reflects any active navigation — `nav_goal_request`, MCP
`set_goal`, or any other DimOS goal source:

- **`following_path`** while a non-empty planner path is active
- **`resolved`** when `goal_reached` fires (success or failure)
- **`idle`** otherwise

ARModule does not record who started navigation.

**`agent.idle`:** `true` when no DimOS agent is configured, before the first
agent turn, or when `McpClient` reports idle. `false` while the agent is
processing. Always present, same shape as `state.nav`.

### `agent_message`

Assistant text. Broadcast. Sent only for textual `AIMessage` content.

```json
{
  "type": "agent_message",
  "text": "Heading to the kitchen."
}
```

| Field | Type | Notes |
|-------|------|-------|
| `text` | string | Non-blank assistant text. No inbound 4000-character cap. |

Human, tool, tool-only, and empty messages are not forwarded.

### `agent_skill`

A server `@skill` asked the connected AR clients to apply a visual. Broadcast.
Do not wait for ACK. Unknown `name` values are ignored on the host.

```json
{
  "type": "agent_skill",
  "name": "ar_place_marker",
  "args": {
    "id": "kitchen",
    "x": 1.0,
    "y": 0.0,
    "z": 0.0,
    "title": "Kitchen"
  }
}
```

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Skill name. Known names: `ar_place_marker`, `ar_remove_marker`. |
| `args` | object | Opaque JSON object. Known names with invalid args fail closed. |

`ar_place_marker` args are a required `id` (non-blank, max 64, trimmed), an
odom-frame point (`x`, `y`, `z` in meters), and an optional `title`. Omit
`title` or send `""` for an unlabeled marker. Same `id` upserts. The host
composes the point through `T_odom_client` and instantiates the marker prefab.

`ar_remove_marker` args are `{ "id": "kitchen" }`. Unknown `id` is an error on
`ARModule`; the host destroys that prefab.

### `localization_observations_request`

ARModule → one client. Prompt to capture a camera batch and send
`localization_observations`. This is a server-to-client `*_request`: ARModule
needs the client to act.

```json
{
  "type": "localization_observations_request",
  "capture_policy": "robot_los_required",
  "observation_count": 3
}
```

| Field | Type | Notes |
|-------|------|-------|
| `capture_policy` | string | `robot_los_required` \| `robot_los_preferred` \| `any_angle`. Geometric gate only — not a provider name. |
| `observation_count` | uint | Exact batch size. The client always sends this many frames. |
| `wait_timeout_s` | float | Required when `capture_policy` is `robot_los_preferred`. Omitted otherwise. |

`robot_los_required`: wait until robot line-of-sight gates pass, then capture.
`robot_los_preferred`: wait for those gates until `wait_timeout_s`, then capture
anyway (including after timeout). `any_angle`: capture with no robot LOS gates.

Example with timeout:

```json
{
  "type": "localization_observations_request",
  "capture_policy": "robot_los_preferred",
  "observation_count": 3,
  "wait_timeout_s": 2.0
}
```

### `localization_result`

The client's own pose in `odom` — its tracking origin expressed in odom
coordinates. Apply the newest one received.

```json
{
  "type": "localization_result",
  "position": [1.2, -0.4, 0.0],
  "orientation": [0.0, 0.0, 0.38, 0.92],
  "confidence": 0.87,
  "ts": 1710000000.123
}
```

| Field | Notes |
|-------|-------|
| `confidence` | 0.0–1.0. |
| `ts` | `ts_server` when the fix was produced. Wire key stays `ts`. |

Sent only after a successful capture episode that started with
`localization_observations_request` (whether ARModule prompted on its own or a
client asked with `localization_start_request`). Never
unsolicited — a `T_odom_map` refresh does not push a new result.

Always in `odom`, regardless of which frame the underlying provider works in.
When a provider answers in a scanned-map frame ARModule composes it into
`odom` before sending, because only ARModule knows that relationship.

### `pose`

Robot pose in `odom`, at high rate.

```json
{
  "type": "pose",
  "position": [0.0, 0.0, 0.0],
  "orientation": [0.0, 0.0, 0.0, 1.0],
  "ts": 1710000000.123
}
```

| Field | Notes |
|-------|-------|
| `ts` | Odometry timestamp (`ts_odom`): DimOS `PoseStamped.ts` from the Go2, seconds, floating point. Not server time. |

X and Y carry the odometry scale correction; Z and orientation do not. Optional
fields may be added later (`speed_mps`, `yaw_rate_rad_s`); clients ignore unknown keys.

### `nav_goal`

Active navigation in `odom`: the planned route plus the terminal pose where
the robot intends to finish. Sent whenever DimOS publishes a path update.

```json
{
  "type": "nav_goal",
  "pose": [1.0, 1.0, 0.0, 0.785],
  "path_poses": [[0.0, 0.0, 0.0, 0.785], [0.5, 0.5, 0.0, 0.785], [1.0, 1.0, 0.0, 0.785]],
  "ts": 1710000000.123
}
```

| Field | Notes |
|-------|-------|
| `pose` | Terminal pose in `odom` as `[x, y, z, yaw]` radians — maps to the last
  `PoseStamped` on DimOS `path`. Position X/Y are scale-corrected; Z and yaw are
  not. Today this duplicates the last `path_poses` entry; clients should treat
  `pose` as authoritative for the target. |
| `path_poses` | Route polyline as `[x, y, z, yaw]` waypoints — maps to `Path.poses`.
  Same units and rounding as `pose`. Yaw comes from each DimOS path pose
  (approach direction along the segment). Wire values are rounded to 3 decimal
  places on position and 4 on yaw (~1 mm, ~0.006°). |
| `ts` | DimOS `Path.ts` (same clock family as `pose.ts` / `ts_odom`). |

Empty `path_poses` clears the visualization — navigation finished, was cancelled,
or no plan exists. `pose` is omitted on clear:

```json
{
  "type": "nav_goal",
  "path_poses": [],
  "ts": 1710000000.123
}
```

### `lidar` (binary)

| Offset | Size | Field |
|--------|------|-------|
| 0 | 4 | FourCC `0x4C444152` (`"LDAR"`) |
| 4 | 8 | `ts` float64, DimOS `PointCloud2.ts` |
| 12 | 4 | `point_count` uint32 |
| 16 | `point_count * 12` | Points: `[x, y, z]` float32 triplets in `odom` |

Points are pre-filtered on ARModule: height band, range, and subsampling
toward the robot. They carry **no scale correction** — see the coordinate section
above for why, and for why they must not be reconciled against `pose`.

## Inbound messages (client → server)

Inbound messages do not carry `robot_id`.

### `localization_start_request`

```json
{
  "type": "localization_start_request"
}
```

Client-initiated capture. No payload. ARModule responds with
`localization_observations_request` using the same capture policy as a
server-initiated prompt. The client then sends `localization_observations` as
usual.

Because no frame is sent when localization fails, this is the retry path: a
client that gets no `localization_result` before its own deadline asks for
another episode. ARModule may withhold the prompt until a provider cooldown
expires and send `localization_observations_request` later, so clients back off
between attempts rather than assuming a prompt per request.

### `localization_observations` (binary)

Submits one or more camera observations after `localization_observations_request`.

Multiple observations in one request let a provider fuse viewpoints, which
matters when a single frame is ambiguous. A client may send one.

Header:

| Offset | Size | Field |
|--------|------|-------|
| 0 | 4 | FourCC `0x4C4F4341` (`"LOCA"`) |
| 4 | 2 | `observation_count` uint16, at least 1 |

Then `observation_count` records, each. Offsets include `record_len`. After
that field (`record_start` in `protocol.py`) the reserved word is at +16 and
camera position at +20.

| Offset | Size | Field |
|--------|------|-------|
| 0 | 4 | `record_len` uint32, byte count after this field |
| 4 | 8 | `ts_capture` float64, `ts_client` at exposure |
| 12 | 4 | `jpeg_len` uint32 |
| 16 | 4 | `intrinsics_len` uint32 |
| 20 | 4 | reserved uint32, must be 0 |
| 24 | 12 | Camera position, float32 × 3 |
| 36 | 16 | Camera orientation, float32 × 4, scalar-last |
| 52 | `jpeg_len` | JPEG bytes |
| 52 + `jpeg_len` | `intrinsics_len` | Intrinsics, JSON UTF-8 |

`record_len` lets a reader skip a record it cannot parse.

**Intrinsics JSON**, for the frame in this record:

```json
{
  "fx": 640.0,
  "fy": 640.0,
  "cx": 320.0,
  "cy": 240.0,
  "width": 640,
  "height": 480,
  "distortion_model": "none",
  "distortion": []
}
```

`distortion_model` is one of `"none"`, `"plumb_bob"` or `"equidistant"`.
`distortion` is the coefficient array for that model (empty for `"none"`).
`width` and `height` must match the decoded JPEG dimensions; ARModule rejects a
record whose calibration describes a different image size.
ARModule undistorts to pinhole when a provider needs it (VPS always; fiducial marker
handles fisheye corners internally via DimOS).

**Camera pose** is the **camera optical frame** (X right, Y down, Z along the
view direction) expressed in the caller's own tracking frame. That frame must be
right-handed, gravity-aligned Z-up and metric — the same convention as DimOS
`odom`. A left-handed client converts its camera pose on the way in and
converts `localization_result.position` and `localization_result.orientation`
back on the way out.

**`ts_capture` is required and must be the exposure time in `ts_client`**,
not the time the message was assembled. ARModule converts it to `ts_server`
using the per-connection offset from `hello` before pose lookup. A localization
round trip can take seconds; pairing uses shutter time, not send time.

Response: `localization_result` after a successful episode. No frame is sent on
failure.

### `nav_goal_request`

```json
{
  "type": "nav_goal_request",
  "position": [1.0, 2.0, 0.0],
  "orientation": [0.0, 0.0, 0.0, 1.0]
}
```

Goal in `odom`. **`position` and `orientation` are both required** — same fields
as `pose`. Send them in the same coordinates you receive `pose` in; ARModule
inverts the scale correction on ingress and publishes to DimOS `goal_request`.

Gated on `hello.capabilities.navigation.nav_goal`.

### `nav_joystick_request`

```json
{
  "type": "nav_joystick_request",
  "linear": [0.4, 0.0, 0.0],
  "angular": [0.0, 0.0, 0.3]
}
```

Direct drive in m/s and rad/s, not a raw `[-1, 1]` stick deflection. Client
command (`*_request`), same naming as `nav_goal_request`. ARModule publishes on
DimOS `tele_cmd_vel: Out[Twist]`; `MovementManager` muxes with planner
`nav_cmd_vel`. Not odom-scale-corrected.

| Field | Type | Notes |
|-------|------|-------|
| `linear` | `[x, y, z]` | Required. Finite m/s. `z` must be `0`. Boolean values are rejected. |
| `angular` | `[x, y, z]` | Required. Finite rad/s. `x` and `y` must be `0`. Boolean values are rejected. |
| `duration` | float | Optional. Seconds to republish this twist. Omit or `0` publishes once. `0 < duration <= 2.0` holds at 10 Hz on ARModule, then a release-edge zero. Negative, boolean, non-finite, or above `2.0` is rejected, not clamped. |

A new `nav_joystick_request` replaces any in-flight duration. Zero twist is the
release edge. `estop_request` and last-client disconnect cancel a hold. Callers
that omit `duration` must keep sending if drive should continue
(`cmd_vel_timeout` is 0.2 s). Gated on `hello.capabilities.navigation.nav_joystick`.

With a hold:

```json
{
  "type": "nav_joystick_request",
  "linear": [0.4, 0.0, 0.0],
  "angular": [0.0, 0.0, 0.3],
  "duration": 0.5
}
```

### `estop_request`

```json
{
  "type": "estop_request"
}
```

Emergency stop — halts motion immediately. **There is no payload and no latch to release.**

Stopping is an event, not a mode. A latch that only the client can clear is a
footgun: a client that stops and then disconnects would leave the robot
immobilised with no way back short of restarting ARModule. The resume path is
issuing a new `nav_goal_request`.

ARModule also stops the robot on its own when the last client disconnects, so
losing the headset cannot leave the robot walking.

### `lidar_settings_request`

```json
{
  "type": "lidar_settings_request",
  "enabled": true,
  "min_height_m": 0.1,
  "max_height_m": 1.5,
  "max_range_m": 5.0
}
```

| Field | Type | Notes |
|-------|------|-------|
| `enabled` | bool | Required. `false` stops `lidar` frames entirely. |
| `min_height_m` | float | Required. Lower bound of the height band, in `odom` Z. |
| `max_height_m` | float | Required. Upper bound of the height band. |
| `max_range_m` | float | Required. Horizontal radius around the robot to keep. |

There is no mode enum. v19 offered `"off"`, `"full"` and `"obstacles"`, but
`"obstacles"` was not a mode — it was a preset of the same filter parameters the
other modes also accept. One boolean plus the parameters expresses all three
states without an enum whose values overlap.

All four fields are required on every `lidar_settings_request`. A non-finite or inverted band
(`min_height_m` above `max_height_m`) is an error and is rejected, not silently
clamped.

`state.lidar` reflects the result, and because telemetry is broadcast, one client
changing the filter changes it for everyone.

### `state_request`

```json
{
  "type": "state_request"
}
```

Response: `state`.

### `user_message_request`

```json
{
  "type": "user_message_request",
  "text": "go to the kitchen"
}
```

| Field | Type | Notes |
|-------|------|-------|
| `text` | string | Required. Non-blank after trim. Max 4000 characters. No audio. |

Client command (`*_request`). ARModule publishes the string on DimOS
`human_input: Out[str]` when `hello.capabilities.agent` is available and the
stream is wired. Last-command-wins; conversation is process-global.

### `client_pose`

Wearer camera-optical pose in `odom`. Telemetry, not a request. Latest-wins
on `ARModule`. Freshness is server receive time (2 s), not inbound `ts`.

```json
{
  "type": "client_pose",
  "position": [1.2, -0.4, 1.6],
  "orientation": [0.0, 0.0, 0.38, 0.92],
  "ts": 12.5
}
```

| Field | Notes |
|-------|-------|
| `position` | Odom metres, DimOS Z-up. Same fields as outbound robot `pose`. |
| `orientation` | Scalar-last quaternion. Zero quaternion is rejected. |
| `ts` | Lens `getTime()` at capture (seconds since start). Metadata only. |

Send only when the session is ready, `hello.capabilities.agent` is available,
and `T_odom_client` exists. Typical rate is 10 Hz. Last client disconnect
clears the server buffer. `ar_get_client_pose` reads this buffer; missing or
stale returns `No client pose`.

## Message inventory

| Client → server | Server → client |
|-----------------|-----------------|
| `hello_request` | `hello` |
| `state_request` | `state` |
| `localization_start_request` | `localization_observations_request` |
| `localization_observations` (binary) | `localization_result` |
| `nav_goal_request` | `nav_goal` |
| `nav_joystick_request` | `pose` |
| `estop_request` | `lidar` (binary) |
| `lidar_settings_request` | `agent_message` |
| `user_message_request` | `agent_skill` |
| `client_pose` | |

**Inbound naming.** Commands use `*_request` (`nav_goal_request`,
`estop_request`, `user_message_request`). Unsolicited telemetry uses a bare
noun (`client_pose`). Binary payloads use a bare noun
(`localization_observations`). Handshake-only: `hello_request`. Server-initiated
exception: `localization_observations_request`.

**Agent conversation.** `user_message_request` is wearer text to the DimOS
agent (gated on `hello.capabilities.agent`). `agent_message` is assistant text
only. `agent_skill` is a tool invocation, not a chat turn. On the DimOS side
the inbound string is published as `human_input: Out[str]`.

Paired requests: `hello_request` → `hello`, `state_request` → `state`,
`localization_observations_request` → `localization_observations` →
`localization_result` (on success), `nav_goal_request` → `nav_goal` (via
DimOS planner). `nav_joystick_request` takes effect through DimOS
`MovementManager` (`tele_cmd_vel`).
`estop_request` and `lidar_settings_request` take effect through
a broadcast `state` update. `user_message_request` takes effect through outbound `agent_message`
and `state.agent.idle`. `client_pose` is unsolicited inbound telemetry for
`ar_get_client_pose`. `pose` and `lidar` are unsolicited outbound telemetry.

## Dropped from v19

Not carried into v1:

- Registration session messages — `registration_command`, `registration_status`,
  `registration_pose`, `capture_policy`, `camera_frame_ack`. Capture uses
  `localization_observations_request` / `localization_observations` instead.
  Wire field `capture_policy` on that request is the v2 `CapturePolicy` enum,
  not v19's `capture_policy` message.
- `world_frame_correction`. A `localization_result` after a new capture says
  the same thing; ARModule does not push unsolicited updates.
- Separate `runtime_snapshot`, `bridge_status` and `nav_status`, merged into
  `state`.
- Agent messages — `user_command`, `agent_response`, `ar_skill` and the rest.
  Replaced by `user_message_request`, `agent_message`, and `agent_skill`.
- Inbound `robot_id` echo.
- JSON `lidar`. Binary only.
- `cancel_nav_goal`. Use `estop_request`.
- The `active` flag on `emergency_stop`, and the `"off"` / `"full"` /
  `"obstacles"` mode enum on `set_lidar_mode`.
- v19 `ping` and `pong`. Clock offset now rides in the `hello_request` /
  `hello` handshake; WebSocket Ping/Pong remains for liveness.
- Every scale field — `scale_confidence`, `scale_locked`, `scale_observable`.
  Scale is a fixed robot constant applied on ARModule and is not a client
  concern.
- Robot fiducial marker profile. Marker IDs and print sizes matter when generating a marker sheet, which
  is a launcher concern, not something a running client needs.

A client speaking a prior protocol is not compatible and needs its protocol
module rewritten.
