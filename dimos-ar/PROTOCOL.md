# Protocol — dimos-ar WebSocket message schema

This is the cross-platform contract between the DimOS-side AR bridge and any AR
client. It is the real API of this project.

Keep this document, `dimos/ar/network/protocol.py`, and
`lens-studio/Assets/Scripts/ARBridge/Network/Protocol.ts` in sync. Bump
`PROTOCOL_VERSION` on breaking changes.

## Changelog

### v15 (current) — Observation-driven capture and anchored stop refinement

**Breaking changes** — monorepo clients must be updated in the same release:

- **`PROTOCOL_VERSION` is 15.**
- **`camera_frame_ack`:** adds required **`obs_added`** and **`refinement_complete`**
  (`bool`) fields. The latter is true only when the bridge committed the single
  refinement for the current motion-to-stop episode.
- **`capture_policy`** (new, bridge → Lens): sent after the first **`camera_info`**;
  carries **`max_stream_distance_m`**, **`min_stream_distance_m`**,
  **`max_capture_speed_mps`**, **`static_speed_mps`**, and **`min_observations`**.

### v14 — Persistent similarity alignment telemetry

**Breaking changes** — monorepo clients must be updated in the same release:

- **`PROTOCOL_VERSION` is 14.**
- **`world_frame_correction`:** adds optional **`scale_confidence`**, **`yaw_confidence`**,
  **`scale_held`**, and **`yaw_held`**. `scale_held` / `yaw_held` are `true` when the
  bridge held that DOF this window because observability was insufficient.
- **`registration_status`:** adds optional **`scale_confidence`** and **`scale_locked`**
  (`true` when scale confidence meets the bridge lock threshold).

### v13 — Camera stream lifecycle

**Breaking changes** — monorepo clients must be updated in the same release:

- **`PROTOCOL_VERSION` is 13.**
- **`registration_status`:** removed **`capture`** field. The Lens client owns
  camera stream start/stop and geometric gating locally; the bridge no longer
  emits capture hints.

### v12 — Similarity aligner registration

**Breaking changes** — monorepo clients must be updated in the same release:

- **`PROTOCOL_VERSION` is 12.**
- **`world_frame_correction.solve_method`:** may now be **`"similarity"`** in
  addition to legacy **`"apriltag_full"`** and **`"apriltag_translation"`**.
- **`world_frame_correction`:** adds **`alignment_confidence`**,
  **`yaw_observable`**, and **`scale_observable`**.
- **`registration_status`:** adds optional **`alignment_confidence`** and
  **`refining`**. During scanning, `alignment_confidence` reflects registration
  estimate quality (Spectacles/camera motion around a static robot). After
  commit, `refining` indicates post-commit runtime polish on the wire; clients
  may ignore it for wizard UX.

### v11 — Navigation simplification

**Breaking changes** — monorepo clients must be updated in the same release:

- **`PROTOCOL_VERSION` is 11.**
- **`nav_goal`:** removed **`intent`**; every `nav_goal` starts navigation. Preview
  planning is removed from the wire protocol.
- **`path`:** removed **`kind`** and **`target`**; paths are active navigation routes
  only.
- **`hello.capabilities`:** removed **`plan_preview`**.
- Removed outbound **`nav_goal_update`** and optional **`runtime_snapshot.goal`**
  (v9 goal provenance).

### v10 — AprilTag-only registration

**Breaking changes** — monorepo clients must be updated in the same release:

- **`PROTOCOL_VERSION` is 10.**
- Registration mode **`april_odom_baseline`** renamed to **`april_tag`**; capability
  **`registration_april_odom_baseline`** renamed to **`registration_april_tag`**.
- **`registration_command`:** removed **`authorize_motion`**; commands are now
  **`start`**, **`stop`**, and **`commit`** only.
