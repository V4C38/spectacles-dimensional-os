# Protocol — dimos-ar WebSocket message schema

This is the cross-platform contract between the DimOS-side bridge and any AR
client. It is the real API of this project. Any client (Spectacles, phone,
Quest) that speaks this protocol works without touching the Python side.

Keep this document and `dimos_ar/protocol.py` in sync. Version the protocol;
bump `protocol_version` on any breaking change.

**Reference implementations:**

| Client | Location |
|--------|----------|
| Web debug / phone | `clients/web/src/protocol.ts` (this repo) |
| Spectacles Lens | `lens-studio/` (see `docs/LENS_DEVELOPMENT.md`) |

## Transport

- Plain WebSocket. The Mac runs the **server**; AR devices connect as
  **clients**. (The bridge does not "connect to" the glasses — it exposes a
  server they connect to.)
- All messages are JSON text frames (binary is a future optimization).
- Every message is a JSON object with a `type` field and a `ts` field
  (float, Unix seconds, from the source data where available).
- Coordinates in outbound messages are in the **AR world frame** (already
  transformed by the bridge). Coordinates in inbound messages are also in the
  **AR world frame** — the bridge converts them to the robot frame.
- Every message carries `robot_id` (string). Single-robot setups use a constant
  like `"go2"`. This field exists from day one so multi-robot needs no schema
  change later.

## Handshake

On connect, the server sends one `hello`. Capabilities reflect what the running
blueprint supports.

**Milestone 1 (go2_ar_basic):**

```json
{
  "type": "hello",
  "protocol_version": 1,
  "robots": ["go2"],
  "capabilities": ["lidar", "odom", "align"]
}
```

**Milestone 2+ (go2_ar_nav, when navigation is wired):**

```json
{
  "type": "hello",
  "protocol_version": 1,
  "robots": ["go2"],
  "capabilities": ["lidar", "odom", "nav", "path"]
}
```

Clients should ignore unknown capability strings gracefully.

Immediately after `hello`, the server sends `bridge_status` (see below). The server
also pushes an updated `bridge_status` when robot connection state changes, and
responds to client `get_status` requests.

## Outbound messages (server -> AR client)

### bridge_status
Snapshot of what the Mac-side bridge is connected to. Use this to show whether a
physical robot (or replay) is active, which platform model is in use, and whether
sensor streams are flowing.

```json
{
  "type": "bridge_status",
  "ts": 1730000000.123,
  "robot_id": "B42D1234567890ABCD",
  "mode": "live",
  "robot_connected": true,
  "robot_model": "unitree_go2",
  "robot_serial": "B42D1234567890ABCD",
  "streams_active": true,
  "registered": false,
  "reconnecting": false
}
```

| Field | Type | Meaning |
|-------|------|---------|
| `mode` | `"live"` \| `"replay"` | Hardware WebRTC vs recorded replay |
| `robot_connected` | bool | Robot data path is active |
| `robot_model` | string | DimOS platform id (e.g. `unitree_go2`, future `unitree_g1`) |
| `robot_serial` | string, optional | Hardware serial when `mode` is `live`; omitted in replay |
| `streams_active` | bool | Recent lidar and odom on the bridge |
| `registered` | bool | World-frame calibration applied |
| `reconnecting` | bool | Live reconnect in progress |

No robot IP is included.

### align_status
Alignment progress during the setup wizard **Calibrate Coordinates** step.

```json
{
  "type": "align_status",
  "ts": 1730000000.123,
  "robot_id": "go2",
  "state": "detecting",
  "robot_marker_detected": false,
  "spectacles_marker_detected": true,
  "quality": 0.81,
  "best_quality": 0.95,
  "has_candidate": true,
  "candidate_count": 4,
  "message": "Spectacles sees marker — waiting for robot camera"
}
```
- `state`: `detecting` (in progress), `aligned` (success), or `failed` (rejected; retry).
- `robot_marker_detected`: whether the robot camera has a recent AprilTag detection
  (within the bridge timestamp tolerance, default 500 ms).
- `spectacles_marker_detected`: whether the AR device is currently tracking the
  calibration marker (i.e. the bridge has received `align_marker` messages).
- `quality`: optional, 0–1 confidence for the current alignment sample. During
  `detecting`, this is the most recent successful match. On `aligned`, it is the
  committed sample quality.
- `best_quality`: optional, 0–1 confidence for the best alignment candidate seen so far
  during the current calibration session.
- `has_candidate`: optional bool indicating whether the bridge currently has a valid
  candidate that could be committed.
- `candidate_count`: optional integer count of successful candidate updates seen so far
  in the current calibration session.
- `message`: human-readable status for the wizard UI.

### lidar
A subsampled point cloud in the AR world frame. The bridge may optionally apply
360-degree range/height filtering to keep nearby traversable space plus obstacles
while trimming very high clutter above the robot.

```json
{
  "type": "lidar",
  "ts": 1730000000.123,
  "robot_id": "go2",
  "frame": "world",
  "points_flat": [x1, y1, z1, x2, y2, z2, ...],
  "colors_flat": [r1, g1, b1, r2, g2, b2, ...]
}
```
- `points_flat`: flat array of floats (x,y,z triples), metres, rounded to 3 decimals.
  Expect ~1-3k points (3-9k floats). Clients unflatten to `[[x,y,z], ...]`.
