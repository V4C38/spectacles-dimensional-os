# Protocol — dimos-ar WebSocket message schema

This is the cross-platform contract between the DimOS-side AR bridge and any AR
client. It is the real API of this project.

Keep this document, `dimos/ar/network/protocol.py`, and
`lens-studio/Assets/Scripts/Bridge/Protocol.ts` in sync. Bump
`PROTOCOL_VERSION` on breaking changes.

## Transport

- Plain WebSocket. The Mac runs the server; XR devices connect as clients.
- Most messages are JSON text frames. High-resolution camera stills use a binary
  `camera_frame` envelope (see below).
- Every JSON message is a JSON object with a `type` field.
- Inbound and outbound coordinates use the XR world frame. The bridge converts
  world-frame goals and registration poses into robot odom coordinates.
- Every runtime message carries a single active `robot_id`.
- **Text framing:** every outbound JSON text frame from the bridge ends with a
  single newline (`\n`). The client accumulates incoming text and splits on
  `\n` to recover complete messages when the platform delivers one JSON object
  across multiple WebSocket callbacks. Binary frames (LiDAR, `camera_frame`) are
  not newline-delimited.

## Handshake

On connect, the server sends `hello` with the active robot metadata and a flat
capability map:

```json
{
  "type": "hello",
  "protocol_version": 5,
  "robot": {
    "robot_id": "unitree_go2",
    "robot_model": "unitree_go2",
    "display_name": "Unitree Go2",
    "body_bounds_m": [0.7, 0.5, 0.55],
    "footprint_m": [0.7, 0.5],
    "visual_origin_frame": "base_link",
    "base_height_m": 0.33,
    "default_render_offset_m": [0.0, 0.0, 0.0],
    "registration_profile": {
      "method": "april_odom_baseline",
      "tag_ids": [0],
      "tag_total_size_m": 0.070
    }
  },
  "capabilities": {
    "lidar":                              { "available": true,  "reason": null },
    "odom":                               { "available": true,  "reason": null },
    "registration_april_odom_baseline":   { "available": true,  "reason": null },
    "registration_manual_pose":           { "available": true,  "reason": null },
    "nav":                                { "available": true,  "reason": null },
    "path":                               { "available": true,  "reason": null },
    "plan_preview":                       { "available": true,  "reason": null },
    "cancel_goal":                        { "available": true,  "reason": null },
    "emergency_stop":                     { "available": false, "reason": "No safe stop interface is available in this runtime." }
  }
}
```

Rules:

- `robot` is the only static robot descriptor in the protocol.
- `capabilities` is a flat map from capability name → `{ available, reason }`.
  Every capability the runtime knows about is present in the map.
- `available: false` with a non-null `reason` means the feature exists but is
  currently disabled. Clients should render these as disabled, not hidden.
- The separate `disabled_capabilities` / `capability_states` arrays from v3 are
  removed; `capabilities` is the single source of truth.

### `hello.robot.registration_profile`

Optional field emitted when the robot adapter provides registration configuration.
Absent or `null` when the adapter does not supply one.

| Field | Type | Description |
|-------|------|-------------|
| `method` | `string` | Recommended registration mode (e.g. `"april_odom_baseline"`) |
| `tag_ids` | `number[]` | AprilTag IDs physically mounted on this robot |
| `tag_total_size_m` | `number` | Outer edge size of each printed tag in metres |

Example (Unitree G1):
```json
{
  "method": "april_odom_baseline",
  "tag_ids": [0],
  "tag_total_size_m": 0.070
}
```

Immediately after `hello`, the server sends `bridge_status`.

## Outbound Messages

### `bridge_status`

Dynamic bridge/runtime state:

```json
{
  "type": "bridge_status",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "robot_connected": true,
  "streams_active": true,
  "registered": false,
  "reconnecting": false,
  "registration_method": "manual_pose",
  "registration_approximate": true
}
```

Fields:

- `robot_connected`: bridge has an active robot/runtime data path
- `streams_active`: recent lidar and odom are flowing
- `registered`: world-frame registration has been committed
- `reconnecting`: reconnect/recovery is in progress
- `registration_method`: **always present** — `"april_odom_baseline"`, `"manual_pose"`, or `null` when unregistered (same strings as `registration_start.mode`)
- `registration_approximate`: **always present** — `true` when the active registration is approximate (e.g. manual pose)