- **`registration_status`:** removed **`motion`** field and leg phases
  (`awaiting_motion`, `moving`, `sampling`). AprilTag registration auto-commits
  when tag observations are stable; phases are `idle`, `scanning`, `editing`,
  `awaiting_commit`, `succeeded`, `failed`.
- **`registration_status.capture`:** removed **`hold`** hint (v10; field removed entirely in v13).
- **`world_frame_method`:** committed method literal is now **`april_tag`**
  (was `april_odom_baseline`).

### v9 — Navigation goal provenance

**Additive changes** — v8 clients ignore unknown outbound types:

- **`PROTOCOL_VERSION` is 9.**
- New outbound broadcast **`nav_goal_update`** (`source`, `position`, `orientation`, `active`).
- **`runtime_snapshot`** gains optional **`goal`** mirroring active `nav_goal_update` body.

### v8 — Motion pipeline vocabulary alignment

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

### v3 — dimos-ar bridge PR refactor (additive, backward-compatible)

Per-robot profile modules, DimOS TF publication, and additive optional fields. Clients
built against prior v3 wire shapes continue to work without modification.

## Transport

- Plain WebSocket. The Mac runs the server; AR devices connect as clients.
- Most messages are JSON text frames. High-resolution camera stills use a binary
  `camera_frame` envelope (see below). LiDAR uses a binary `lidar_f16` frame
  (see below).
- Every JSON message is a JSON object with a `type` field.
- Inbound and outbound coordinates use the AR world frame. The bridge converts
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
  "protocol_version": 12,
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
    "registration_april_tag":   { "available": true,  "reason": null },
    "registration_manual_pose":           { "available": true,  "reason": null },
    "nav":                                { "available": true,  "reason": null },
    "path":                               { "available": true,  "reason": null },
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

Optional field emitted when the active robot profile provides tag geometry for
registration. Absent or `null` when the profile does not supply one.

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
`bridge_status`, the current navigation phase, and an optional cached path when
navigation is in progress.

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
- `path` (optional): present only when a navigating path is cached; omitted when
  idle

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
- `world_frame_method`: **always present** — `"april_tag"`,
  `"manual_pose"`, or `null` when uncommitted
- `world_frame_approximate`: **always present** — `true` when the committed
  alignment is approximate (e.g. manual pose)

### `registration_status`

Registration progress during a setup session:

```json
{
  "type": "registration_status",
  "ts": 1730000000.123,
  "mode": "april_tag",
  "phase": "scanning",
  "message": "Look at the AprilTag on your robot",
  "tag_visible": true,
  "progress": 40,
  "alignment_confidence": 0.42,
  "refining": false,
  "scale_confidence": 0.0,
  "scale_locked": false,
  "preview_pose": {
    "position": [1.2, 0.0, -2.0],
    "orientation": [0.0, 0.0, 0.383, 0.924]
  }
}
```

Fields:

- `mode` (optional): `"april_tag"` or `"manual_pose"` — matches
  `registration_command.mode` when a session is active
- `phase`: one of `"idle"`, `"scanning"`, `"editing"`, `"awaiting_commit"`,
  `"succeeded"`, `"failed"`
- `message`: human-readable status string for display in the client HUD
- `tag_visible` (optional): present for AprilTag sessions; `true` when a
  configured robot-mounted tag was detected in the most recent processed frame
- `preview_pose` (optional): estimated robot pose in world frame (`position` xyz
  metres, `orientation` quaternion xyzw); omitted until a solve is available
- `progress` (optional): AprilTag registration progress **0–100**; present while
  `mode` is `"april_tag"` during `scanning` and `succeeded`. Reflects
  registration readiness (observation count blended with
  `alignment_confidence`), not raw frame count alone. Clients should display
  this value directly rather than inferring progress from `message`.
- `alignment_confidence` (optional): bridge-computed confidence **0–1** for the
  current registration or runtime alignment estimate
- `refining` (optional): after AprilTag commit, `true` while the bridge keeps
  refining alignment from continued tag observations at runtime (wire field;
  clients may ignore for wizard UX)
