# Protocol — ARModule WebSocket message schema

Cross-platform contract between `ARModule` and any AR client.

Keep this document and `dimos/ar/websocket/protocol.py` in sync. Implementing
clients update their protocol module in the same change.

## Conventions

- **Version 2 interaction messages** supplement the robot telemetry and localization inventory below.
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
  `estop`, `agent`, `manipulation`, and `object_detection` are required.
  Any key may be `available=false` with `reason`. Nested
  `navigation.nav_goal` and `navigation.nav_joystick` are always present.

## Protocol v2 control and bulk lanes

The control WebSocket carries authority, small command results, target samples,
mode, operation status, and references to immutable presentation assets. Hello
includes `protocol_version:2`, `bulk_url`, `bulk_token`, and `bulk_epoch`. The same
client opens the advertised bulk path with the matching hello credentials; see
the complete [handshake example](#hello-server--client).

The bulk connection has no independent robot authority. It is bound to the live
control session and acknowledged with `bulk_hello`. Images, LiDAR, model topology,
checked trajectories, and route points use that lane. A control record is at most
16 KiB; a batch is at most 64 KiB and 32 commands. Critical commands are never silently
dropped; control overload retires the connection and its authority.

Examples below show assembled model/plan/route domain values where useful;
actual v2 control frames carry references in place of those arrays.

Control `model_ref`, `plan_ref`, and `route_ref` values contain `{epoch,id,revision}`.
A complete revision is reconstructed from ordered `bulk_record` values with the
same reference, `kind` (`model`, `trajectory`, `route`), zero-based `part`, total
`parts`, and typed `data`. Records are at most 16 KiB in UTF-8. Model data contains
optional `metadata`, `links`, and `joints`; trajectory/route data contains optional
`metadata` and `points`. ClientCore assembles these into the existing domain view;
an incomplete or retired asset cannot authorize execution. Native arm snapshots
also send compact revision metadata internally; model/plan assets are fetched
only on revision change. A timed-out native snapshot, asset fetch, or command
retains its actual admission slot until the native callback completes. Retries
cannot accumulate blocked native work. Stop and control-plane heartbeat have
independent lanes. Replaceable camera/costmap/LiDAR work does not queue one native
CPU job per input frame.

Localization binary uploads use a declared bounded bulk upload and incremental
binary records; their existing observation payload is preserved. The bulk lane
uses byte budgets and latest-value replacement, so a stalled image or large model
does not sit ahead of Stop, lease renewals, or small authoritative snapshots on
the control TCP connection. This is not a guarantee against operating-system or
hardware failure; physical Emergency Stop remains necessary.

The default aggregate 1 MiB/s token bucket and fair shares apply only to outgoing
model/trajectory/route assets and LiDAR downloads. Incoming localization pixels
do not wait on this optional-data budget: each client still has one upload of at
most 4 MiB, each ARB2 record remains at most 16 KiB, and the server yields after
every chunk so controls can run. Client upload pumping is bounded to 16 chunks
per display tick, a 256 KiB socket high-water mark, and the same 2 ms work budget.
Admitted JPEG chunks are pumped before optional asset-record parsing consumes
that display tick's work budget.
Existing image-age checks, localization timeouts, and pose acceptance rules are
unchanged; transport must not deliberately make a fresh image stale.

## Transport

- Plain WebSocket on port **8787**. The DimOS machine runs the server; AR devices
  connect as clients.
- JSON text frames for control and telemetry. Binary frames for
  `localization_observations` (client → server) and `lidar` (server → client).
- Every JSON message is an object with a `type` field.
- **Text framing:** outbound JSON text frames end with a single newline (`\n`).
  Clients accumulate incoming text and split on `\n` to recover complete
  messages. Binary frames are not newline-delimited.
- All binary layouts are **little-endian**. Localization frame and record lengths must
  match their complete payloads; reserved words are zero.
- Numeric fields require finite JSON numbers, never booleans or numeric strings.
  Pose quaternions must be nonzero, including binary camera poses. Camera focal
  lengths and integer image dimensions are positive; distortion coefficients are
  finite, and the `none` distortion model has an empty coefficient array.

## Coordinate conventions

Robot poses, navigation, LiDAR, and top-level localization results use **`odom`**.
Explicit map-alignment metadata uses the named MultiSet map frame. Both use
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
the image timestamp; Go2 receipt timestamps are an exposure-time approximation. Robot-side VPS also needs an onboard camera extrinsic
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
ranges are 25% longer. The required `hello.robot.odom_scale_correction_factor` lets portable sensor policies undo the mapping for native
range/clearance calculations. Physical calibration still requires a survey, and
repeated marker/VPS localization handles alignment drift that one constant cannot.
Changing the factor requires restarting ARModule and reconnecting clients so
origins, paths, previews and points cannot mix old/new coordinate models.

## Multiple clients and replication

The collaboration protocol is version **2**, advertised as `hello.protocol_version`.
ARModule owns the robot's shared targets, authority, manual/agent mode, accepted
preview and active goal. Headset tracking origins, input capture and interpolation
remain local. The supported validation target is two to five simultaneous clients.

`interaction_state` is a complete revisioned snapshot. It contains `epoch` (robot
interaction reference), `revision`, `mode`, `motion_busy`, `authority`, `target` (last edited
canonical target), `targets` (retained navigation and per-group manipulation targets),
`preview`, and `active_goal`. Poses use odometry metres and XYZW quaternions.
Targets contain `domain`, optional `group_id`, `position`, `orientation`, `revision`,
`phase` (`draft`, `live`, `committed`), `sample_ts`, `sequence`, `speed_scale` and
optional `gripper`. `sample_ts` is a server monotonic interpolation sample time,
not a headset clock or exposure timestamp. Apply each headset's current origin
when rendering canonical odometry poses. A target's `sequence` cumulatively
acknowledges accepted input within its editing lease, including identical pose and
settings updates. Identical content advances `sequence` without changing the
content `revision` or interpolation `sample_ts`. Revision covers the complete draft:
pose, speed and gripper. Clients retain predicted settings while a release settles
and must compare the complete effective draft before adopting or executing a plan.

Authority is robot-wide: `client_id`, `source_id`, `acquisition_id`, `lease_id`,
`kind`, `held`, `expires_at`, `sequence`, and optional `group_id`. Kinds are `live`,
`navigation_planning`, `joystick`, `manipulation_planning`, and
`manipulation_following`. A lease lasts 500 ms; its client renews at 100 ms.
Only the owning connection can edit or command while a lease is present.
Hosts tint remotely owned markers warning yellow, retain their pose/heading
indicators, exclude them from grabs, and retain Emergency Stop.

### Interaction commands

`interaction_request` contains a nonempty `request_id` and `action`:

| Action | Additional fields | Effect |
|---|---|---|
| `snapshot` | None | Return current state. |
| `acquire` | `epoch`, `kind`, `source_id`, `acquisition_id`; optional pose and `group_id` | First accepted acquisition owns the robot. |
| `renew` | `epoch`, `lease_id` | Extend the current lease. |
| `update` | `epoch`, `lease_id`, increasing `sequence`, pose; optional speed/gripper | Accept an exact intended target. |
| `release` | Same credentials, increasing sequence and final pose | Atomically retain final pose and release live authority; live navigation submits its final goal. |
| `confirm` | Same credentials, increasing sequence and frozen final pose | Commit selected navigation and release planning authority. |
| `cancel` | `epoch`, `lease_id` | Retire this interaction without confirming its draft. |
| `cancel_acquire` | `epoch`, `acquisition_id` | Cancel pending acquisition; a late grant cannot restore it. |
| `mode` | `epoch`, `mode` (`manual` or `agent`) | Change shared robot mode only while no interaction/agent turn owns it. |

Before navigation commands, acquire a matching interaction kind. For example,
use `live` for a direct navigation goal (`navigation_planning` for selected preview,
`joystick` for direct drive). The epoch comes from `interaction_state`:

```json
{
  "type": "interaction_request",
  "request_id": "acquire-1",
  "action": "acquire",
  "epoch": "interaction-example",
  "kind": "live",
  "source_id": "right-hand",
  "acquisition_id": "grab-1",
  "position": [1.0, 2.0, 0.0],
  "orientation": [0.0, 0.0, 0.0, 1.0]
}
```

A successful grant has this shape (its actual identity and revision come from the server):

```json
{
  "type": "interaction_result",
  "request_id": "acquire-1",
  "epoch": "interaction-example",
  "revision": 2,
  "status": "accepted",
  "code": "acquired",
  "lease_id": "lease-from-grant"
}
```

Wait for an accepted `interaction_result`, take its `lease_id`, and renew every
100 ms while the lease is held. The navigation examples below use that granted
lease and increasing sequences; placeholders must be replaced with actual grant
values. A joystick example needs its own `joystick` acquisition. Stop needs no lease.

Selected navigation is a two-gesture planning session. **Its first release keeps
the planning lease** (with `held: false`) until confirmation, cancellation,
deselection, tracking loss, disconnect or expiry. Only that client requests an
advisory path; every client sees the accepted shared draft and preview. An
advisory navigation preview survives target jitter below 0.2 m and 15 degrees of
yaw relative to the canonical aim captured for that preview (the native safe-goal
endpoint can be offset from that aim). A worker result from an earlier target
revision may be accepted only within those bounds and the same live epoch and
planning lease. Larger changes invalidate the route; handover or reference reset
always rejects the old result. Arm checked plans retain exact revision matching.
Planning
does not overwrite a previously executing goal/route. Selected arm planning
releases editing authority when the hand opens; checked plans bind to the shared
target revision rather than remaining owned by their creating client.

### Motion ownership and completion

| Phase | Owner and completion | Release, takeover and disconnect |
|---|---|---|
| Held following | Editing client owns its renewed lease; server forwards validated canonical targets to native following. | Input loss retires owned control, subject to bounded connection recovery. |
| Selected draft / checked plan | ARModule owns canonical target revisions and reviewed plan IDs. Preview/FK is advisory. | Editing release frees authority; unchanged checked plans remain robot-owned. |
| Released following tail | Server retains the last validated pose/joint endpoint; `following_tail` reports `generation`, `group_id`, `target_revision`, `status:"finishing"` and optional pose/speed/joints. | Any new grab supersedes the generation. Former-owner disconnect cannot cancel it or its successor; last-client loss stops motion. |
| Accepted Execute / reset / parking | Native operation owns motion; `operation_id` identifies the authoritative terminal outcome. | These operations are not takeoverable. Editing release or one client's disconnect does not cancel them; Stop, faults and control-plane expiry remain effective. |

Normal live arm release sends only `interaction_request.release`; clients stop
native updates immediately and ARModule frees the editing lease. The detached
tail refreshes its cached validated target at 10 Hz for at most 55 seconds.
Arrival requires distinct fresh measurements spanning 0.5 seconds, TCP error at
most 10 mm / 3 degrees and joint speed below 0.05 rad/s. Without TCP feedback,
configured joint tolerance is the fallback. Two seconds without progress outside
arrival tolerance fails after confirmed native clearing. Stale feedback, IK
failure, Stop, reference reset or control-plane expiry aborts the tail.
New admission fences delayed old release and cleanup messages.

ARModule renews a native per-robot control-plane lease at 10 Hz with a 500 ms
monotonic deadline. Native arm following, tails, and accepted operations stop when
that lease expires, even if ARModule crashes. Repository-owned native navigation
similarly gates AR-admitted base motion on its control-plane lease and rejects
stale planning activation. These protections do not claim cancellation of every
upstream native agent continuation or recovery from a hung physical controller.

Every command receives `interaction_result` with `request_id`, `epoch`, `revision`,
`status` (`accepted`, `busy`, `stale`, `rejected`), `code`, and optional `lease_id`.
Request deduplication is bounded per connection. Ordinary target snapshots may
coalesce; critical command results cannot be silently dropped on queue overflow.

Navigation and joystick requests carry `epoch`, `lease_id`, and `sequence`.
Preview work requires the selected planning owner. Bare legacy motion packets
never reach native ports. The server validates authority separately from clients'
optimistic prediction. Owner input renders immediately; accepted target updates
replicate at up to 20 Hz independently from robot command throttling. Remote
interpolation never changes authoritative target poses or native commands.

Localization requests/results remain per connection. Shared robot telemetry and
accepted targets are broadcast. Agent context uses the sender of the active robot
turn, not the most recent headset pose. Shared AR markers are replayed to late joiners.

### Connection identity and recovery

A fresh connection receives a new identity and current shared state. Hello always
returns a `resume_token`; send it only to the same backend when reconnecting.
For strictly less than one second after socket loss, a valid token can recover
the same logical client. Expiry, server restart, invalid tokens or a tracking
reference change require fresh admission; old editing leases cannot be reused
outside that bounded window. Bulk pairing always receives fresh credentials.
Explicit Stop, stale native feedback and hardware faults bypass recovery.
Recovery may continue only the last validated native target; missing input and
discrete motion commands are never replayed. It never clears motor Stop.
A held gesture may reacquire a retired native token only while its shared lease
remains current. Observer loss cannot stop another client's interaction;
last-client loss retains stop handling. No feature-negotiation flags are required.

## Handshake

On connect the client sends `hello_request`, then the server sends `hello` and
`state`.

The handshake must complete within five seconds. Invalid or timed-out handshakes
close with code `1008`. A connection becomes active only after `hello` is sent;
it receives no telemetry before that point and does not count toward connected
clients or last-client disconnect handling.

### `hello_request` (client → server, first text frame)

```json
{
  "type": "hello_request",
  "protocol_version": 2,
  "ts_client": 1234.567
}
```

| Field | Type | Notes |
|-------|------|-------|
| `protocol_version` | integer | Required, exactly `2`; clients and server update together. |
| `ts_client` | float | Client local time when the frame was sent (`ts_client`). |
| `resume_token` | string | Optional 64-character token from this backend for bounded recovery; omit for a fresh connection. |

The client must send exactly one JSON object in the first text frame. ARModule
records `ts_server` on receipt, stores the client/server offset for this
connection, and replies with `hello`.

### `hello` (server → client)

```json
{
  "type": "hello",
  "protocol_version": 2,
  "client_id": "c3f1a9",
  "bulk_url": "/bulk",
  "bulk_token": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "bulk_epoch": "bulk-example",
  "resume_token": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "odom_reference_id": "odom-example",
  "time_sync": {
    "ts_client": 1234.567,
    "ts_server": 5678.901
  },
  "robot": {
    "display_name": "Unitree Go2",
    "body_bounds_m": [0.70, 0.50, 0.55],
    "footprint_m": [0.70, 0.50],
    "base_height_m": 0.33,
    "odom_scale_correction_factor": 1.25
  },
  "localization": { "providers": ["fiducial_marker", "vps"] },
  "capabilities": {
    "lidar": { "available": true, "reason": null },
    "navigation": {
      "available": true,
      "reason": null,
      "nav_goal": { "available": true, "reason": null, "preview": false },
      "nav_joystick": { "available": true, "reason": null }
    },
    "localization": { "available": true, "reason": null },
    "estop": { "available": true, "reason": null },
    "agent": { "available": false, "reason": "current blueprint has no DimOS agent" },
    "manipulation": { "available": false, "reason": "No arm" },
    "object_detection": { "available": false, "reason": "No detector" }
  }
}
```

| Field | Type | Notes |
|-------|------|-------|
| `protocol_version` | integer | Required collaboration protocol version; current value is `2`. |
| `client_id` | string | Server-assigned logical client identity; see connection recovery. |
| `bulk_url`, `bulk_token`, `bulk_epoch` | string | Required paired-bulk route, session credential and asset epoch. |
| `resume_token` | string | Required opaque token for bounded recovery to this backend. |
| `odom_reference_id` | string | Required identity of the current server odometry reference. |
| `time_sync.ts_client` | float | Echo of `hello_request.ts_client`. |
| `time_sync.ts_server` | float | Server time when `hello_request` arrived. |
| `robot.display_name` | string | For client UI. |
| `robot.body_bounds_m` | `[L, W, H]` | Axis-aligned envelope in `odom` axes: length X, width Y, height Z. |
| `robot.footprint_m` | `[L, W]` | Ground footprint for nav UI. |
| `robot.base_height_m` | float | Height of the odometry pose origin above the ground, so a client can place a ground marker under a `pose`. |
| `robot.odom_scale_correction_factor` | float | Required finite positive native-to-AR XY heuristic. Points/poses are already corrected; use it only to recover native distances. |
| `capabilities.*.available` | bool | Feature gate for client UI. Keys are `lidar`, `navigation`, `localization`, `estop`, `agent`, `manipulation`, and `object_detection`; every key is required. |
| `capabilities.*.reason` | string \| null | Human-readable, non-null exactly when `available` is `false`. |
| `capabilities.navigation.nav_goal` | `{ available, reason, preview }` | Can send `nav_goal_request`. All fields are required; boolean `preview` advertises advisory planning. |
| `capabilities.navigation.nav_joystick` | `{ available, reason }` | Can send `nav_joystick_request`. Always present. |
| `localization.providers` | `("fiducial_marker" \| "vps")[]` | Required metadata with provider inventory in canonical order: fiducial marker, then VPS. An explicit empty array means unavailable; missing metadata is invalid. |

`navigation.available` is true when any nested input is available. Clients that
need a specific input check that nested key; Specs point-and-click checks
`nav_goal`. `capabilities.manipulation.available` is true only when the
native manipulation Spec is connected; an unavailable capability still has its key
and reason. Missing capability keys invalidate hello.
Go2 deployments do not load arm runtime dependencies.

For this hello, open the advertised bulk route and send its matching credentials:

```json
{
  "type": "bulk_hello_request",
  "protocol_version": 2,
  "client_id": "c3f1a9",
  "token": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

The bulk server acknowledges the same asset epoch:

```json
{"type":"bulk_hello","protocol_version":2,"epoch":"bulk-example"}
```

Then use the latest `interaction_state.epoch` to acquire authority as shown above;
hello and bulk pairing alone grant no editing lease. Tokens here are illustrative.

ARModule keeps `ts_server - ts_client` as the per-connection offset. The client
may use the same pair for its own UI timing; localization does not require the
client to know server time.

ARModule advertises its configured localization inventory as
`hello.localization.providers`. Clients use this inventory for provider labels
(`Fiducial marker` and `VPS`), rather than inferring a provider from transient
capture geometry. Matching v2 peers require this metadata; an explicit empty array means no provider
is configured. Capture policy describes geometry, not provider identity.
`hello.capabilities.localization.available` is `false` (with `reason`) when no
provider is configured. `lidar`, `navigation`, and `estop` may also be
`available=false` with `reason` when the selected robot profile does not offer
them. `agent` is `available=false` with `reason` when the current blueprint
did not configure a DimOS agent. Capture geometry remains a `capture_policy` on
each `localization_observations_request`; it does not identify the provider inventory.

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

**`server.connected_clients`:** live WebSocket connections with a completed hello
handshake to this process.

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
same message (subject to retry backoff and the shared VPS query budget). Clients resume capture immediately;
the result timeout is only a fallback for a missing response.

```json
{
  "type": "localization_observations_request",
  "capture_id": "server-generated-generation",
  "capture_policy": "robot_los_required",
  "observation_count": 3,
  "result_timeout_s": 15
}
```

| Field | Type | Notes |
|-------|------|-------|
| `capture_id` | string | V2 server-generated capture generation, 1–128 characters. Echo in the matching `bulk_upload_begin`; it is scoped to this control connection. |
| `capture_policy` | string | `robot_los_required` \| `robot_los_preferred` \| `any_angle`. Geometric gate only — not a provider name. |
| `observation_count` | uint | Exact batch size. The client always sends this many frames. |
| `wait_timeout_s` | float | Required when `capture_policy` is `robot_los_preferred`. Omitted otherwise. |
| `result_timeout_s` | float | Required finite positive result deadline in seconds from batch submission. |

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
  "capture_id": "server-generated-generation",
  "capture_policy": "robot_los_preferred",
  "observation_count": 3,
  "result_timeout_s": 15,
  "wait_timeout_s": 3.0
}
```

The server assigns a fresh `capture_id` when each capture request is enqueued for
a particular control connection. The matching `bulk_upload_begin` must contain
that ID in addition to its upload ID and declared byte count. The server checks
the generation both before accepting the upload and after its final chunk, before
dispatching any observations. A new manual localization start invalidates the
previous generation before policy admission, so a delayed canceled upload cannot
attach to the replacement episode across the separate sockets. Reconnect creates
a new control identity; its previous capture IDs cannot be reused.

An upload begins on the bulk socket with
`{type:"bulk_upload_begin",kind:"localization",upload_id,total_bytes,capture_id}`.
A client can stop that upload with `{type:"bulk_upload_cancel",upload_id}`; the
server replies `bulk_upload_result` with that upload ID and `status:"cancelled"`.
Cancellation of an old upload ID cannot cancel a replacement upload. The same
capture generation may be reused for a replacement batch within the same prompt;
a new prompt, manual start, or disconnect invalidates it.

This envelope correlation changes neither LOCA bytes nor camera-pose acceptance,
frame spacing, nearest-pose fallback, capture geometry, or result timeouts. The
Python request type permits an omitted ID for internal construction; the v2
transport supplies one on every delivered capture request.

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
Matching v2 servers must advertise `result_timeout_s`; clients reject its omission.

ARModule admits at most one episode per client and one global VPS workflow.
Localization never occupies a client's WebSocket read loop. The default server
budget is 12 seconds from admission, including CPU/HTTP queueing, authentication,
token refresh, and robot/headset queries; the advertised client timeout is the
configured budget plus 3 seconds. Cancellation retires delivery and aborts HTTP.
A miss or exception schedules a new capture after backoff/query admission;
images are never held through an admission wait. Polling does not depend on odometry.

With VPS enabled, robot correction and headset alignment are independent. Robot
correction becomes due after 0.75 m accumulated corrected robot travel or 30° net
heading change. Headset map alignment refreshes after 10 m accumulated horizontal
headset travel, without a rotation trigger. Defaults are configurable in the launcher.
Capture-time baselines preserve movement during processing. Failed attempts do not
reset those baselines. Fiducial-only mode retains relative odometry alignment and
its geometric capture gate.

### Independent map localization

VPS deployments send `localization_context` after hello:

```json
{"type":"localization_context","map_code":"<map>","odom_reference_id":"<reference>"}
```

This binds retained headset alignment to the current map and robot reference.
An optional `reset: true` invalidates a retained alignment that the server cannot
resume. Clients report tracking only after receiving this context; agent capability
is not required. There is no standing camera policy or additional camera-info message.

`localization_tracking` (client → server) contains `tracking_reference_id` (nonempty,
at most 128 characters), finite nonnegative cumulative `travel_m`, boolean `active`,
and optional `alignment_id` identifying a previously accepted headset map fix.
Send once per second while active and immediately on activation, reference changes,
and accepted fixes. Travel is measured at 10 Hz in native headset tracking coordinates,
with a 5 cm displacement deadband. Visibility loss or a sampling gap over 0.5 seconds
starts a new travel segment without bridging the gap. A tracking-reference reset
starts a new identity and counter. Plain socket reconnect preserves them.
The server resumes only an issued fix matching map, robot reference, tracking
reference, and a nondecreasing travel counter. Issued-fix storage retains active
alignments and a bounded pool for reconnects.

Map-mode capture requests add `episode_id` (opaque identity) and `purpose`:
`headset` requests one `any_angle` frame; `robot` requests a three-frame
`robot_los_preferred` tag batch with `wait_timeout_s` (default 3 seconds).
For robot correction, expiry of this gate wait ends headset capture and falls
back to the robot camera; it does not send headset pixels to VPS. An immediately
visible tag is still attempted with zero preference duration. Once capture has
started, its normal bounded collection/processing deadline replaces the gate wait.
Losing the gate discards a partial tag batch and returns to the bounded wait.
The preference deadline belongs to the whole episode; losing LOS or repeating
waiting progress does not renew it. Explicit mixed-mode re-localization uses the
same gate as automatic correction.

Without an accepted alignment, setup tries VPS first. A failed robot or headset
VPS attempt, unavailable runtime robot-camera data, or cloud admission wait allows
a three-frame tag fallback even without an existing map anchor. That tag result is
an ordinary `localization_result` in odometry, without `map_alignment` or
`map_transform`; it must not be represented as a VPS registration. With no client
origin the geometric gate cannot be computed, so the fallback captures directly.
Accepted relative tag alignment retains capture-time headset/robot travel and
heading baselines for subsequent tag-first correction. Failed corrections preserve
the accepted origin. A later successful VPS workflow can supply an independent map
alignment. Tracking-reference or robot-source changes retire the relative baseline.
VPS configuration still requires its map code and robot-camera extrinsic at startup;
this fallback does not make missing configured `T_base_camera_optical` valid.

`localization_capture_progress` (client → server) contains `episode_id`, `phase`
(`waiting`, `capturing`, `submitted`, or `unavailable`), and nonnegative `travel_m`.
`submitted` also requires `capture_ts`: the newest batch timestamp in client time.
Send this JSON context immediately before the existing LOCA binary batch. The
server correlates its converted timestamp to the batch within one microsecond;
stale or superseded episode progress is ignored. The binary layout is unchanged.

A successful VPS headset map-alignment `localization_result` keeps its existing
top-level odometry pose and timestamp, and includes both `map_alignment` and
`map_transform`. The relative tag fallback described above omits both map fields.
`map_alignment` contains `id`, `map_code`, `odom_reference_id`,
`tracking_reference_id`, capture-time `travel_m`, `position`, `orientation`,
`confidence`, and server-clock `ts`. Its pose is `T_map_client`.
`map_transform` is a complete `localization_map_transform` snapshot:
`map_code`, `odom_reference_id`, nonnegative integer `revision`, `position`,
`orientation`, `confidence`, and server-clock capture `ts`. Its pose is `T_odom_map`.

ClientCore adopts `T_map_client` only after the existing outstanding-submission
and result-deadline checks accept the result. It composes:

```text
T_odom_client = T_odom_map × T_map_client
```

New robot corrections broadcast `localization_map_transform` independently of
headset capture. Ignore mismatched contexts and older/equal revisions. Use the
newest valid robot transform when accepting a headset fix. A transform update
cannot activate an unaccepted, cancelled, or timed-out headset fix. Recomposition
updates the existing origin owner and all odometry-space renderers/conversions;
it does not alter the native planner or resubmit confirmed navigation goals.

A tag correction uses an active, map-aligned headset below its own refresh
threshold: `T_odom_map = T_odom_client_from_tag × inverse(T_map_client)`.
Existing fiducial detection/fusion quality gates apply. The same observation never
updates both independent alignments.

`localization_status` contains `map_code`, `odom_reference_id`, `scope` (`robot` or
`headset`), `status` (`succeeded`, `failed`, `deferred`), and `reason`.
Capture-related status includes `episode_id` and, after submission, its server-clock
capture `ts`; optional nonnegative `retry_after_s` describes an admission wait.
Clients ignore stale capture status and retire matching submission deadlines.
Robot-only status can arrive without a capture identity. Failure displays the
2.5-second yellow triangle/`!` notification “Tracking Inaccurate”; corresponding
success clears it. Gate waiting and query deferral do not warn. Emergency-stop
feedback takes priority.

Every robot/headset camera-query HTTP POST shares a limit of three dispatches per
rolling 30 seconds. Authentication is excluded; a repeated query after token refresh
counts again. Reserve at dispatch after local frame validation; dispatched failures
and cancellation consume admission. One cloud task runs at a time, with fair turns
between shared robot work and headset captures. A collecting headset owns its next
cloud turn. Failed attempts retry after two seconds, subject to admission, without
a retry-count ceiling. Images are recaptured after waits; tags remain available
while cloud queries are rate-limited.

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

### Navigation routes in `interaction_state`

Nested boolean `preview: true` identifies an advisory path in the shared
interaction snapshot. Omitted/false denotes active navigation. Store previews separately;
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
Use hello's required scale factor to recover native horizontal distances for
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
query budget permits and send `localization_observations_request` later, so clients back off
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
`localization_observations_request` after a failed scan (subject to query admission).

### `nav_goal_request`

```json
{
  "type": "nav_goal_request",
  "epoch": "interaction-example",
  "lease_id": "lease-from-grant",
  "sequence": 1,
  "position": [1.0, 2.0, 0.0],
  "orientation": [0.0, 0.0, 0.0, 1.0]
}
```

Goal in `odom`. **`position` and `orientation` are both required** — same fields
as `pose`. Send them in the same coordinates you receive `pose` in; ARModule
inverts the scale correction on ingress and submits through the native navigation
RPC admission service, retaining the current authority epoch and revision.

Gated on `hello.capabilities.navigation.nav_goal`.

Optional boolean `preview: true` requests planning only. Clients MUST send it only
when `hello.capabilities.navigation.nav_goal.preview === true`. Omitted/false
keeps normal behavior.
Preview computation runs off the WebSocket loop using raw odometry and the global
costmap, and never publishes motion, cancels navigation, or mutates `state.nav`.
Accepted previews are published in the revisioned `interaction_state.preview`.
Active routes use `interaction_state.active_goal`; neither emits a standalone message.

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
  "epoch": "interaction-example",
  "lease_id": "lease-from-grant",
  "sequence": 1,
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
release edge. `estop_request`, owner disconnect, interaction release, and lease expiry cancel a hold. Callers
that omit `duration` must keep sending if drive should continue
(`cmd_vel_timeout` is 0.2 s). Gated on `hello.capabilities.navigation.nav_joystick`.

With a hold:

```json
{
  "type": "nav_joystick_request",
  "epoch": "interaction-example",
  "lease_id": "lease-from-grant",
  "sequence": 1,
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

Emergency stop — halts motion immediately. There is no payload.

Mobile navigation has no stop latch to release; it resumes when a new authorized
`nav_goal_request` is issued. Manipulation retains a stopped latch and requires
the explicit Resume operation described below, after native stop confirmation
and with valid authority.

ARModule also stops the robot on its own when the last client disconnects, so
losing the headset cannot leave the robot walking.

The repository's Go2 blueprints use `ARReplanningAStarPlanner`, a subclass of
the installed native planner. Its private DimOS `ar_navigation_status` topic
captures the immutable submitted goal timestamp and accepted/succeeded/failed
phase under the native planner lock. ARModule ignores uncorrelated native Bool
terminal messages after an AR goal has been issued. A delayed old-goal terminal
therefore cannot clear a newer shared goal. Native stop also installs a timestamp
tombstone under that lock: a queued goal created before the stop cannot restart
motion, and a later explicit goal can resume it. This changes no WebSocket message.
The native planning algorithm still owns obstacle avoidance, arrival detection,
and cancellation: the adapter cannot guarantee that an upstream monitoring
thread never makes an incorrect decision from its own stale internal samples.
Hardware validation remains necessary for that backend behavior.

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

LiDAR settings belong to the requesting connection. `state.lidar` reflects that
connection's settings; changing presets or disabling LiDAR does not affect other
clients. ARModule downsamples a cloud once, groups identical subscriptions, and
sends each filtered binary payload only to its subscribing connections. A new
connection starts with LiDAR disabled.

### `manipulation_request` (optional)

Arm deployments expose `hello.capabilities.manipulation.available=true`.
Every request contains `request_id`, `action`, `group_id`, and the current
interaction `epoch`. Planning, execution, and gripper commands also contain the
canonical `target_revision`. Following commands carry the owning `lease_id`.

```json
{
  "type": "manipulation_request",
  "request_id": "plan-42",
  "action": "plan",
  "group_id": "arm",
  "epoch": "robot-interaction-reference",
  "target_revision": 12,
  "position": [0.4, 0.0, 0.3],
  "orientation": [0.0, 0.0, 0.0, 1.0],
  "speed_scale": 0.2,
  "final_gripper": 0.5
}
```

| Action | Additional fields | Behavior |
|---|---|---|
| `evaluate` | `position`, `orientation` | Nonmoving advisory feasibility for the owning client's local sample; see [independent advisory IK](#independent-advisory-ik-and-manual-failed-target-release). |
| `plan` | Pose, optional `speed_scale` and `final_gripper` | Return a checked plan bound to the canonical target revision. |
| `execute` | `plan_id` | Execute the still-current checked plan. |
| `acquire` | Owning following lease | Request the native following `token`. |
| `update` | `token`, increasing `sequence`, `ts`, pose, optional `speed_scale` | Refresh native following while the robot-wide lease remains valid. |
| `release` | `token` | Explicit native following cancellation. Ordinary hand release uses only `interaction_request.release` to start server finishing. |
| `gripper` | `value` | Apply the replicated target's gripper setting. |
| `cancel` | None | Cancel the current arm operation. |
| `resume` | None | Resume only after native stop confirmation and valid authority. |
| `reset_joints`, `prepare_shutdown` | Optional `speed_scale` | Native reset or parking; shutdown reports explicit `quiescent`. |

Poses are odometry metres and unit XYZW quaternions. Speed is in `(0,1]`;
gripper values are in `[0,1]`. Plan/following poses and speed, plan final
gripper, and discrete gripper values are taken from the matching server target;
client echoes cannot change the geometry labeled with that revision. A gripper
setting must first be accepted into the replicated target.

Nonmoving `evaluate` requests may use the owning client's latest local sample
without a per-sample canonical acknowledgement; see
[independent advisory IK](#independent-advisory-ik-and-manual-failed-target-release).
Full Plan and Execute still require the exact canonical target revision.

`manipulation_result` includes `request_id`, `action`, `group_id`, `status`, and
optional `code`/`message` plus action-specific fields. A `planned` result includes
`plan_id`, `target_revision`, `joint_names`, `trajectory` (time/positions), and
`duration`. The checked plan is robot-owned and replayed to late joiners. Editing
release preserves a plan for an unchanged target; changing target settings
retires it. Native execution remains robot-owned after editing release or client
disconnect.

`manipulation_state` is a compact native snapshot, normally sent at 10 Hz and
replayed on connection. Model and checked trajectory data travel by revision on
the bulk lane and are reconstructed by ClientCore. Available snapshots include the model descriptor,
`root_pose`, planning `groups`, measured group `observations`, `execution`,
`operation_id`, `plan`, `following`, `owner`, `stopped`, and `stop_confirmed`.
The optional `following_tail` summary is independent of editing ownership and
does not set `motion_busy`; a new grab supersedes it. An unavailable snapshot contains `available=false` and a message. Accepted,
executing, uncertain, or faulted native motion blocks new robot interaction and
mode changes through `interaction_state.motion_busy`. A transport failure after
a motion command is uncertain; only positive native stop confirmation clears
that uncertainty. Emergency Stop remains available to every client.

ARModule injects a private native RPC envelope with epoch, monotonic deadline,
authority revision, lease, and target revision. The native process rejects retired
or expired envelopes. Emergency Stop installs its revision tombstone atomically
with the native stop latch, preventing delayed old resume commands from undoing
it. These private fields are not client-controlled WebSocket authority.

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
| `interaction_request` | `interaction_state`, `interaction_result` |
| `manipulation_request` (optional) | `manipulation_state`, `manipulation_result` |
| `localization_start_request` | `localization_observations_request` |
| `localization_observations` (binary) | `localization_result` |
| `nav_goal_request` | `interaction_state` |
| `nav_joystick_request` | `pose` |
| `estop_request` | `lidar` (binary) |
| `lidar_settings_request` | `agent_message` |
| `user_message_request` | `agent_skill` |
| `client_pose` | `localization_context` |
| `localization_tracking` | `localization_map_transform` |
| `localization_capture_progress` | `localization_status` |

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
`localization_result` (on success), `nav_goal_request` → revisioned
`interaction_state` navigation facts (via DimOS planner). `nav_joystick_request` takes effect through DimOS
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
Navigation previews and routes use revisioned interaction snapshots and bulk references.
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
silently rebased. Moving robot capture requires an exact odometry timestamp match
or surrounding pose samples no more than 200 ms apart. Wait at most 200 ms for the
following sample, then reject missing brackets rather than extrapolating or using
the latest pose. Translation is interpolated linearly and orientation with
shortest-path SLERP. There is no stillness, linear-speed, or angular-speed gate.
Encoding runs off-loop. A robot image must be ≤2 seconds old at actual HTTP query
admission, including after authentication; normal HTTP latency does not reapply
this image-age limit after the query. Higher odometry cadence reduces interpolation
error but cannot remove unknown camera/odometry receipt-time skew.
Live AprilTag localization requires a robot pose within 0.25 seconds and does not
substitute the origin when odometry is missing. Offline replay explicitly permits
its final retained robot pose for captures newer than the complete history, so
marker registration can continue after playback ends. This exception preserves
the retained pose's original timestamp and corrected coordinates; empty history,
prehistory and internal gaps remain invalid. VPS and live-robot freshness rules
are unchanged.

Accepted map alignment retains capture-time robot travel, heading, source generation,
and immutable transform snapshots. Its lifetime is separate from image admission
freshness: crossing a motion threshold makes another correction due, without
invalidating the last accepted alignment or discarding a valid response solely
because the robot moved during HTTP processing. Older corrections cannot supersede
newer ones. Composed confidence is the minimum of robot/headset confidence, a
conservative quality score rather than a calibrated probability.

`armodule.localization` exposes `travel_threshold_m` (0.75),
`heading_threshold_deg` (30), `marker_preference_s` (3), and
`headset_travel_threshold_m` (10). Distances must be finite and positive, angle is
in (0, 180], and preference is finite and nonnegative. Changes apply at restart.
`episode_timeout_s` defaults to 12. Historical `anchor_max_age_s` and
`robot_timing_uncertainty_s` settings remain readable for configuration compatibility;
they do not expire accepted independent map alignments or impose stillness.
A robot clock/frame reset retires pending work and connections; AR navigation
requires restarting DimOS mapping with a fresh map.

The fixed XY mapping and coordinate-model restart rules are defined under
[odometry scale correction](#odometry-scale-correction). The read-only
`tools/check_go2_registration.py` utility checks recorded geometry. Headset camera
calibration procedures are in [CALIBRATION.md](../clients/webxr/CALIBRATION.md).

### Odometry reference continuity

`hello.odom_reference_id` is a required opaque identifier for the current server odometry reference. It remains unchanged across client socket reconnects and changes when the server or robot odometry source restarts. Clients may restore a retained localization only when the new identifier matches the one used to localize, and the headset tracking space has not reset. Missing identifiers invalidate hello; changed identifiers require re-localization; navigation commands remain disabled during reconnect.

## Manipulation details

The [request inventory](#manipulation_request-optional) and
[motion lifecycle](#motion-ownership-and-completion) define admission and ownership.
Manipulation capability is independent of navigation, localization, LiDAR and agent
availability. Model/trajectory bulk records reconstruct the domain snapshots;
base `pose` and measured arm feedback remain distinct.

Available observations carry named measured joints, original `measured_at`, tool
pose and optional measured gripper. Model descriptors carry root/link/joint topology,
origins, axes, bounds, mimic relationships and visual identity. Root placement is
wire `odom`; visual FK and bundled ghosts never authorize motion. Trajectories
have at most 8192 points; models at most 256 links/joints. Identifiers, finite values,
unit quaternions, named-vector dimensions and trajectory ordering are validated.
Following samples use hello clock conversion, strictly increasing sequences and
a 500 ms age / 100 ms future bound, in addition to native target watchdogs.
Environment-depth data remains host-local.

### Manipulation target execution and parking

`manipulation_request` adds `reset_joints` and `prepare_shutdown`, both using the
existing `request_id`, `group_id`, and optional `speed_scale` in (0, 1].
Reset defaults to 0.5; shutdown parking defaults to 0.2. They plan a collision-checked joint-zero arm move, preserving the gripper,
and reply only after fresh joint feedback confirms zero within the configured joint tolerance (0.02 radians by default, 0.05 for OpenYAM) for
0.5 seconds, or report failure. They never clear emergency stop. Shutdown parking
is capped at 20% and a 55-second operation budget inside the supervisor’s
60-second response deadline; the launcher then proceeds with shutdown even
if parking fails or times out. The supervisor keeps DimOS alive until the attempt
finishes. Power loss and SIGKILL cannot provide orderly parking.

Following `update` accepts `speed_scale` with the same range/default; the server
applies it to the bounded Cartesian IK task's joint velocity envelope.
`plan` retains its existing speed semantics and execute-by-plan-ID binding.
Preview is a client label for `plan`; Execute can request and then execute a
checked plan without a separate user Plan action. The immediate dotted target
guide is advisory and does not represent a checked trajectory.

Manipulation `plan` may include `final_gripper` in [0,1]. It is bound to that
plan ID and issued only after successful measured execution arrival. Cancel, E-stop, replacement, failure, and ownership
retirement discard deferred gripper intent. Selected target edits do not send
immediate gripper commands. In selected mode Open/Close only edits the draft;
Execute explicitly starts the checked motion with `final_gripper`. A gripper-only
draft also requires Execute. Unselected Open/Close remains immediate. Optional visual joint `limits` describe lower/upper
positions for gripper-only articulation.


### Capability summaries and live arm feedback

`hello.capabilities.object_detection` uses the required
`available`/`reason` shape. It describes
an explicitly configured detector in the loaded blueprint; Agent mode and fiducial
localization do not imply object detection. Navigation retains its nested input flags.

Manipulation state optionally includes `operation: "resetting" | "parking" | null`,
using the existing `operation_id` for correlation. `observations.*.measured_at` uses
the accepted source joint-sample timestamp, not the time a snapshot is requested.

Following update results may contain `sequence` (the original update sequence),
`joints`, and a short machine-readable `code`. At most 20 times per second,
validated targets return `status: "feasible"` and the IK joint configuration.
`status: "infeasible"` with `code: "ik_failed"` or `"joint_limit"` holds motion while
retaining the following lease. New reachable input can recover within the same grab.
Lease/ownership loss remains `rejected`; stale samples never command motion.

Selected advisory IK evaluations are serialized and coalesced at a minimum 50 ms interval.
Full path planning runs on release, Preview, or Execute.
The client retains the last valid preview while computing its replacement; an older
preview is never executable for a newer target, speed, or final-gripper intent.

Reset and parking first confirm whether fresh samples are already within the
configured zero tolerance (0.05 rad for OpenYAM) for 0.5 seconds. That case does not start another trajectory. Otherwise,
settling ends three seconds after the nominal trajectory duration, within the overall
55-second budget. Failure reports the worst joint error and confirms stopping before
releasing ownership. Parking quiesces new motion until process shutdown; it never
clears emergency stop. Motion-related callbacks are drained before RPC teardown.

### Manipulation lifecycle receipts and visual metadata

`prepare_shutdown` results may include `quiescent: boolean`. Only an explicit
`true` acknowledges that motion has been stopped and the runtime has completed
its quiescence handshake. A completed parking attempt alone is not this receipt.
A rejected parking attempt may still acknowledge quiescence after confirmed cleanup;
missing/false receipts, exceptions, and timeouts retain the service teardown stop.
The receipt never authorizes another motion or clears an emergency stop.

Optional `model.visual_profile` identifies host visual corrections independently
of `asset_url`. OpenYAM uses `openyam`. Optional `model.gripper_joints` maps joint
names to finite `{closed, open}` positions for normalized visual articulation.
The host applies only independent gripper joints within the selected tool subtree,
never the group's controlled arm joints. Descriptors without this metadata retain
the standard lower-to-upper articulation; URLs do not select articulation policy.
Visual metadata does not change planning geometry or authorize motion.

The following solver accepts the documented wire speed range `(0, 1]`; the WebXR
slider retains its 5–100% range and 50% default. Parking remains capped at 20%.
Runtime lease expiry and deferred gripper completion advance independently of
WebSocket observation requests. Snapshot reads do not issue control commands.

### Client decode error reports

A ready client rejects invalid JSON application messages without closing its connection.
It may send `client_error` containing string fields `message_type` (maximum 128
characters), `detail` (1024), and `excerpt` (512). The server logs the report with
client identity and its receipt timestamp, without replying or replaying messages.
Reports include `ts` in the existing synchronized server clock, optional original
`message_ts` and existing `request_id`. The first error is reported immediately;
identical type/detail signatures are deduplicated for five seconds with an optional
`suppressed_count` on the next report. History is bounded to 32 signatures. Binary
decode errors use a short hexadecimal header excerpt. Message IDs are not introduced.
Malformed manipulation content disables arm input until valid state and cancellation
confirmation return; localization and unrelated session facts remain intact.


### Mesh interaction and target recovery

Arm selection uses the articulated mesh and root sphere, without displayed selection
boxes. ClientCore owns the shared visibility and interaction policy for both hosts.
`manipulation_result` optionally carries `failed_joints`, at most 256 nonempty joint
identifiers. A missing list provides no joint attribution. Recoverable IK, joint-limit,
and collision failures use `infeasible` for update, evaluation, and planning; they
preserve capture and ownership rather than invalidate session health. An invalid
mesh remains at its last validated configuration in yellow, with identified child-link
segments red. Rendered/FK values never authorize motion.

Normal unselected release follows the [server-owned tail lifecycle](#motion-ownership-and-completion).
An invalid final target restores the shared draft to its latest validated pose
without commanding a return move. Selected release requires Execute for motion.
Both clients default normal motion to 50%.

Recorded playback uses `hello.source = {kind: "recording", read_only: true,
name: <filename>}`. `state.playback` reports `{state: "playing" | "ended",
elapsed_s, duration_s}` in seconds at 1× speed, once. At EOF the final observation
is held; restarting the launcher run restarts playback. Recording compositions
have no hardware or control coordinator. Navigation and agent capabilities are
unavailable. Arm recordings still publish the visual model and observations,
with `manipulation_state.read_only: true`; every manipulation request is rejected
with `code: "read_only"`. Both hosts disable arm interactions for that state.
Recorded timestamps are rebased to server time for observation freshness.

Arm manipulation state may include `protection`: `state` (normal, derated, paused, fault), `reason`, affected `joints`, `effective_speed_scale` (0–1), and `resumable`. Absence means no protection summary was supplied. A hard motor fault never automatically re-enables motors.

Launcher shutdown accepts `POST /api/armodule/stop?force=true` to bypass a pending graceful stop. Force stop omits parking and terminates the owned runtime tree. Server execution completion retains the matching `operation_id`; clients may retire the matching executed draft without a second arrival test.

`manipulation_state.following_at_target` optionally reports a fresh measured arrival/hold from the live controller, correlated by `following_goal` (wire pose). It does not release the grab. Clients compare this goal to current intent before showing Idle or completing a normal release; absence of these fields provides no measured-arrival evidence.

Execution arrival uses fresh measured feedback within 30 mm and 8 degrees for 0.5 seconds.
The protected trajectory remains scheduled while holding its final endpoint; nominal
trajectory completion alone is not measured arrival. After two seconds without
meaningful progress during the final endpoint phase, confirmed cancellation emits
`execution: "aborted"`, the corresponding `operation_id`, and `message: "Target not reached"`.
Clients retain the planned target for retry. Deferred gripper changes run only after
successful arrival, never after an aborted move. These use the existing wire fields.

### Arm observation continuity and operation phases

Optional observation fields `joint_velocities` (finite joint-name/value map in rad/s
or m/s) and `gripper_target` (accepted normalized command, or null) accompany raw
joint feedback. `gripper` remains measured opening: an object can prevent full
closure without failing a successful command. Clients publish no hardware targets
when feedback exceeds 500 ms. They retain the grab, draft, current model and paused
Preview for up to one second of feedback or connection loss; the local target can
continue following the hand. Recovery invalidates checked plans and following
leases. Reconnection never clears motor Stop or resumes it automatically.

`execution_phase` is optionally `motion`, `gripper`, or null. An executed plan has
one operation ID and one terminal outcome, published after its deferred gripper
command acknowledges. Motion can complete within 30 mm / 8 degrees after nominal
trajectory duration, with 500 ms of fresh settled feedback and confirmed cancellation
of residual motion. This tolerance never authorizes IK, planning, or joint limits.
Deferred gripper actions run once; a rejected action fails the whole operation.

Selected dragging requests nonmoving seeded IK at most 20 Hz, one in flight with
newest intent coalesced. Release, Preview and Execute request a checked full path.
Presentation uses update-timed Hermite interpolation with velocity continuity,
an adaptive 150 ms measured-feedback cap and 250 ms advisory-preview cap, plus at
most 30 ms of bounded visual prediction. Filtered positions never enter control
or completion checks.

### Replicated arm IK preview

`manipulation_state.evaluation` optionally carries `{group_id, target_revision,
joints, pose}` for the latest feasible nonmoving IK evaluation. `joints` maps
model joint names to finite values; `pose` is the validated end-effector pose or
null. The revision is a nonnegative integer identifying the canonical shared
manipulation target. Observers use it only for that group and target revision.
It is a visual preview, never an executable plan or measured robot feedback.
Changed targets and retired requests cannot publish evaluations for newer revisions;
Execute still requires the exact checked `plan_id` and target revision.

### Shared following transport

See [connection identity and recovery](#connection-identity-and-recovery) for
bounded recovery and [motion ownership](#motion-ownership-and-completion) for
released-tail completion. OpenYAM reset uses its configured 0.05 rad zero tolerance.

Manipulation uses the existing shared target update
stream plus idle renewals. The server forwards accepted following targets using its
native token. Clients do not send a second native update stream. Native advisory
replies use `shared-follow-<token>-<sequence>` request IDs; feasible replies are visual
feedback, never authorization to execute an unchecked target. A superseded advisory
result may be returned to its initiating client for continuity, but cannot be
published as validation of the new shared target. Full plans remain strictly fenced.
Gripper set-value requests require the current manipulation lease but do not wait
for a matching moving-pose revision. Selected gripper changes remain draft intent.

Completed operation IDs identify outcomes and do not reserve editing authority.

Explicit Cancel/Stop can be admitted without acquiring an editing lease when no
editor owns the robot. Native operation ownership and epoch fences still apply.
Confirmed cancellation clears that group's shared draft, without clearing a
successor's target. A locally discarded draft cannot be restored by repeated
snapshots of its old revision. Suspending an observer only retires local state;
it must not issue a native cancellation for another client's shared draft.

### Independent advisory IK and manual failed-target release

Nonmoving advisory IK evaluates the owning client's latest local pose under its
current epoch, manipulation lease and group, without requiring a per-sample
canonical acknowledgement. This is current v2 behavior, with no feature flag.
The server validates editing authority independently of the sample's revision;
full Plan and Execute requests still require the exact canonical target revision.
Only a sample matching the current canonical pose and revision can populate
`manipulation_state.evaluation`. Older samples may update the initiating client's
visual preview but never authorize motion or validate a newer target.

`manipulation_result.sample_pose` optionally identifies the attempted source pose
for feasible and infeasible `evaluate`/`update` outcomes. It has the usual finite
position and unit-quaternion shape. `pose` remains the solved end-effector pose;
`target_revision`, request ID, native token and sequence retain their existing
correlation roles. No additional acknowledgement is required for every target
update: regular authoritative snapshots acknowledge accumulated input sequences.
Acquisition, release, execution, cancellation and gripper outcomes remain reliable.

An IK failure preserves the user's grab. The latest validated model pose remains
visible while the sphere follows held input. Only manual release restores a failed
sphere to the latest validated pose, or its measured grab-start pose if no target
was validated. This shared-draft reconciliation sends no native return movement.
Late replies are scoped to their source episode, epoch and editing lease; they
cannot restore an old target after another client has taken ownership.

Reset retires the initiating client's local draft episode before requesting authority.
After ownership, epoch and robot-busy checks succeed, `reset_joints` admission clears
only that group's canonical manipulation draft. A rejected Reset leaves shared drafts
intact. Its temporary authority ends without republishing a target pose; acquisition
and completion must not restore the discarded draft. Pending acquisition counts as
Reset busy work. Late results must match the request episode, epoch and lease before
changing local intent or releasing authority.

Advisory IK and full planning have independent single-request lanes. New input keeps
only the latest intent; a new grab supersedes queued release planning. Obsolete full
plans remain tracked until completion or timeout but never block advisory IK or
authorize Execute. Native timeout quarantine remains in effect until actual work
returns. Advisory evaluation uses the configured solver iteration budget in its
separate worker, preserving collision checks and exact Plan/Execute validation.