### `registration_status`

Registration progress during a setup session:

```json
{
  "type": "registration_status",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "mode": "april_odom_baseline",
  "phase": "awaiting_motion",
  "capture": "steady",
  "message": "Authorize robot motion to begin baseline collection",
  "tag_visible": true,
  "motion": {
    "frame": "robot",
    "axis": "lateral",
    "direction": "left",
    "distance_m": 0.200,
    "waypoint_index": 1,
    "waypoint_total": 3
  },
  "preview_pose": {
    "position": [1.2, 0.0, -2.0],
    "orientation": [0.0, 0.0, 0.383, 0.924]
  }
}
```

Fields:

- `mode` (optional): `"april_odom_baseline"` or `"manual_pose"` — matches `registration_start.mode` when a session is active
- `phase`: one of `"idle"`, `"scanning"`, `"awaiting_motion"`, `"moving"`, `"sampling"`, `"editing"`, `"awaiting_commit"`, `"succeeded"`, `"failed"`
- `capture`: camera capture hint for the client — `"off"`, `"steady"`, `"burst"`, or `"hold"`
- `message`: human-readable status string for display in the client HUD
- `tag_visible` (optional): present for AprilTag baseline sessions; `true` when a configured robot-mounted tag was detected in the most recent processed frame
- `motion` (optional): structured safety hint during baseline strafe — `frame` (`"robot"`), `axis` (`"lateral"`), `direction` (`"left"` | `"right"`), `distance_m`, `waypoint_index`, `waypoint_total`
- `preview_pose` (optional): estimated robot pose in world frame (`position` xyz metres, `orientation` quaternion xyzw); omitted until a solve is available

### `camera_frame_ack`

Per-frame acknowledgement after the bridge receives a binary `camera_frame`.
The bridge acks **every** received frame, including frames it drops (busy
processing a previous frame, stale `send_ts - ts`, missing intrinsics, or manual
session fast-path) — dropped frames are still acked so the client can clear its
single-flight capture state:

```json
{
  "type": "camera_frame_ack",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "seq": 42
}
```

> **v3 → v4 breaking change**: `tag_detected`, `tag_ids`, and `quality` are
> removed. Use `registration_status.tag_visible` for detection feedback.

### Numeric precision (outbound)

Bridge encoders round world-frame floats before JSON serialization to reduce
payload size on Wi-Fi:

| Field | Decimal places |
|-------|----------------|
| `lidar.points_flat` | 2 |
| `pose.position`, `pose.orientation` | 4 |
| `pose_correction.trans_delta_m`, `pose_correction.solve_quality` | 4 |
| `pose_correction.yaw_delta_deg` | 3 |
| `path` / `path_preview` waypoints and `target` | 3 |
| `ts` on high-rate streams (`lidar`, `pose`, `path`, `path_preview`) | 3 |

### `lidar` (binary — default)

Subsampled point cloud in XR world frame, sent as a **binary WebSocket frame**
(message type `0x01 lidar_f16`). Each point is encoded as three IEEE 754
half-precision (float16) values, little-endian. Up to 2500 points per frame.
The emitted point set depends on the active bridge-side LiDAR mode selected by
the client:

- `full`: current world-frame stream after the bridge's standard voxel/range/height
  filtering
- `obstacles`: bridge-filtered obstacle subset only
- `off`: no `lidar` frames are sent

Wire layout:

| Offset | Size | Type | Field |
|--------|------|------|-------|
| 0 | 1 B | uint8 | message_type = `0x01` |
| 1 | 4 B | float32 LE | timestamp (seconds) |
| 5 | N×6 B | float16[] LE | x, y, z per point in world metres |

Point count: `N = (total_bytes − 5) / 6`.

### `lidar` (JSON — legacy fallback)

The JSON format is preserved for debugging and backwards compatibility. It is
only emitted when `ARBridgeConfig.lidar_binary = False`.

```json
{
  "type": "lidar",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "frame": "world",
  "points_flat": [x1, y1, z1, x2, y2, z2]
}
```

### `pose`

Robot pose in XR world frame:

```json
{
  "type": "pose",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "frame": "world",
  "position": [x, y, z],
  "orientation": [qx, qy, qz, qw],
  "speed_mps": 0.42
}
```

