# Protocol — ARModule WebSocket message schema

Cross-platform contract between `ARModule` and any AR client.

Keep this document and `dimos/ar/websocket/protocol.py` in sync. Implementing
clients update their protocol module in the same change.

## Conventions

- **19 message types** — 9 outbound, 10 inbound. Inventory is below.
- **Wire frame is `odom`** — the robot's drifting leg-odometry frame, in
  DimOS's right-handed Z-up axes. ARModule performs **no axis conversion**. Each
  client converts on receipt; clients do not share one scene convention.
- **One robot per process.** Declared once in `hello`. Inbound messages do not
  echo a robot id.
- **Capture episodes.** ARModule sends `localization_observations_request`; a
  successful episode yields `localization_result`. Never unsolicited.
- **Clock sync in `hello`.** Client sends `hello_request` with `ts_client`;
  server replies with echoed `ts_client` and paired `ts_server` (when the
  request arrived). ARModule stores the offset per connection and converts
  inbound `ts_capture` from client time to server time. WebSocket Ping/Pong
  (RFC 6455) is for liveness only.
- **Naming.** Client commands use `*_request`; server replies and telemetry use
  the bare noun (`state`, `nav_goal`, `localization_result`, …). `hello` is the
  handshake reply. Server-to-client `*_request` is allowed when ARModule needs
  the client to act: `localization_observations_request` is that exception.
  Binary payloads use a bare noun (`localization_observations`, `lidar`).
- **`hello.capabilities`** — keys `lidar`, `navigation`, `localization`,
  `estop`, `agent`. Any key may be `available=false` with `reason`. Nested
  `navigation.nav_goal` and `navigation.nav_joystick` are always present.

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

Orientation must be converted with the same basis change. Each client owns
the conversion appropriate to its host; the example above is not the Lens basis.
Lens is right-handed Y-up with camera forward along -Z, so Specs uses
`x_specs = -y_tracking`, `y_specs = z_tracking`, `z_specs = -x_tracking` (plus
metres to centimetres). Camera poses additionally preserve optical local axes:
`R_tracking_optical = P^-1 R_specs_camera diag(1, -1, -1)`, where `P` maps
tracking vectors to Specs. Conjugating a camera quaternion alone is insufficient.
Specs navigation marker yaw is separate from a generic world-pose basis change:
the marker arrow uses local +X forward. Tracking yaw zero therefore renders as
Lens marker yaw +90 degrees, pointing along Lens -Z. Outgoing goals invert this
mapping so their terminal robot heading matches the displayed arrow.

### Odometry scale correction

Go2 uses an empirical XY multiplier of **1.25** to compensate for observed
under-reporting of motion. It is a dead-reckoning heuristic, not a calibrated
sensor model or a complete correction for time-varying drift. Set
`armodule.odom_scale_correction_factor` at startup to override the robot profile
(e.g. 1.0 for a source that does not need it). The installed WebRTC adapter reads
`rt/utlidar/robot_pose`; it does not read `sportmodestate` for this odometry port.
No claim about the firmware estimator's internals follows from that topic name.

ARModule uses one fixed mapping at the boundary:

```text
AR XY = factor * native DimOS XY
native DimOS XY = AR XY / factor
Z is unchanged
```

| Data | Correction |
|------|------------|
| Robot `pose`, active/preview paths and LiDAR world points | Fixed XY multiplier on egress |
| Robot odometry used by marker/VPS localization | Same XY multiplier before physical mounts are composed |
| `nav_goal_request` | Inverse XY multiplier before native planning |
| `ar_place_marker` agent tool | Native DimOS input → corrected wire point |
| `ar_get_client_pose` agent tool | Corrected client pose → native DimOS position/viewing ray |
| Heights, robot body dimensions and physical camera/marker mounts | Unchanged |
| Quaternions, joystick velocities and physical speed limits | Unchanged |
| LiDAR filtering/downsampling ranges and obstacle halo distances | Native sensor metres |

