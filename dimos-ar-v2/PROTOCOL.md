# Protocol — dimos-ar-v2 WebSocket message schema

Cross-platform contract between `ARModule` and any AR client.

Keep this document, `dimos/ar/network/protocol.py`, and
`lens-studio/Assets/Scripts/ARBridge/Network/Protocol.ts` in sync.

## Changelog

### v1 — minimal world-frame protocol

Fresh protocol for the v2 rebuild. Not compatible with v19, and not compatible
with any earlier draft of this document.

- **Wire frame:** DimOS `world`, in DimOS's own right-handed Z-up axes. The
  ARModule performs **no axis conversion**. Each client converts on receipt,
  because a Spectacles client, a Quest client and a desktop viewer do not share
  one convention.
- **13 message types** — 7 outbound, 6 inbound.
- **No `robot_id` echo** on inbound messages. One ARModule process serves one
  robot, declared once in `hello`.
- **No registration session.** Alignment is a single `localize` → `localization`
  exchange, and `localization` may also arrive unsolicited.
- **Merged status.** `state` replaces `runtime_snapshot`, `bridge_status` and
  `nav_status`.
- **`time_sync` / `time`.** Application-level clock exchange for pairing
  `capture_ts` with the robot pose buffer. Server stamps are `server_recv_ts` and
  `server_send_ts`. WebSocket Ping/Pong (RFC 6455) remains for liveness only.

## Transport

- Plain WebSocket on port **8787**. The DimOS machine runs the server; AR devices
  connect as clients.
- JSON text frames for control and telemetry. Binary frames for `localize`
  (client → server) and `lidar` (server → client).
- Every JSON message is an object with a `type` field.
- **Text framing:** outbound JSON text frames end with a single newline (`\n`).
  Clients accumulate incoming text and split on `\n` to recover complete
  messages. Binary frames are not newline-delimited.
- All binary layouts are **little-endian**.

## Coordinate conventions

Every position and orientation on the wire is in the **`world`** frame, in
DimOS's axes:

| Axis | Direction |
|------|-----------|
| X | Forward |
| Y | Left |
| Z | Up |

Right-handed, Z-up, metres. This is the ROS convention that DimOS follows
throughout, and `world` is the string DimOS puts in `frame_id` on the messages
ARModule reads.

Poses are position `[x, y, z]` and orientation `[qx, qy, qz, qw]` — quaternion,
scalar-last.

### What `world` is

`world` is the robot's odometry frame. Its origin is wherever the robot was when
its odometry started, and it **drifts** — it is dead reckoning, not a survey. Two
consequences for clients:

- Content anchored in `world` slowly diverges from the physical room.
- ARModule issues corrections through `localization` (see below). A client
  should apply the newest one it has rather than assuming its first alignment
  holds forever.

A naming wart worth knowing: DimOS names the *stream* `odom` while the
`frame_id` *inside* those messages is `world`. This document uses `world`
throughout, matching the data.

### Axis conversion is the client's job

ARModule never remaps axes. A client with a different convention converts on
receipt and inverts the conversion on anything it sends.

Informative example, for a left-handed Y-up client such as Lens Studio (X right,
Y up, Z forward):

```text
x_client = -y_world
y_client =  z_world
z_client =  x_world
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
| `path` point X and Y | yes |
| `nav_goal` position X and Y (inverted on ingress) | yes |
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

- **Telemetry is broadcast.** Every client receives identical `pose`, `path`,
  `lidar` and `state`. Payloads are byte-identical, so there is no per-client
  view to reconcile.
- **Alignment is per connection.** `localization` is addressed to the connection
  that needs it, since each client has its own tracking origin.
- **Control is last-command-wins.** ARModule does not arbitrate. The most
  recent `nav_goal` or `stop` takes effect regardless of which client sent it.

`hello` assigns each connection a `client_id`, and `state.nav.goal.source`
reports which client issued the active goal, so a client can show "someone else
is driving" without ARModule needing a locking scheme.

## Handshake

On connect the server sends `hello`, then `state`.

```json
{
  "type": "hello",
  "client_id": "c3f1a9",
  "robot": {
    "display_name": "Unitree Go2",
    "body_bounds_m": [0.70, 0.50, 0.55],
    "footprint_m": [0.70, 0.50],
    "base_height_m": 0.33
  },
  "alignment": {
    "requires_robot_in_view": false
  },
  "capabilities": {
    "lidar": { "available": true, "reason": null },
    "navigation": { "available": true, "reason": null },
    "stop": { "available": true, "reason": null }
  }
}
```

| Field | Type | Notes |
|-------|------|-------|
| `client_id` | string | Server-assigned, unique per connection. Appears in `state.nav.goal.source`. |
| `robot.display_name` | string | For client UI. |
| `robot.body_bounds_m` | `[L, W, H]` | Axis-aligned envelope in `world` axes: length X, width Y, height Z. |
| `robot.footprint_m` | `[L, W]` | Ground footprint for nav UI. |
| `robot.base_height_m` | float | Height of the odometry pose origin above the ground, so a client can place a ground marker under a `pose`. |
| `alignment.requires_robot_in_view` | bool | `true` when the active provider needs the robot visible in the submitted frames. Drives client capture guidance. |
| `capabilities.*.available` | bool | Feature gate for client UI. |
| `capabilities.*.reason` | string \| null | Human-readable, non-null exactly when `available` is `false`. |

The active provider is not named. Which provider is configured is a deployment
fact, and a client that behaves differently per provider has a coupling it
should not have. `requires_robot_in_view` is the one behavioural difference a
client genuinely needs.

## Outbound messages (server → client)

### `hello`

Sent once per connection. See handshake above.

### `state`

Merged runtime snapshot. Sent on connect, in response to `get_state`, and
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
    "outcome": null,
    "goal": null
  },
  "alignment": {
    "stale": false
  }
}
```