- `speed_mps` (optional): smoothed robot linear speed in m/s from bridge odom,
  used by the Lens for runtime static capture burst when the robot stops.

### `pose_correction`

Runtime pose-correction telemetry emitted when the bridge commits a tag-driven
world-to-odom correction **that exceeds the notification deadband**
(≥ 5 cm translation or ≥ 1° yaw).  Sub-threshold micro-refinements still update
`T_world_odom` on the bridge but do not emit this message, so Lens-side
user-visible events (e.g. "Refined Tracking" toast, realignment snap animation)
fire only when the robot position has meaningfully changed:

```json
{
  "type": "pose_correction",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "trans_delta_m": 0.1824,
  "yaw_delta_deg": 6.137,
  "yaw_corrected": false,
  "solve_quality": 0.9521,
  "solve_method": "tag_translation"
}
```

Fields:

- `trans_delta_m`: translation magnitude before the correction commit, in metres
- `yaw_delta_deg` (optional): yaw magnitude before the correction commit, in degrees
- `yaw_corrected`: `true` when the correction came from a full `tag` solve that
  can update yaw; `false` for `tag_translation` fallback solves
- `solve_quality`: quality score reported by the tracker for the committed solve
- `solve_method`: `"tag"` or `"tag_translation"`

### `path`

Planner path in XR world frame:

```json
{
  "type": "path",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "frame": "world",
  "waypoints": [[x, y, z]]
}
```

### `path_preview`

Preview planner path in XR world frame for an unconfirmed target:

```json
{
  "type": "path_preview",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "frame": "world",
  "waypoints": [[x, y, z]],
  "target": [x, y, z]
}
```

Fields:

- `waypoints`: preview route in XR world frame; may be empty when no preview path
  is available
- `target`: echoed world-frame target used for this preview request so the client
  can ignore stale responses

### `nav_status`

Navigation state updates:

```json
{
  "type": "nav_status",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "state": "navigating",
  "goal_reached": false,
  "goal_failed": false
}
```

Optional fields:

- `recovering`: when `true`, the bridge cleared a stuck goal and the client should return to a retryable placing state without treating it as a terminal failure
- `error_code`: optional numeric code when navigation is unavailable for the session (logged on the Lens; `505` = goal stalled)

## Inbound Messages

### `get_status`

```json
{
  "type": "get_status",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2"
}
```

The bridge responds with a runtime sync burst for the requesting client:

1. `bridge_status` — current bridge/registration snapshot
2. `nav_status` — current navigation lifecycle state (including optional
   `recovering` / `error_code`)
3. `path` — last navigating path when navigation is active; omitted when no
   navigating path is cached

The same sync burst is sent automatically after the initial `hello` on connect.

### `set_lidar_mode`

Update the bridge-global LiDAR transmit mode. The latest message from any
connected client becomes the active bridge policy for all clients until another
`set_lidar_mode` arrives or all clients disconnect.

```json
{
  "type": "set_lidar_mode",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "mode": "obstacles",
  "obstacle_min_distance_m": 0.10,
  "obstacle_opaque_distance_m": 0.40,
  "obstacle_max_distance_m": 0.60
}
```

Fields:

- `mode`: `"off"`, `"obstacles"`, or `"full"`
- `obstacle_min_distance_m`: robot-relative horizontal distance where obstacle
  rendering/filtering begins
- `obstacle_opaque_distance_m`: distance where the client starts fading obstacle
  points; must be greater than or equal to `obstacle_min_distance_m`
- `obstacle_max_distance_m`: farthest robot-relative horizontal distance that
  obstacle mode keeps; must be greater than or equal to
  `obstacle_opaque_distance_m`

Semantics:

- `off`: the bridge suppresses LiDAR transmission entirely
- `obstacles`: the bridge sends only points inside the configured obstacle
  distance annulus after its normal height/range filtering
- `full`: the bridge sends the standard full XR payload path

### `registration_start`

Begin a registration session.

```json
{
  "type": "registration_start",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "mode": "april_odom_baseline"
}
```

Fields:

- `mode` (**required**): `"april_odom_baseline"` for AprilTag + odom baseline
  registration, or `"manual_pose"` for manual marker placement. Requires the
  matching capability (`registration_april_odom_baseline` or
  `registration_manual_pose`) to be available in `hello`.