The completed `T_odom_client` is composed from the corrected robot position and
physical camera/marker measurements; it must not be multiplied again. Clients
render each wire point directly through that origin. **Do not multiply LiDAR
coordinates again on the client.** Specs and WebXR receive the same corrected data.

LiDAR XY is scaled about the fixed native odometry origin, independent of the
robot's current position. Repeated voxel-map geometry therefore stays registered.
A robot-relative per-packet translation is not equivalent and is not used.
Native maps, costmaps, obstacle clearances, and the confirmed DimOS planner stay
unchanged. Navigation inputs are converted back into that native frame.

The displayed horizontal size of a LiDAR feature also increases by the factor;
1.25 is explicitly an approximate AR world correction, not a claim that laser
ranges are 25% longer. The optional `hello.robot.odom_scale_correction_factor`
(default 1 when absent) lets portable sensor policies undo the mapping for native
range/clearance calculations. Physical calibration still requires a survey, and
repeated marker/VPS localization handles alignment drift that one constant cannot.
Changing the factor requires restarting ARModule and reconnecting clients so
origins, paths, previews and points cannot mix old/new coordinate models.

## Multiple clients

Any number of clients may connect at once.

- **Telemetry is broadcast.** Every client receives identical `pose`, active `nav_goal`,
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
| `robot.odom_scale_correction_factor` | float | Optional finite positive native-to-AR XY heuristic, default 1 when absent. Points/poses are already corrected; use it only to recover native distances. |
| `capabilities.*.available` | bool | Feature gate for client UI. Keys are `lidar`, `navigation`, `localization`, `estop`, and `agent`. |
| `capabilities.*.reason` | string \| null | Human-readable, non-null exactly when `available` is `false`. |
| `capabilities.navigation.nav_goal` | `{ available, reason, preview? }` | Can send `nav_goal_request`. Always present. Optional boolean `preview` defaults to false. |
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
corrected wire-odom point (`x`, `y`, `z`), and an optional `title`. Omit
`title` or send `""` for an unlabeled marker. Same `id` upserts. The host
composes the point through `T_odom_client` and instantiates the marker prefab.

`ar_remove_marker` args are `{ "id": "kitchen" }`. Unknown `id` is an error on
`ARModule`; the host destroys that prefab.

### `localization_observations_request`

ARModule → one client. Prompt to capture a camera batch and send
`localization_observations`. This is a server-to-client `*_request`: ARModule
needs the client to act.

After an unsuccessful scan, ARModule requests a replacement batch with this
same message (subject to provider cooldowns). Clients resume capture immediately;
the result timeout is only a fallback for a missing response.

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
| `result_timeout_s` | float | Optional finite positive result deadline in seconds from batch submission. Default 15 when absent. |

The default client frame spacing is 0.5 seconds. A fiducial episode requests
three observations and requires at least two agreeing marker detections after
quality and gravity-consistency filtering. The Specs wizard defers its initial
prompt until the wearer enters the localization step.

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
coordinates. Apply only a result matching the currently outstanding capture batch
in this connection and localization generation. A paused, reset, timed-out, or
superseded capture must not change the origin or complete a later episode.

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
| `ts` | Latest submitted capture timestamp converted to the server clock: `max(ts_capture) + hello.time_sync.ts_server - hello.time_sync.ts_client`. This identifies the submitted batch; it is not HTTP completion time. |

Sent only after a successful capture episode that started with
`localization_observations_request` (whether ARModule prompted on its own or a
client asked with `localization_start_request`). Never
unsolicited — a `T_odom_map` refresh does not push a new result.

ClientCore registers a batch before sending it and requires its capture-derived
`ts` (within 1 microsecond of float64 rounding), before the advertised result
deadline. Camera timestamps must increase between submissions in one connection;
retries need fresh frames. Unmatched results are ignored before origin updates
or subscriber delivery. The LOCA binary layout is unchanged; there is no ACK/seq.
Older servers omitting `result_timeout_s` use the 15-second client fallback.