**`server.connected_clients`:** live WebSocket connections to this process.

**`nav.state`:** `"idle"` | `"navigating"` | `"resolved"`

**`nav.outcome`:** non-null exactly when `nav.state` is `"resolved"`:
`"succeeded"` | `"failed"`

**`nav.goal`:** non-null exactly when `nav.state` is `"navigating"`:

```json
{
  "source": "c3f1a9",
  "position": [1.0, 2.0, 0.0],
  "orientation": [0.0, 0.0, 0.0, 1.0]
}
```

`source` is the `client_id` of the issuing client, or `"dimos"` for a goal
observed on a DimOS input stream — a web UI click, or anything else driving the
planner. Observed goals live inside `state` rather than in a message of their
own, so a reconnecting client and a live one see identical data.

**`alignment.stale`:** `true` when ARModule believes the client's alignment
has drifted and cannot fix it without help. This only ever becomes `true` under
a provider that needs the user to act, so a client should read it as "prompt the
user to look at the robot again". Providers that correct on their own leave it
`false` permanently.

### `localization`

The client's own pose in `world` — its tracking origin expressed in world
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
| `confidence` | 0.0–1.0. A client may submit a fresh `localize` when this is low. |
| `ts` | Server time when the fix was produced. |

Sent in response to `localize`, and also **unsolicited** whenever ARModule
learns that a previously delivered answer has moved — for example when a room
anchor is refreshed and every connection's pose changes without any new
observation. There is no flag distinguishing the two cases, because a client
should treat them identically: replace the transform it is using.

Unsolicited updates are rate-limited and deadbanded on ARModule, so small
jitter does not produce a stream of corrections. A client should still animate
toward a new transform rather than snapping to it, since a correction can be
large after a long drift.

Always in `world`, regardless of which frame the underlying provider works in.
When a provider answers in a scanned-map frame ARModule composes it into
`world` before sending, because only ARModule knows that relationship.

### `pose`

Robot pose in `world`, at high rate.

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
| `ts` | Server timestamp, seconds, floating point. |

X and Y carry the odometry scale correction; Z and orientation do not. Optional
fields may be added later (`speed_mps`, `yaw_rate_rad_s`); clients ignore unknown keys.

### `path`

Planned navigation path in `world`.

```json
{
  "type": "path",
  "points": [[0.0, 0.0, 0.0], [1.0, 1.0, 0.0]],
  "ts": 1710000000.123
}
```

Empty `points` clears the visualization — the goal was reached, cancelled, or no
plan exists. X and Y carry the scale correction, matching `pose`.

### `lidar` (binary)

| Offset | Size | Field |
|--------|------|-------|
| 0 | 4 | FourCC `0x4C444152` (`"LDAR"`) |
| 4 | 8 | `ts` float64, server timestamp |
| 12 | 4 | `point_count` uint32 |
| 16 | `point_count * 12` | Points: `[x, y, z]` float32 triplets in `world` |

Points are pre-filtered on ARModule: height band, range, and subsampling
toward the robot. They carry **no scale correction** — see the coordinate section
above for why, and for why they must not be reconciled against `pose`.

## Inbound messages (client → server)

Inbound messages do not carry `robot_id`.

### `localize` (binary)

Submits one or more camera observations and asks "where am I in `world`?".

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
| 4 | 8 | `capture_ts` float64, server clock at exposure |
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
ARModule undistorts to pinhole when a provider needs it (VPS always; AprilTag
handles fisheye corners internally via DimOS).

