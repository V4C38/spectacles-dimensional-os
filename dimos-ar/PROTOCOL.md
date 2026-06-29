# Protocol — dimos-ar WebSocket message schema

This is the cross-platform contract between the DimOS-side AR bridge and any AR
client. It is the real API of this project.

Keep this document, `dimos/ar/network/protocol.py`, and
`lens-studio/Assets/Scripts/ARBridge/Network/Protocol.ts` in sync. Bump
`PROTOCOL_VERSION` on breaking changes.

## Changelog

### v8 (current) — Motion pipeline vocabulary alignment

**Breaking changes** — monorepo clients must be updated in the same release:

- **`PROTOCOL_VERSION` is 8.**
- **`goal`** wire type renamed to **`nav_goal`** (`intent: "navigate" | "preview"` unchanged).
- **`cancel_goal`** wire type renamed to **`cancel_nav_goal`**.
- **`hello.capabilities`:** `cancel_goal` → `cancel_nav_goal`.
- Lens **`AppPhase` / `OperatingMode` / `CaptureMode`:** literal `"setup"` → `"registration"`.
- Adapter RPC **`baseline_set_lateral_velocity(vy)`** → **`send_joystick_command(vx, vy, wz)`**
  (stick deflection in [-1, 1]; `cmd_vel` port name unchanged).

### v7 — World-frame naming alignment

**Breaking changes** — monorepo clients must be updated in the same release:

- **`PROTOCOL_VERSION` is 7.**
- **`bridge_status` / `runtime_snapshot.bridge`:** `registered` →
  `world_frame_committed`; `registration_method` → `world_frame_method`;
  `registration_approximate` → `world_frame_approximate`.
- **`hello.robot`:** `registration_profile` → `tag_tracking_profile` (same
  `{ tag_ids, tag_total_size_m }` shape).
- **`pose_correction`** message renamed to **`world_frame_correction`** (payload
  fields unchanged).
- **`nav_status` (additive):** on stall recovery, bridge may emit
  `retryable: true` and `stall_reason: "no_path" | "planner_idle"`. Clients
  must retry navigation manually; the bridge no longer auto-dispatches recovery
  goals.

**Persistence:** committed world frame survives client disconnect for the bridge
process lifetime (unchanged behavior, now explicit).

### v6 — Session-scoped identity and message consolidation

**Breaking changes** — monorepo clients must be updated in the same release:

- **`PROTOCOL_VERSION` is 6.**
- **Session robot from `hello`:** most outbound JSON messages omit `robot_id`.
  Inbound messages still carry `robot_id` and are validated against the session
  robot from `hello`. Binary LiDAR frames carry no `robot_id`.
- **`hello.robot`:** `robot_model` removed. `registration_profile` is
  `{ tag_ids, tag_total_size_m }` only (no `method` field).
- **`runtime_snapshot`:** sent on connect and in response to `get_status` —
  bundles `bridge`, `nav`, and an optional **active** `path`. Preview paths are
  not cached in snapshots.
- **`registration_command`:** replaces `registration_start`,
  `registration_action`, `registration_stop`, and `registration_commit` with a
  single message and `command` enum (`start`, `authorize_motion`, `stop`,
  `commit`). `mode` is required only when `command` is `start`.
- **`goal`:** replaces `nav_goal` and `plan_path` with `intent`:
  `"navigate"` or `"preview"`.
- **`path`:** unified message with `kind` `"active"` or `"preview"`. The
  separate `path_preview` type is removed; preview paths include optional
  `target`.
- **`nav_status`:** `phase` enum only (`idle`, `navigating`, `recovering`,
  `succeeded`, `failed`). Removed: `state`, `goal_reached`, `goal_failed`,
  `recovering` boolean.
- **`bridge_status` (live):** omits `robot_id` and `streams_active`.
- **Lean outbound payloads:** `registration_status`, `pose`, `path`,
  `pose_correction`, and `camera_frame_ack` omit `robot_id` and `frame`.