ARModule admits at most one episode per client and one global VPS workflow.
Localization never occupies a client's WebSocket read loop. The default server
budget is 12 seconds from admission, including CPU/HTTP queueing, authentication,
token refresh, and robot/headset queries; the advertised client timeout is the
configured budget plus 3 seconds. Cancellation retires delivery and aborts HTTP.
A miss or exception schedules a new capture after backoff/provider cooldowns;
images are never held through a cooldown. Polling does not depend on odometry.

After 0.75 m of accumulated corrected robot travel since the capture used by the last successful
fix, ARModule requests another episode without waiting for a navigation goal to
finish. A marker-only client waits for the robot to enter its geometric capture
gate, and pauses a partial batch if it leaves that gate. Successful setup keeps
this runtime handler armed; it does not keep the camera running between episodes.

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
| `ts` | Producer odometry timestamp (`PoseStamped.ts`), seconds. Current Go2 WebRTC stamps producer receipt time in the synchronized host clock; this is not a hardware capture timestamp. |

X and Y carry the odometry scale correction; Z and orientation do not. Optional
fields may be added later (`speed_mps`, `yaw_rate_rad_s`); clients ignore unknown keys.

### `nav_goal`

Optional boolean `preview: true` identifies an advisory path returned only to the
requesting client. Omitted/false denotes active navigation. Store previews separately;
they never replace active goal facts or change `state.nav`. Empty previews omit `pose`
and use `path_poses: []` when the map/odometry is unavailable or planning fails.
Preview coordinates use the same odometry correction as active paths.

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
toward the robot, all in native sensor metres. Their world X/Y coordinates then
receive the same fixed correction as `pose` and `nav_goal`. Z is unchanged.
Use hello's optional scale factor to recover native horizontal distances for
obstacle coloring; no client-side coordinate scaling is required.

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

If neither a result nor a replacement batch request arrives before the client's
deadline, it asks for another episode. ARModule may withhold the prompt until a
provider cooldown expires and send `localization_observations_request` later, so clients back off
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

Response: `localization_result` after a successful episode, or another
`localization_observations_request` after a failed scan (subject to cooldowns).

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

Optional boolean `preview: true` requests planning only. Clients MUST send it only
when `hello.capabilities.navigation.nav_goal.preview === true`; older servers may
otherwise interpret the request as a motion goal. Omitted/false keeps normal behavior.
Preview computation runs off the WebSocket loop using raw odometry and the global
costmap, and never publishes motion, cancels navigation, or mutates `state.nav`.
Only the requester receives a `nav_goal` response with `preview: true`.

Clients keep at most one preview request outstanding, retain only the latest desired
aim, and discard replies whose captured aim or interaction generation is obsolete.
The optional finite `state.nav_preview_costmap_ts` is the latest global costmap timestamp;
a change invalidates an outstanding preview and schedules a refresh. It is independent
of `state.nav`. Preview requests use a 0.35 s minimum interval, 0.20 m movement gate,
and also refresh after material heading changes or a new costmap. Confirmation sends
a normal goal even if no preview path is available.

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

There is no mode enum on the wire. Off / obstacles / full are client presets of
the same four fields.

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


### Preview request correlation

A preview request may include `preview_id`, a non-empty string of at most 128
characters, only alongside `preview: true`. The server echoes it on every preview
response, including empty paths and responses while that client’s planner is busy.
New clients supply an identifier and accept only the current matching reply.
Preview replies use the bounded FIFO, independently of active `nav_goal` coalescing.
A client retires a request after five seconds, discards late replies, and queues its
latest aim under the normal throttle. A preview reply without an identifier disables
preview for that connection. Neither condition prevents normal goal confirmation.

### Optional server display metadata