- `scale_confidence` (optional): bridge-computed confidence **0–1** for the
  persistent odom scale estimate
- `scale_locked` (optional): `true` when scale confidence meets the bridge lock
  threshold (scale has converged)

During AprilTag registration (`mode: "april_tag"`), the robot stays still. The
Spectacles user moves around the robot while keeping the tag in view; camera
motion provides yaw observability. The bridge auto-commits when the
registration estimate meets the confidence threshold (or yaw is observable).
If confidence never rises within the registration window, `phase` becomes
`"failed"`. After commit, the bridge may continue broadcasting `refining: true`
while runtime similarity refinement continues from tag observations during
navigation. The client auto-finishes the wizard on `phase: "succeeded"`; no
separate commit message is required.

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
  "seq": 42,
  "obs_added": true,
  "refinement_complete": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `obs_added` | `boolean` | `true` when the bridge accepted at least one tag observation from this frame |
| `refinement_complete` | `boolean` | `true` when the bridge committed the current stop-refinement episode |

### `capture_policy`

Bridge → Lens. Sent once after the first **`camera_info`** for the session. The Lens
uses these thresholds for geometric and speed gating; it does not derive them locally.

```json
{
  "type": "capture_policy",
  "ts": 1730000000.123,
  "max_stream_distance_m": 2.5000,
  "min_stream_distance_m": 0.3500,
  "max_capture_speed_mps": 0.4500,
  "static_speed_mps": 0.0500,
  "min_observations": 3
}
```

| Field | Type | Description |
|-------|------|-------------|
| `max_stream_distance_m` | `number` | Maximum camera–robot distance for capture: pinhole estimate from intrinsics, 70 mm printed tag size, and minimum tag pixel floor, then scaled by bridge headroom (default 25%). Same limit applies to bridge frame admission after `camera_info`. |
| `min_stream_distance_m` | `number` | Minimum camera–robot distance for capture |
| `max_capture_speed_mps` | `number` | Do not capture while robot speed exceeds this |
| `static_speed_mps` | `number` | Speed threshold shared with the bridge for static vs moving (Lens arms stop-refinement on the stop edge) |
| `min_observations` | `integer` | Bridge `ALIGN_MIN_OBS`; minimum accepted static endpoint observations before a stop solve |

### Numeric precision (outbound)

Bridge encoders round world-frame floats before JSON serialization to reduce
payload size on Wi-Fi:

| Field | Decimal places |
|-------|----------------|
| `pose.position`, `pose.orientation` | 4 |
| `world_frame_correction.trans_delta_m`, `world_frame_correction.solve_quality` | 4 |
| `world_frame_correction.yaw_delta_deg` | 3 |
| `capture_policy.max_stream_distance_m`, `capture_policy.min_stream_distance_m`, `capture_policy.max_capture_speed_mps` | 4 |
| `path` waypoints | 3 |
| `ts` on high-rate streams (`pose`, `path`) | 3 |

### `lidar` (binary)

Subsampled point cloud in AR world frame, sent as a **binary WebSocket frame**
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

Robot pose in AR world frame:

```json
{
  "type": "pose",
  "ts": 1730000000.123,
  "position": [x, y, z],
  "orientation": [qx, qy, qz, qw],
  "speed_mps": 0.42,
  "velocity_mps": [vx, vy, vz],
  "yaw_rate_rad_s": 0.35
}
```

- `speed_mps` (optional): smoothed robot linear speed in m/s from bridge odom,
  used by the Lens for runtime camera stream requests when the robot stops.
- `velocity_mps` (optional): world-frame linear velocity in m/s (same axes as
  `position`). Used by the Lens for client-side pose prediction.
- `yaw_rate_rad_s` (optional): world-frame yaw rate in rad/s about the world-up
  axis. Used by the Lens for client-side pose prediction during turns.

`pose.ts` and `world_frame_correction.ts` use bridge/robot wall-clock seconds
(the same domain as robot odometry production timestamps), not Lens scene time.