- **LiDAR:** binary-only (`lidar_f16`); JSON `lidar` removed.
- **`set_lidar_mode`:** obstacle distance fields required only when
  `mode` is `"obstacles"`.
- **`pose_correction.solve_method`:** `"apriltag_full"` or
  `"apriltag_translation"` (replaces `"tag"` / `"tag_translation"`).

### v5 — Registration domain redesign (superseded by v6)

- Removed all `align_*`, `assist_confirm`, and `align_status` messages.
- Added registration session messages (now consolidated into
  `registration_command` in v6).
- Capabilities: `registration_april_odom_baseline` and
  `registration_manual_pose`.
- `hello.robot.registration_profile` replaced `alignment_profile`.

### v4 — Protocol shrink + alignment session semantics (superseded)

- Flat `hello.capabilities` map; `align_start` requires `method`.
- Stripped `camera_frame_ack` to `ts` + `seq`.
- `bridge_status.registration_method` and `registration_approximate` always
  present. Superseded in v7 by `world_frame_method` and
  `world_frame_approximate` (see v7 changelog).

### v3 — XR Bridge PR refactor (additive, backward-compatible)

Per-robot adapters, DimOS TF publication, and additive optional fields. Clients
built against prior v3 wire shapes continue to work without modification.

## Transport

- Plain WebSocket. The Mac runs the server; XR devices connect as clients.
- Most messages are JSON text frames. High-resolution camera stills use a binary
  `camera_frame` envelope (see below). LiDAR uses a binary `lidar_f16` frame
  (see below).
- Every JSON message is a JSON object with a `type` field.
- Inbound and outbound coordinates use the XR world frame. The bridge converts
  world-frame goals and registration poses into robot odom coordinates.
- The active session robot is declared once in `hello.robot.robot_id`. Inbound
  messages must carry a matching `robot_id`. Most outbound JSON messages omit
  `robot_id`; exceptions are `hello`, `runtime_snapshot`, and `pong`.
- **Text framing:** every outbound JSON text frame from the bridge ends with a
  single newline (`\n`). The client accumulates incoming text and splits on
  `\n` to recover complete messages when the platform delivers one JSON object
  across multiple WebSocket callbacks. Binary frames (LiDAR, `camera_frame`) are
  not newline-delimited.

## Handshake

On connect, the server sends `hello` with the active robot metadata and a flat
capability map, then sends a `runtime_snapshot` (see below).

