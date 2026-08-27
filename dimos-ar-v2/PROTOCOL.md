# Protocol — dimos-ar-v2 WebSocket message schema

Cross-platform contract between `ARModule` and any AR client.

Keep this document, `dimos/ar/websocket/protocol.py`, and
`lens-studio/Assets/Scripts/ARBridge/Network/Protocol.ts` in sync.

## Changelog

### v1 — minimal alignment protocol

Fresh protocol for the v2 rebuild. Not compatible with v19, and not compatible
with any earlier draft of this document.

- **Wire frame:** **`odom`** — the robot's drifting leg-odometry frame, in
  DimOS's right-handed Z-up axes. ARModule performs **no axis conversion**. Each
  client converts on receipt, because a Spectacles client, a Quest client and a
  desktop viewer do not share one convention.
- **12 message types** — 6 outbound, 6 inbound.
- **No `robot_id` echo** on inbound messages. One ARModule process serves one
  robot, declared once in `hello`.
- **No registration session.** Alignment is a single `localization_request` →
  `localization` exchange, and `localization` may also arrive unsolicited.
- **Merged status.** `state` replaces `runtime_snapshot`, `bridge_status` and
  `nav_status`.
- **Clock sync in `hello`.** Client sends `hello_request` with `ts_client`;
  server replies with `hello` including echoed `ts_client` and paired `ts_server`
  (when the request arrived). ARModule stores the offset per connection and
  converts inbound `capture_ts` from client time to server time. WebSocket
  Ping/Pong (RFC 6455) remains for liveness only.
- **Request/result naming.** Client commands use `*_request`; server replies and
  telemetry use the bare noun (`state`, `nav_goal`, `localization`, …). `hello` is
  the handshake reply.

## Transport

- Plain WebSocket on port **8787**. The DimOS machine runs the server; AR devices
  connect as clients.
- JSON text frames for control and telemetry. Binary frames for
  `localization_request` (client → server) and `lidar` (server → client).
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

`odom` is the robot's odometry frame. Its origin is wherever the robot was when
its odometry started, and it **drifts** — it is dead reckoning, not a survey. Two
consequences for clients:

- Content anchored in `odom` slowly diverges from the physical room.
- ARModule issues corrections through `localization` (see below). A client
  should apply the newest one it has rather than assuming its first alignment
  holds forever.

DimOS Go2 drivers currently stamp this frame as `frame_id="world"` on incoming
messages; ARModule normalizes that to `odom` at the import boundary and uses
`odom` everywhere on the wire and in client-facing docs.

### Axis conversion is the client's job

ARModule never remaps axes. A client with a different convention converts on
receipt and inverts the conversion on anything it sends.

Informative example, for a left-handed Y-up client such as Lens Studio (X right,
Y up, Z forward):

```text
x_client = -y_odom
y_client =  z_odom
z_client =  x_odom
```

Orientation must be converted with the same basis change, which for a
handedness flip is easy to get subtly wrong. Treat
`lens-studio/Assets/Scripts/ARBridge/Network/Protocol.ts` and its unit tests as
the normative worked example rather than re-deriving it per platform.

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
| `lidar` points | no |

Height is excluded because slip costs horizontal travel, not altitude.
Orientation is excluded because heading error is not a linear factor and there
is nothing sound to scale. LiDAR is excluded because its points are metric range
measurements rather than dead-reckoned positions, and stretching them would
misreport the size of the room.

The practical consequence for a client: **`lidar` and `pose` are both correct but
are not perfectly mutually consistent**, and they diverge with distance from the
odometry origin. Do not derive one from the other, and do not use `pose` to
re-anchor the cloud. Each `localization` re-anchoring resets the divergence.

## Multiple clients

Any number of clients may connect at once.

- **Telemetry is broadcast.** Every client receives identical `pose`, `nav_goal`,
  `lidar` and `state`. Payloads are byte-identical, so there is no per-client
  view to reconcile.
- **Alignment is per connection.** `localization` is addressed to the connection
  that needs it, since each client has its own tracking origin.
- **Control is last-command-wins.** ARModule does not arbitrate. The most
  recent `nav_goal_request` or `estop_request` takes effect regardless of which client sent it.

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
    "navigation": { "available": true, "reason": null },
    "estop": { "available": true, "reason": null }
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
| `capabilities.*.available` | bool | Feature gate for client UI. |
| `capabilities.*.reason` | string \| null | Human-readable, non-null exactly when `available` is `false`. |

ARModule keeps `ts_server - ts_client` as the per-connection offset. The client
may use the same pair for its own UI timing; localization does not require the
client to know server time.