**Camera pose** is the **camera optical frame** (X right, Y down, Z along the
view direction) expressed in the caller's own tracking frame. That frame must be
right-handed, gravity-aligned Z-up and metric — the same convention as DimOS
`world`. A left-handed client (Spectacles) converts its camera pose on the way
in and converts `localization.pose` back on the way out.

**`capture_ts` is required and must be the exposure time in server clock**,
not the client's local clock and not the time the message was assembled. The
client obtains server time via `time_sync` / `time` before sending. A
localization round trip can take seconds, and ARModule pairs each observation
against where the robot was at capture. A send-time stamp or an unsynchronised
clock silently produces a fix that is wrong by however far the robot moved in
the interim.

Response: `localization`.

### `time_sync`

```json
{
  "type": "time_sync",
  "client_send_ts": 1234.567
}
```

Client sends its local send time. ARModule replies with `time` (stateless — no
per-connection offset is stored on ARModule).

### `time`

```json
{
  "type": "time",
  "client_send_ts": 1234.567,
  "server_recv_ts": 5678.901,
  "server_send_ts": 5678.905
}
```

The client records its receive time locally and computes offset from the four
timestamps (standard NTP-style exchange): echoed `client_send_ts`,
`server_recv_ts`, `server_send_ts`, and the client's own receive time. Keep the
sample with the smallest round-trip delay. Convert each observation's exposure
time to server time before encoding `capture_ts`.

### `nav_goal`

```json
{
  "type": "nav_goal",
  "position": [1.0, 2.0, 0.0],
  "orientation": [0.0, 0.0, 0.0, 1.0]
}
```

Goal in `world`. Send it in the same coordinates you receive `pose` in — the
ARModule inverts the scale correction on ingress, so a goal placed on top of the
robot's rendered position resolves to the robot's actual odometry position.

### `stop`

```json
{
  "type": "stop"
}
```

Halts motion immediately. **There is no payload and no latch to release.**

Stopping is an event, not a mode. A latch that only the client can clear is a
footgun: a client that stops and then disconnects would leave the robot
immobilised with no way back short of restarting ARModule. The resume path is
issuing a new `nav_goal`.

ARModule also stops the robot on its own when the last client disconnects, so
losing the headset cannot leave the robot walking.

### `set_lidar`

```json
{
  "type": "set_lidar",
  "enabled": true,
  "min_height_m": 0.1,
  "max_height_m": 1.5,
  "max_range_m": 5.0
}
```

| Field | Type | Notes |
|-------|------|-------|
| `enabled` | bool | Required. `false` stops `lidar` frames entirely. |
| `min_height_m` | float | Required. Lower bound of the height band, in `world` Z. |
| `max_height_m` | float | Required. Upper bound of the height band. |
| `max_range_m` | float | Required. Horizontal radius around the robot to keep. |

There is no mode enum. v19 offered `"off"`, `"full"` and `"obstacles"`, but
`"obstacles"` was not a mode — it was a preset of the same filter parameters the
other modes also accept. One boolean plus the parameters expresses all three
states without an enum whose values overlap.

All four fields are required on every `set_lidar`. A non-finite or inverted band
(`min_height_m` above `max_height_m`) is an error and is rejected, not silently
clamped.

`state.lidar` reflects the result, and because telemetry is broadcast, one client
changing the filter changes it for everyone.

### `get_state`

```json
{
  "type": "get_state"
}
```

Response: `state`.

## Message inventory

| Direction | Type | Format |
|-----------|------|--------|
| → client | `hello` | JSON |
| → client | `state` | JSON |
| → client | `localization` | JSON |
| → client | `time` | JSON |
| → client | `pose` | JSON |
| → client | `path` | JSON |
| → client | `lidar` | binary |
| → server | `localize` | binary |
| → server | `time_sync` | JSON |
| → server | `nav_goal` | JSON |
| → server | `stop` | JSON |
| → server | `set_lidar` | JSON |
| → server | `get_state` | JSON |

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
- `cancel_nav_goal`. Use `stop`.
- The `active` flag on `emergency_stop`, and the `"off"` / `"full"` /
  `"obstacles"` mode enum on `set_lidar_mode`.
- v19 `ping` and `pong`. Replaced by `time_sync` / `time` for clock offset;
  WebSocket Ping/Pong remains for liveness.
- Every scale field — `scale_confidence`, `scale_locked`, `scale_observable`.
  Scale is a fixed robot constant applied on ARModule and is not a client
  concern.
- Robot AprilTag profile. Tag IDs and sizes matter when printing a marker, which
  is a launcher concern, not something a running client needs.

The Lens client is not compatible with v1 and needs its protocol module
rewritten.