```json
{
  "type": "hello",
  "protocol_version": 6,
  "robot": {
    "robot_id": "unitree_go2",
    "display_name": "Unitree Go2",
    "body_bounds_m": [0.7, 0.5, 0.55],
    "footprint_m": [0.7, 0.5],
    "visual_origin_frame": "base_link",
    "base_height_m": 0.33,
    "default_render_offset_m": [0.0, 0.0, 0.0],
    "tag_tracking_profile": {
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
    "cancel_nav_goal":                        { "available": true,  "reason": null },
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

### `hello.robot.tag_tracking_profile`

Optional field emitted when the robot adapter provides tag geometry for
registration. Absent or `null` when the adapter does not supply one.

| Field | Type | Description |
|-------|------|-------------|
| `tag_ids` | `number[]` | AprilTag IDs physically mounted on this robot |
| `tag_total_size_m` | `number` | Outer edge size of each printed tag in metres |

Example (Unitree Go2 / G1):

```json
{
  "tag_ids": [0],
  "tag_total_size_m": 0.070
}
```

## Outbound Messages

### `runtime_snapshot`

Authoritative bridge + navigation state sent once after `hello` on connect and
again when the client sends `get_status`. Bundles the same bridge fields as live
`bridge_status`, the current navigation phase, and an optional **active** path
when navigation is in progress. Preview paths are **not** cached — clients
that reconnect mid-preview must re-issue `nav_goal` with `intent: "preview"`.

```json
{
  "type": "runtime_snapshot",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "bridge": {
    "robot_connected": true,
    "world_frame_committed": true,
    "reconnecting": false,
    "world_frame_method": "manual_pose",
    "world_frame_approximate": false
  },
  "nav": {
    "phase": "navigating"
  },
  "path": {
    "kind": "active",
    "waypoints": [[1.0, 2.0, 3.0]]
  }
}
```

Fields:

- `robot_id`: session robot (same as `hello.robot.robot_id`)
- `bridge`: same shape as live `bridge_status` (without `type` / `ts`)
- `nav.phase`: one of `"idle"`, `"navigating"`, `"recovering"`, `"succeeded"`,
  `"failed"`
- `nav.error_code` (optional): numeric code when navigation is unavailable
  (e.g. `505` = goal stalled)
- `path` (optional): present only when an active navigating path is cached;
  always `kind: "active"`. Omitted when idle or when only a preview exists.

### `bridge_status`

Dynamic bridge/runtime state broadcast when registration or connection flags
change. Does **not** include `robot_id` or `streams_active`.

```json
{
  "type": "bridge_status",
  "ts": 1730000000.123,
  "robot_connected": true,
  "world_frame_committed": false,
  "reconnecting": false,
  "world_frame_method": "manual_pose",
  "world_frame_approximate": true
}
```

Fields:

- `robot_connected`: bridge has an active robot/runtime data path
- `world_frame_committed`: world-frame alignment has been committed
- `reconnecting`: reconnect/recovery is in progress
- `world_frame_method`: **always present** — `"april_odom_baseline"`,
  `"manual_pose"`, or `null` when uncommitted
- `world_frame_approximate`: **always present** — `true` when the committed
  alignment is approximate (e.g. manual pose)

### `registration_status`

Registration progress during a setup session:

```json
{
  "type": "registration_status",
  "ts": 1730000000.123,
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

- `mode` (optional): `"april_odom_baseline"` or `"manual_pose"` — matches
  `registration_command.mode` when a session is active
- `phase`: one of `"idle"`, `"scanning"`, `"awaiting_motion"`, `"moving"`,
  `"sampling"`, `"editing"`, `"awaiting_commit"`, `"succeeded"`, `"failed"`
- `capture`: camera capture hint for the client — `"off"`, `"steady"`, `"burst"`,
  or `"hold"`
- `message`: human-readable status string for display in the client HUD
- `tag_visible` (optional): present for AprilTag baseline sessions; `true` when
  a configured robot-mounted tag was detected in the most recent processed frame
- `motion` (optional): structured safety hint during baseline strafe — `frame`
  (`"robot"`), `axis` (`"lateral"`), `direction` (`"left"` | `"right"`),
  `distance_m`, `waypoint_index`, `waypoint_total`. `distance_m` is indicative
  for UX; Go2 baseline legs are time-controlled at the bridge, not odom-gated.
- `preview_pose` (optional): estimated robot pose in world frame (`position` xyz
  metres, `orientation` quaternion xyzw); omitted until a solve is available

During baseline **leg motion** (`phase: "moving"`), the bridge emits
`capture: "steady"` (~1 frame/s) so tag tracking and `preview_pose` updates
continue. `"hold"` remains in the enum for future use but is not used during
baseline strafe. **Sampling** at each waypoint uses `capture: "burst"` (~2/s).

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
  "seq": 42
}
```

### Numeric precision (outbound)

Bridge encoders round world-frame floats before JSON serialization to reduce
payload size on Wi-Fi:

| Field | Decimal places |
|-------|----------------|
| `pose.position`, `pose.orientation` | 4 |
| `world_frame_correction.trans_delta_m`, `world_frame_correction.solve_quality` | 4 |
| `world_frame_correction.yaw_delta_deg` | 3 |
| `path` waypoints and `target` | 3 |
| `ts` on high-rate streams (`pose`, `path`) | 3 |

### `lidar` (binary)

Subsampled point cloud in XR world frame, sent as a **binary WebSocket frame**
(message type `0x01 lidar_f16`). Each point is encoded as three IEEE 754
half-precision (float16) values, little-endian. Up to 2500 points per frame.
Binary frames carry **no** `robot_id`; the session robot comes from `hello`.

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

### `pose`

Robot pose in XR world frame:

```json
{
  "type": "pose",
  "ts": 1730000000.123,
  "position": [x, y, z],
  "orientation": [qx, qy, qz, qw],
  "speed_mps": 0.42
}
```

- `speed_mps` (optional): smoothed robot linear speed in m/s from bridge odom,
  used by the Lens for runtime static capture burst when the robot stops.

### `world_frame_correction`

Runtime world-frame correction telemetry emitted when the bridge commits a
tag-driven world-to-odom correction **that exceeds the notification deadband**
(≥ 5 cm translation or ≥ 1° yaw). Sub-threshold micro-refinements still update
`T_world_odom` on the bridge but do not emit this message, so Lens-side
user-visible events (e.g. "Refined Tracking" toast, realignment snap animation)
fire only when the robot position has meaningfully changed:

```json
{
  "type": "world_frame_correction",
  "ts": 1730000000.123,
  "trans_delta_m": 0.1824,
  "yaw_delta_deg": 6.137,
  "yaw_corrected": false,
  "solve_quality": 0.9521,
  "solve_method": "apriltag_translation"
}
```

Fields:

- `trans_delta_m`: translation magnitude before the correction commit, in metres
- `yaw_delta_deg` (optional): yaw magnitude before the correction commit, in degrees
- `yaw_corrected`: `true` when the correction came from a full
  `apriltag_full` solve that can update yaw; `false` for
  `apriltag_translation` fallback solves
- `solve_quality`: quality score reported by the tracker for the committed solve
- `solve_method`: `"apriltag_full"` or `"apriltag_translation"`

### `path`

Planner path in XR world frame. The `kind` field distinguishes the active
navigation route from an on-demand preview:

```json
{
  "type": "path",
  "ts": 1730000000.123,
  "kind": "active",
  "waypoints": [[x, y, z]]
}
```

Preview path (from `goal` with `intent: "preview"`):

```json
{
  "type": "path",
  "ts": 1730000000.123,
  "kind": "preview",
  "waypoints": [[x, y, z]],
  "target": [x, y, z]
}
```

Fields:

- `kind`: `"active"` for the navigating route, `"preview"` for an unconfirmed
  target
- `waypoints`: route in XR world frame; may be empty when no path is available
- `target` (preview only): echoed world-frame target so the client can ignore
  stale responses

### `nav_status`

Navigation lifecycle updates:

```json
{
  "type": "nav_status",
  "ts": 1730000000.123,
  "phase": "navigating"
}
```

`phase` is one of `"idle"`, `"navigating"`, `"recovering"`, `"succeeded"`,
`"failed"`.

Optional fields:

- `error_code`: numeric code when navigation is unavailable for the session
  (logged on the Lens; `505` = goal stalled).
- `retryable` (v7): `true` when the bridge cancelled a stuck goal and the client
  must manually retry; emitted with `phase: "recovering"`.
- `stall_reason` (v7): `"no_path"` (watchdog timeout without path) or
  `"planner_idle"` (planner went idle before path arrived).

When `retryable` is true, `"recovering"` indicates the bridge cleared a stuck
goal — return to a retryable placing state without treating it as terminal failure.

## Inbound Messages

All inbound JSON messages require `type`, `ts`, and `robot_id` (matching the
session robot from `hello`).

### `get_status`

```json
{
  "type": "get_status",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2"
}
```

The bridge responds with a single `runtime_snapshot` for the requesting client
(same message sent automatically after `hello` on connect).

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
- `obstacle_min_distance_m`, `obstacle_opaque_distance_m`,
  `obstacle_max_distance_m`: **required only when `mode` is `"obstacles"`**.
  When `mode` is `"off"` or `"full"`, these fields must be omitted.

Semantics (obstacle distances):

- `obstacle_min_distance_m`: robot-relative horizontal distance where obstacle
  rendering/filtering begins
- `obstacle_opaque_distance_m`: distance where the client starts fading obstacle
  points; must be greater than or equal to `obstacle_min_distance_m`
- `obstacle_max_distance_m`: farthest robot-relative horizontal distance that
  obstacle mode keeps; must be greater than or equal to
  `obstacle_opaque_distance_m`

Bridge semantics by mode:

- `off`: the bridge suppresses LiDAR transmission entirely
- `obstacles`: the bridge sends only points inside the configured obstacle
  distance annulus after its normal height/range filtering
- `full`: the bridge sends the standard full XR payload path

### `registration_command`

Unified registration session control. Replaces the v5
`registration_start` / `registration_action` / `registration_stop` /
`registration_commit` messages.

Start an AprilTag baseline session:

```json
{
  "type": "registration_command",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "command": "start",
  "mode": "april_odom_baseline"
}
```

Start a manual pose session:

```json
{
  "type": "registration_command",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "command": "start",
  "mode": "manual_pose"
}
```

Authorize baseline strafe motion (AprilTag flow only):

```json
{
  "type": "registration_command",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "command": "authorize_motion"
}
```

Stop/cancel the current registration session. When no registration session is
active, `stop` is a no-op for committed world frame (`bridge_status.world_frame_committed`
and the world→odom transform are unchanged). To replace registration, start a
new session and commit again.

```json
{
  "type": "registration_command",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "command": "stop"
}
```

Commit manual pose registration:

```json
{
  "type": "registration_command",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "command": "commit"
}
```

Fields:

- `command` (**required**): `"start"`, `"authorize_motion"`, `"stop"`, or
  `"commit"`
- `mode` (**required when `command` is `"start"`**): `"april_odom_baseline"` or
  `"manual_pose"`. Must be omitted for all other commands. Requires the
  matching capability (`registration_april_odom_baseline` or
  `registration_manual_pose`) to be available in `hello`.

The bridge **MUST NOT** issue baseline strafe motion before receiving
`registration_command` with `command: "authorize_motion"` for the current
session.

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

World-frame navigation or preview request:

Navigate (replaces v5 `nav_goal`):

```json
{
  "type": "nav_goal",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "intent": "navigate",
  "position": [x, y, z],
  "orientation": [qx, qy, qz, qw]
}
```

Preview path only (replaces v5 `plan_path`):

```json
{
  "type": "nav_goal",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "intent": "preview",
  "position": [x, y, z],
  "orientation": [qx, qy, qz, qw]
}
```

Fields:

- `intent` (**required**): `"navigate"` to start navigation, or `"preview"` to
  request a side-effect-free preview path (`path` with `kind: "preview"`)
- `orientation` (optional): if omitted, the bridge may route through a
  point-based navigation path

Preview planning must never start navigation or change robot state.

### `cancel_nav_goal`

Cancel the active navigation goal.

```json
{
  "type": "cancel_nav_goal",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2"
}
```

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

```json
{
  "type": "emergency_stop",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2"
}
```

### `joystick_command`

Drive the robot via stick deflection (no Lens UI in v8; wire compat for future
manual control). Values are raw deflection in **[-1, 1]**, not m/s.

```json
{
  "type": "joystick_command",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "vx": 0.0,
  "vy": 0.2,
  "wz": 0.0
}
```

## Removed Legacy Flow

The following v5 message types are removed in v6:

- `registration_start`, `registration_action`, `registration_stop`,
  `registration_commit` → use `registration_command`
- `nav_goal`, `plan_path` → use `goal` with `intent`
- `path_preview` → use `path` with `kind: "preview"`
- JSON `lidar` → binary `lidar_f16` only

The legacy `register` / `registered` message flow remains removed from
`dimos-ar`. Frame registration is driven by `registration_command` /
`registration_pose` plus `registration_status` and `bridge_status.world_frame_committed`.