### `registration_action`

Authorize the bridge to begin robot motion during an `april_odom_baseline`
session. The bridge **MUST NOT** issue baseline strafe motion before receiving
`registration_action` with `action: "authorize_motion"` for the current session.

```json
{
  "type": "registration_action",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "action": "authorize_motion"
}
```

### `registration_stop`

Stop/cancel the current registration session.

### `registration_commit`

Commit the current best registration candidate (manual pose flow).

### `registration_pose`

Manual robot pose estimate from the XR client during a `manual_pose` session:

```json
{
  "type": "registration_pose",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "position": [x, y, z],
  "orientation": [qx, qy, qz, qw]
}
```

The bridge silently drops `registration_pose` unless a `manual_pose` session is
active.

### `camera_info`

Spectacles camera intrinsics for the active capture resolution (sent once per
resolution change before binary frames, including setup-stream `1008x756` and
runtime-still `3200x2400` stage switches):

```json
{
  "type": "camera_info",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "width": 3200,
  "height": 2400,
  "fx": 1800.0,
  "fy": 1800.0,
  "cx": 1600.0,
  "cy": 1200.0,
  "distortion": [],
  "camera_model": "pinhole",
  "device_model": "spectacles"
}
```

### `camera_frame` (binary)

JPEG camera frame plus pose metadata. Wire format:

1. Magic `XRF1` (4 bytes)
2. `header_len` uint32 little-endian
3. UTF-8 JSON header
4. Raw JPEG bytes

Header fields:

```json
{
  "type": "camera_frame",
  "robot_id": "unitree_go2",
  "seq": 42,
  "ts": 1730000000.123,
  "send_ts": 1730000000.456,
  "cam_pos": [x, y, z],
  "cam_rot": [qx, qy, qz, qw]
}
```

- `ts`: capture time in scene seconds (`imageFrame.timestampMillis / 1000`)
- `send_ts`: scene time when the frame was enqueued for send
- `capture_ts_robot` (optional): Lens capture time mapped to bridge/robot wall
  clock via connect-time ping/pong; required for exact frame↔odom pairing on
  current bridges
- The XR client must re-send `camera_info` before the first `camera_frame` whose
  JPEG dimensions differ from the previous stage/mode so the bridge can replace
  the active intrinsics before decoding the new stream or still resolution.
- The bridge detects robot-mounted AprilTags in the JPEG and estimates
  `T_world_odom` while a registration session is active, then continues to consume
  post-registration runtime frames for drift correction from the same
  robot-mounted tag. Runtime correction does not require robot-camera
  visibility of the tag; Spectacles frames are the only camera input.

### `nav_goal`

World-frame navigation goal:

```json
{
  "type": "nav_goal",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "position": [x, y, z],
  "orientation": [qx, qy, qz, qw]
}
```

`orientation` is optional. If omitted, the bridge may route the goal through a
point-based navigation path.

### `plan_path`

Request a preview path to a world-frame target without moving the robot:

```json
{
  "type": "plan_path",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "position": [x, y, z],
  "orientation": [qx, qy, qz, qw]
}
```

`orientation` is optional. Preview planning is side-effect free: it must never
start navigation or change the robot state.

### `cancel_goal`

Cancel the active navigation goal.

### `ping` / `pong`

Connect-time clock sync (Lens → bridge). The Lens sends several `ping`
messages after `hello`; the bridge replies immediately with `pong`:

```json
{ "type": "ping", "ts": 1730000000.123, "robot_id": "unitree_go2", "client_ts": 1730000000.100 }
```

```json
{
  "type": "pong",
  "ts": 1730000000.125,
  "robot_id": "unitree_go2",
  "client_ts": 1730000000.100,
  "bridge_ts": 1730000000.124
}
```

`bridge_ts` is `time.time()` on the bridge when the ping is received. The Lens
uses median RTT-adjusted offset to populate `capture_ts_robot` on `camera_frame`.

### `emergency_stop`

Request immediate stop through whatever safe stop path the active adapter
provides. If the capability is disabled in `hello`, clients should not send it.

## Removed Legacy Flow

The legacy `register` / `registered` message flow is removed from `dimos-ar`.
Frame registration is driven by `registration_*` messages plus `registration_status`
and `bridge_status.registered`.

