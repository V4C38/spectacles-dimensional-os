# Protocol — dimos-xr WebSocket message schema

This is the cross-platform contract between the DimOS-side XR bridge and any XR
client. It is the real API of this project.

Keep this document and `dimos_xr/protocol.py` in sync. Bump
`protocol_version` on breaking changes.

## Transport

- Plain WebSocket. The Mac runs the server; XR devices connect as clients.
- Most messages are JSON text frames. High-resolution camera stills use a binary
  `camera_frame` envelope (see below).
- Every JSON message is a JSON object with a `type` field.
- Inbound and outbound coordinates use the XR world frame. The bridge converts
  world-frame goals and calibration poses into robot odom coordinates.
- Every runtime message carries a single active `robot_id`.

## Handshake

On connect, the server sends `hello` with the active robot metadata and
capability surface:

```json
{
  "type": "hello",
  "protocol_version": 3,
  "robot": {
    "robot_id": "unitree_go2",
    "robot_model": "unitree_go2",
    "display_name": "Unitree Go2",
    "body_bounds_m": [0.7, 0.5, 0.55],
    "footprint_m": [0.7, 0.5],
    "visual_origin_frame": "base_link",
    "base_height_m": 0.33,
    "default_render_offset_m": [0.0, 0.0, 0.0]
  },
  "capabilities": [
    "lidar",
    "odom",
    "align",
    "align_manual",
    "nav",
    "path",
  "plan_preview",
    "cancel_goal",
    "emergency_stop"
  ],
  "disabled_capabilities": ["emergency_stop"],
  "capability_states": {
    "emergency_stop": {
      "available": false,
      "reason": "No safe stop interface is available in this runtime."
    }
  }
}
```

Rules:

- `robot` is the only static robot descriptor in the protocol.
- `capabilities` lists the full intended surface for the active runtime.
- `disabled_capabilities` and `capability_states` let the bridge expose actions
  that exist conceptually but are currently unavailable.
- Clients should render unavailable actions as disabled, not hide them silently.

### `hello.robot.alignment_profile`

Optional field emitted when the robot adapter provides alignment configuration.
Absent or `null` when the adapter does not supply one.

| Field | Type | Description |
|-------|------|-------------|
| `method` | `string` | Recommended alignment method (e.g. `"tag"`) |
| `tag_ids` | `number[]` | AprilTag IDs physically mounted on this robot |
| `tag_total_size_m` | `number` | Outer edge size of each printed tag in metres |

Example (Unitree G1):
```json
{
  "method": "tag",
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
  "registration_method": "manual",
  "registration_approximate": true
}
```

Fields:

- `robot_connected`: bridge has an active robot/runtime data path
- `streams_active`: recent lidar and odom are flowing
- `registered`: world-frame calibration has been committed
- `reconnecting`: reconnect/recovery is in progress
- `registration_method`: optional `marker` or `manual`
- `registration_approximate`: optional bool for approximate/manual calibration

### `align_status`

Alignment progress during calibration:

```json
{
  "type": "align_status",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "state": "detecting",
  "tag_detected": true,
  "observation_count": 12,
  "baseline_m": 0.42,
  "quality": 0.81,
  "best_quality": 0.95,
  "has_candidate": true,
  "method": "tag",
  "message": "Look at the robot-mounted tag"
}
```

Fields:

- `tag_detected`: bridge detected a configured robot-mounted tag in a recent frame
- `observation_count`: observations in the sliding alignment window
- `baseline_m`: max ground-plane separation between tag observations (meters)

### `camera_frame_ack`

Per-frame acknowledgement after the bridge processes a binary `camera_frame`:

```json
{
  "type": "camera_frame_ack",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "seq": 42,
  "tag_detected": true,
  "tag_ids": [0],
  "quality": 0.88
}
```

### Numeric precision (outbound)

Bridge encoders round world-frame floats before JSON serialization to reduce
payload size on Wi-Fi:

| Field | Decimal places |
|-------|----------------|
| `lidar.points_flat` | 2 |
| `pose.position`, `pose.orientation` | 4 |
| `path` / `path_preview` waypoints and `target` | 3 |
| `ts` on high-rate streams (`lidar`, `pose`, `path`, `path_preview`) | 3 |

### `lidar`

Subsampled point cloud in XR world frame:

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
  "orientation": [qx, qy, qz, qw]
}
```

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
  "state": "following_path",
  "goal_reached": false,
  "goal_failed": false
}
```

Optional fields:

- `recovering`: when `true`, the bridge cleared a stuck goal and the client should return to a retryable placing state without treating it as a terminal failure
- `error_code`: numeric XR bridge client error code when navigation is unavailable for the session (see [`ERROR_CODES.md`](ERROR_CODES.md))

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
3. `path` — last executing path when navigation is active; omitted when no
   executing path is cached

The same sync burst is sent automatically after the initial `hello` on connect.

### `align_start`

Begin a calibration session.

### `align_stop`

Stop/cancel the current calibration session.

### `align_commit`

Commit the current best alignment candidate.

### `camera_info`

Spectacles camera intrinsics for the still-capture resolution (sent once per
resolution change before binary frames):

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
  "camera_model": "perspective",
  "device_model": "spectacles"
}
```

### `camera_frame` (binary)

JPEG still plus pose metadata. Wire format:

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

- `ts`: capture time in scene seconds (`getTime()` after image await)
- `send_ts`: scene time when the frame was enqueued for send
- The bridge detects robot-mounted AprilTags in the JPEG and estimates
  `T_world_odom` continuously while an align session is active.

### `align_manual_pose`

Manual robot pose estimate from the XR client:

```json
{
  "type": "align_manual_pose",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "position": [x, y, z],
  "orientation": [qx, qy, qz, qw]
}
```

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

### `emergency_stop`

Request immediate stop through whatever safe stop path the active adapter
provides. If the capability is disabled in `hello`, clients should not send it.

## Removed Legacy Flow

The legacy `register` / `registered` message flow is removed from `dimos-xr`.
Calibration is driven entirely by the `align_*` messages plus `align_status` and
`bridge_status.registered`.

## Changelog

### v3 (current) — XR Bridge PR refactor (additive, backward-compatible changes only)

The PR that introduced per-robot adapters (`go2` / `g1`), DimOS TF publication,
`PointCloud2` delegation, `mypy strict`, and launcher restructuring is
**backward-compatible**: all existing message types, field names, and semantics
are preserved. Clients built against any prior version of protocol v3 continue
to work without modification.

Additive wire changes (new optional fields; existing fields unchanged):

- `hello.robot.alignment_profile` is a new optional field emitted when the
  adapter provides alignment configuration (see the `hello` section above for
  the full field definition). Clients that ignore unknown fields are unaffected.
- The `bridge_status.registration_approximate` field is now **always present**
  (`true` or `false`), previously only emitted when `true`. Clients must
  tolerate both its presence and absence as specified.

Server-side only (invisible on the wire):

- `XRBridgeConfig` tag geometry fields (`tag_aruco_dictionary`, `tag_total_size_m`,
  `tag_black_size_m`) are server-side configuration only.