On the Spectacles client, `RobotMarker` extrapolates position and yaw between
`pose` updates from `velocity_mps` and `yaw_rate_rad_s`, with displacement clamps
to limit runaway prediction when updates are delayed.

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
  "yaw_corrected": true,
  "solve_quality": 0.9521,
  "solve_method": "similarity",
  "alignment_confidence": 0.81,
  "yaw_observable": true,
  "scale_observable": true,
  "scale_confidence": 0.72,
  "yaw_confidence": 0.81,
  "scale_held": false,
  "yaw_held": false
}
```

Fields:

- `trans_delta_m`: translation magnitude before the correction commit, in metres
- `yaw_delta_deg` (optional): yaw magnitude before the correction commit, in degrees
- `yaw_corrected`: `true` when the correction can safely update yaw; for the
  similarity aligner this mirrors `yaw_observable`
- `solve_quality`: quality score reported by the tracker for the committed solve
- `solve_method`: `"similarity"`, `"apriltag_full"`, or `"apriltag_translation"`
- `alignment_confidence` (optional): bridge-computed confidence **0–1** for the
  active similarity fit
- `yaw_observable` (optional): `true` when the current observation geometry
  supports yaw correction
- `scale_observable` (optional): `true` when the current observation geometry
  supports scale correction
- `scale_confidence` (optional): bridge-computed confidence **0–1** for the
  persistent scale estimate
- `yaw_confidence` (optional): bridge-computed confidence **0–1** for the
  persistent yaw estimate
- `scale_held` (optional): `true` when scale was held this window (insufficient
  translational baseline)
- `yaw_held` (optional): `true` when yaw was held this window (insufficient
  yaw observability baseline)

Bridge-side refinement (not additional wire fields):

- On commit, the bridge locks robot base floor height (world Y) for flat-ground
  profiles and applies a single similarity aligner over tag-observation windows.
- A floor-Y shim may correct sustained vertical drift without emitting this message.
- See `dimos/ar/world_frame/aligner.py` and `dimos/ar/world_frame/refinement.py`
  for thresholds and gating.

### `path`

Active planner path in AR world frame:

```json
{
  "type": "path",
  "ts": 1730000000.123,
  "waypoints": [[x, y, z]]
}
```

Fields:

- `waypoints`: route in AR world frame; may be empty when no path is available

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
  "obstacle_opaque_distance_m": 0.50,
  "obstacle_max_distance_m": 0.80
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
- `full`: the bridge sends the standard full AR payload path

### `registration_command`

Unified registration session control. Replaces the v5
`registration_start` / `registration_action` / `registration_stop` /
`registration_commit` messages.

Start an AprilTag registration session:

```json
{
  "type": "registration_command",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "command": "start",
  "mode": "april_tag"
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

- `command` (**required**): `"start"`, `"stop"`, or `"commit"`
- `mode` (**required when `command` is `"start"`**): `"april_tag"` or
  `"manual_pose"`. Must be omitted for all other commands. Requires the
  matching capability (`registration_april_tag` or `registration_manual_pose`)
  to be available in `hello`.

AprilTag registration auto-commits when the registration estimate is confident
enough (or yaw is observable); the client does not send a separate commit for
that flow. Keep the robot still and move Spectacles around it for observability.

### `registration_pose`

Manual robot pose estimate from the AR client during a `manual_pose` session:

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

1. Magic `ARF1` (4 bytes)
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
- The AR client must re-send `camera_info` before the first `camera_frame` whose
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

Fields:

- `position` (**required**): world-frame goal position `[x, y, z]` in metres
- `orientation` (optional): world-frame quaternion `[x, y, z, w]`; if omitted,
  the bridge may route through a point-based navigation path

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

Request immediate stop through whatever safe stop path the active robot profile
provides via `MotionRouter`. If the capability is disabled in `hello`, clients should not send it.

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