`hello.server_info` is an optional object with optional string fields `robot_ip`,
`dimos_version`, and `armodule_version`. Versions describe installed packages in
ARModule's running process. The robot address comes from effective DimOS configuration;
replay/simulation is displayed as `Simulated`. Missing metadata means unavailable,
not disconnected. Older servers may omit the object; clients ignore unknown fields.
The page's server address remains distinct from the robot address.

## Localization qualification and coordinate correction

The VPS REST frame conversion and robot/headset composition use the normalized
right-handed Z-up VPS map frame. DimOS's optional premap frame is independent;
a transform named `world -> map` is not automatically a VPS registration. ARModule
no longer polls and relabels that transform as an odom/VPS anchor.

Robot odometry is indexed by producer time in the server clock domain. Go2 WebRTC
currently stamps odometry, decoded video, and voxel-map packets at receipt, so these
are **not hardware exposure timestamps**. Known Go2 replay streams instead use one
shared recorded-to-server epoch, bound once from the first odometry arrival; later
arrival delay never changes that offset. Live boot-time/unknown clocks are not
silently rebased. Robot VPS capture requires continuous
pose history spanning a provisional ±0.5-second uncertainty window, translation
speed ≤0.05 m/s, and angular speed ≤0.05 rad/s. Encoding runs off-loop after the
future bracket arrives. A robot image must be ≤2 seconds old at query admission;
normal HTTP latency does not reapply this image-age limit after the query.
AprilTag localization requires a robot pose within 0.25 seconds and does not
substitute the origin when odometry is missing.

VPS anchors retain capture-time robot travel and immutable transform snapshots.
Their initial limits are 1 metre of subsequent travel and 60 seconds of capture
age; both source generation and map identity must match. These checks run before
and after awaited queries. Composed confidence is the minimum of robot/headset
confidence, a conservative quality score rather than a calibrated probability.
`armodule.localization.episode_timeout_s` (default 12), `anchor_max_age_s` (60),
and `robot_timing_uncertainty_s` (0.5) are configurable, provisional engineering
limits. They do not certify physical calibration or bound undocumented camera
transport latency. A detected robot clock/frame reset retires pending work and
connections; AR navigation requires restarting DimOS mapping with a fresh map.

The 1.25 heuristic now consistently covers all outbound odometry-space points,
including LiDAR, with inverse conversion for native navigation and agent inputs.
This is a fixed AR coordinate mapping, not an upstream sensor/map migration. The
installed Go2 WebRTC source is `rt/utlidar/voxel_map_compressed`; individual scan
provenance is unavailable on this port. A proposed robot-relative packet shift
`point + (corrected_robot - raw_robot)` was rejected because its offset changes
with robot motion. The implemented mapping is instead `XY *= factor` about a
fixed origin for every packet, which preserves registration between packets.

A read-only check is available using the installed DimOS environment:

```sh
python tools/check_go2_registration.py /path/to/go2_short.db --factor 1.25 --output report.json
```

It returns exit code 2 when repeated geometry rejects the robot-relative packet
translation. Fixed XY scaling is measured separately in the report; neither
comparison qualifies absolute physical scale. On the existing
`go2_short.db` recording (461 frames), frames 31 and 38 are 0.918 m apart: 91.7% of
non-floor points overlap within 2 cm before translation and 0% afterward. This
rejects the time-varying translation, not the fixed scale heuristic. Applying
1.25 to both clouds about the fixed origin retains the same 91.7% overlap and
zero median registration residual for this pair. The tool opens the recording read-only and does
not publish goals, alter maps, or modify upstream DimOS.

Replacing the heuristic with a calibrated metric sensor migration requires either individually timestamped
scans plus their generating poses, or a validated registration strategy for the
vendor map. Use surveyed distances and repeated stationary obstacles across
translation/rotation. Rebuild accumulated maps and retire active goals, previews,
and client alignment together when changing the coordinate model; never mix old
and new map generations. Physical Quest camera calibration and VPS alignment
acceptance remain separate device tests documented in `clients/webxr/CALIBRATION.md`.