## Changelog

### v5 (current) — Registration domain redesign

**Breaking changes** — monorepo clients must be updated in the same release:

- **Removed:** all `align_*`, `assist_confirm`, and `align_status` messages.
- **Added:** `registration_start`, `registration_action`, `registration_stop`,
  `registration_commit`, `registration_pose`, and `registration_status`.
- **Capabilities:** `align`, `align_manual`, `align_assist` replaced by
  `registration_april_odom_baseline` and `registration_manual_pose`.
- **`registration_start.mode`:** `"april_odom_baseline"` or `"manual_pose"`.
- **`registration_status`:** `phase`, `capture`, `message`, optional `motion`
  (safety hints: direction, distance_m, waypoint_index/total), optional
  `tag_visible` and `preview_pose`. No `progress` field.
- **Bridge owns baseline recipe:** client sends `registration_action:
  authorize_motion`; bridge publishes structured `motion` hints during strafe.
- **`bridge_status.registration_method`** now uses the same strings as
  `registration_start.mode` (`"april_odom_baseline"` / `"manual_pose"`), replacing
  the v4 `"tag"` / `"manual"` shorthand.
- **`hello.robot.registration_profile`** replaces `alignment_profile`; the
  `method` field uses `"april_odom_baseline"` instead of `"tag"`.

### v4 — Protocol shrink + alignment session semantics (superseded by v5)

**Breaking changes** — clients built against v3 must be updated:

- **`hello.capabilities`** is now a flat map `{ name → { available, reason } }`.
  The parallel `disabled_capabilities` array and `capability_states` object are
  removed.
- **`align_start`** now requires a `method` field (`"tag"` or `"manual"`). A
  message without `method` is rejected by the bridge.
- **`align_status`** is stripped to `ts`, `robot_id`, `method`, `state`,
  `progress`, `message`, and optional `tag_visible`. The removed fields are:
  `tag_detected`, `observation_count`, `baseline_m`, `quality`, `best_quality`,
  `has_candidate`, `cluster_size`, `required_samples`.
  Optional assist fields added: `assist_stage`, `robot_world_pose`, `step_index`,
  `step_count`. `state` values are `detecting`, `ready`, `aligned`, `failed`
  (stale values `idle`, `converging`, `committed`, `cancelled` removed).
- **`camera_frame_ack`** is stripped to `ts`, `robot_id`, `seq`. The removed
  fields are: `tag_detected`, `tag_ids`, `quality`.
- **`bridge_status.registration_method`** and
  **`bridge_status.registration_approximate`** are now **always present** (they
  were previously optional / omitted before first registration).

**Alignment session semantics fix**:
A bug in v3 caused `on_align_manual_pose` to accept poses even when no manual
session was open (or when a tag session was open). In v4 the bridge tracks an
explicit `_session_method` and silently drops manual pose messages unless a
`method="manual"` session is active.

**Additive runtime telemetry**:
- `pose_correction` is emitted when the bridge commits a runtime tag-based
  world-to-odom correction that exceeds the notification deadband (≥ 5 cm
  translation or ≥ 1° yaw), so Lens clients can observe meaningful drift
  magnitude and whether yaw was corrected by a full solve.  Sub-threshold
  micro-refinements remain silent.

### v3 — XR Bridge PR refactor (additive, backward-compatible)

The PR that introduced per-robot adapters (`go2` / `g1`), DimOS TF publication,
`PointCloud2` delegation, `mypy strict`, and launcher restructuring is
**backward-compatible**: all existing message types, field names, and semantics
are preserved. Clients built against any prior version of protocol v3 continue
to work without modification.

Additive wire changes (new optional fields; existing fields unchanged):

- `hello.robot.alignment_profile` (v3–v4) was renamed to
  `hello.robot.registration_profile` in v5. Clients that ignore unknown fields are
  unaffected.
- The `bridge_status.registration_approximate` field is now **always present**
  (`true` or `false`), previously only emitted when `true`. Clients must
  tolerate both its presence and absence as specified.

Server-side only (invisible on the wire):

- `ARBridgeConfig` tag geometry fields (`tag_aruco_dictionary`, `tag_total_size_m`,
  `tag_black_size_m`) are server-side configuration only.