Which alignment provider is configured is a deployment fact. Capture guidance
(look at the robot vs the room) belongs in the Lens or launcher config for that
site — not in `hello`. The client submits `localization_request` the same way
either way; `state.alignment.stale` is the only alignment signal on the wire.

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
  "alignment": {
    "stale": false
  }
}
```

**`server.connected_clients`:** live WebSocket connections to this process.

**`nav.state`:** `"idle"` | `"following_path"` | `"resolved"`

ARModule derives this from DimOS `path` and `goal_reached`. DimOS also declares a
`recovery` phase on `navigation_state`, but that stream is never published (see
`PR.md`); it is not on the wire until it can actually be emitted.

**`nav.outcome`:** non-null exactly when `nav.state` is `"resolved"`:
`"succeeded"` | `"failed"`

Where the robot is going, use **`nav_goal`** (route + terminal pose) and **`pose`**
(robot). `state.nav` reflects any active navigation — `nav_goal_request`, MCP
`set_goal`, or any other DimOS goal source:

- **`following_path`** while a non-empty planner path is active
- **`resolved`** when `goal_reached` fires (success or failure)
- **`idle`** otherwise

ARModule does not record who started navigation.

**`alignment.stale`:** `true` when ARModule believes the client's alignment
has drifted and cannot fix it without help. This only ever becomes `true` under
a provider that needs the user to act, so a client should read it as "prompt the
user to look at the robot again". Providers that correct on their own leave it
`false` permanently.

### `localization`

The client's own pose in `odom` — its tracking origin expressed in odom
coordinates. Apply the newest one received.

```json
{
  "type": "localization",
  "position": [1.2, -0.4, 0.0],
  "orientation": [0.0, 0.0, 0.38, 0.92],
  "confidence": 0.87,
  "ts": 1710000000.123
}
```

| Field | Notes |
|-------|-------|
| `confidence` | 0.0–1.0. A client may submit a fresh `localization_request` when this is low. |
| `ts` | `ts_server` when the fix was produced. Wire key stays `ts`. |

Sent in response to `localization_request`, and also **unsolicited** whenever ARModule
learns that a previously delivered answer has moved — for example when a room
anchor is refreshed and every connection's pose changes without any new
observation. There is no flag distinguishing the two cases, because a client
should treat them identically: replace the transform it is using.

Unsolicited updates are rate-limited and deadbanded on ARModule, so small
jitter does not produce a stream of corrections. A client should still animate
toward a new transform rather than snapping to it, since a correction can be
large after a long drift.

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

### `localization_request` (binary)

Submits one or more camera observations and asks "where am I in `odom`?".

Multiple observations in one request let a provider fuse viewpoints, which
matters when a single frame is ambiguous. A client may send one.

Header:

| Offset | Size | Field |
|--------|------|-------|
| 0 | 4 | FourCC `0x4C4F4341` (`"LOCA"`) |
| 4 | 2 | `observation_count` uint16, at least 1 |

Then `observation_count` records, each:

| Offset | Size | Field |
|--------|------|-------|
| 0 | 4 | `record_len` uint32, byte count after this field |
| 4 | 8 | `capture_ts` float64, `ts_client` at exposure |
| 12 | 4 | `jpeg_len` uint32 |
| 16 | 4 | `intrinsics_len` uint32 |
| 20 | 12 | Camera position, float32 × 3 |
| 32 | 16 | Camera orientation, float32 × 4, scalar-last |
| 48 | `jpeg_len` | JPEG bytes |
| 48 + `jpeg_len` | `intrinsics_len` | Intrinsics, JSON UTF-8 |

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
`odom`. A left-handed client (Spectacles) converts its camera pose on the way
in and converts `localization.pose` back on the way out.

**`capture_ts` is required and must be the exposure time in `ts_client`**,
not the time the message was assembled. ARModule converts it to `ts_server`
using the per-connection offset from `hello` before pose lookup. A localization
round trip can take seconds; pairing uses shutter time, not send time.

Response: `localization`.

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

## Message inventory

| Client → server | Server → client |
|-----------------|-----------------|
| `hello_request` | `hello` |
| `state_request` | `state` |
| `localization_request` (binary) | `localization` |
| `nav_goal_request` | `nav_goal` |
| `estop_request` | `pose` |
| `lidar_settings_request` | `lidar` (binary) |

Paired requests: `hello_request` → `hello`, `state_request` → `state`,
`localization_request` → `localization`, `nav_goal_request` → `nav_goal` (via
DimOS planner). `estop_request` and `lidar_settings_request` take effect through
a broadcast `state` update. `pose` and `lidar` are unsolicited telemetry.

## Dropped from v19

Not carried into v1:

- Registration session messages — `registration_command`, `registration_status`,
  `registration_pose`, `capture_policy`, `camera_frame_ack`. Alignment is one
  request and one answer.
- `world_frame_correction`. An unsolicited `localization` says the same thing.
- Separate `runtime_snapshot`, `bridge_status` and `nav_status`, merged into
  `state`.
- Agent messages — `user_command`, `agent_response`, `ar_skill` and the rest.
- Joystick and teleop.
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

The Lens client is not compatible with v1 and needs its protocol module
rewritten.