- `colors_flat`: optional, parallel flat array of [r,g,b] 0-1 floats. The bridge
  may send semantic colours such as ground-vs-obstacle classification; otherwise
  clients can fall back to their own colouring.

### pose
The robot's current pose in the AR world frame.

```json
{
  "type": "pose",
  "ts": 1730000000.123,
  "robot_id": "go2",
  "frame": "world",
  "position": [x, y, z],
  "orientation": [qx, qy, qz, qw]
}
```

### path
The planner's current planned path (Milestone 2+).

```json
{
  "type": "path",
  "ts": 1730000000.123,
  "robot_id": "go2",
  "frame": "world",
  "waypoints": [[x, y, z], ...]
}
```
Sent whenever the planner emits a new path. An empty `waypoints` array means
no active path.

### nav_status
Navigation state updates (Milestone 2+).

```json
{
  "type": "nav_status",
  "ts": 1730000000.123,
  "robot_id": "go2",
  "state": "following_path",
  "goal_reached": false
}
```
`state` is one of `idle`, `following_path`, `recovery` (mirrors DimOS
`NavigationState`).

### object  (Milestone 3+)
A detected object placed in the AR world frame.

```json
{
  "type": "object",
  "ts": 1730000000.123,
  "robot_id": "go2",
  "frame": "world",
  "object_id": "obj_42",
  "label": "backpack",
  "confidence": 0.87,
  "position": [x, y, z]
}
```
`object_id` is stable across frames for the same physical object so the client
can update rather than duplicate a marker.

## Inbound messages (AR client -> server)

### register
Sent by the client to perform frame alignment. Carries the ArUco marker pose as
observed by the AR device, in the AR world frame, plus the marker id.

```json
{
  "type": "register",
  "ts": 1730000000.123,
  "robot_id": "go2",
  "marker_id": 0,
  "marker_position": [x, y, z],
  "marker_orientation": [qx, qy, qz, qw]
}
```
On receipt the bridge samples the robot's current `odom` pose and computes the
`T_world_odom` calibration transform. The server replies with a `registered`
ack (see below).

### registered
Acknowledgement that frame alignment succeeded (or failed).

```json
{
  "type": "registered",
  "ts": 1730000000.123,
  "robot_id": "go2",
  "registered": true
}
```
- `registered`: `true` if calibration was applied; `false` if registration
  failed (e.g. no odom sample available yet). Clients may retry `register`.

### nav_goal  (Milestone 2+)
A waypoint the user placed on the floor in AR.

```json
{
  "type": "nav_goal",
  "ts": 1730000000.123,
  "robot_id": "go2",
  "frame": "world",
  "position": [x, y, z]
}
```
The bridge transforms this into the robot frame and publishes a `PointStamped`
to the planner. `z` may be ignored by a ground robot but is included for
clients and for future aerial use.

### cancel_goal  (Milestone 2+)
```json
{ "type": "cancel_goal", "ts": 1730000000.123, "robot_id": "go2" }
```
The bridge calls the planner's `cancel_goal()`.

### align_start
Sent when the Spectacles wizard enters **Calibrate Coordinates**. Activates robot-side
AprilTag detection on incoming camera frames.

```json
{ "type": "align_start", "ts": 1730000000.123, "robot_id": "go2" }
```

### align_stop
Sent when the user leaves the calibrate step without completing alignment. Stops
robot-side detection.

```json
{ "type": "align_stop", "ts": 1730000000.123, "robot_id": "go2" }
```

### align_commit
Sent when the user confirms calibration. The bridge applies the best alignment candidate
gathered during the current `align_start` session, if one exists.

```json
{ "type": "align_commit", "ts": 1730000000.123, "robot_id": "go2" }
```

### align_marker
Sent while the Spectacles Image Marker is tracked during the calibrate step. Carries
the marker pose in the **AR world frame**. The bridge matches this with a recent robot
camera detection (same bridge monotonic clock, default 300 ms window) and computes
`T_world_odom`.

```json
{
  "type": "align_marker",
  "ts": 1730000000.123,
  "robot_id": "go2",
  "marker_position": [x, y, z],
  "marker_orientation": [qx, qy, qz, qw]
}
```
Successful samples update `align_status` with live `quality` / `best_quality`. The
bridge only commits calibration after `align_commit`, at which point it replies with
`align_status` where `state` is `aligned`. The legacy `register` / `registered` flow
remains for the web debug client and replay.

### get_status
Request a fresh `bridge_status` snapshot from the server (replied on the same
connection).

```json
{ "type": "get_status", "ts": 1730000000.123, "robot_id": "go2" }
```

Use `hello.robots[0]` as `robot_id` after connect when the bridge reports a hardware
serial.

## Versioning rules

- Additive changes (new message type, new optional field): no version bump.
- Breaking changes (renamed/removed field, changed semantics): bump
  `protocol_version` and note it here.
- Clients should ignore unknown message types and unknown fields gracefully.