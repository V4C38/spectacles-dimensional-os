# Protocol — dimos-xr WebSocket message schema

This is the cross-platform contract between the DimOS-side XR bridge and any XR
client. It is the real API of this project.

Keep this document and `dimos_xr/protocol.py` in sync. Bump
`protocol_version` on breaking changes.

## Transport

- Plain WebSocket. The Mac runs the server; XR devices connect as clients.
- All messages are JSON text frames.
- Every message is a JSON object with a `type` field.
- Inbound and outbound coordinates use the XR world frame. The bridge converts
  world-frame goals and calibration poses into robot odom coordinates.
- Every runtime message carries a single active `robot_id`.

## Handshake

On connect, the server sends `hello` with the active robot metadata and
capability surface:

```json
{
  "type": "hello",
  "protocol_version": 2,
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
  "robot_marker_detected": false,
  "spectacles_marker_detected": true,
  "quality": 0.81,
  "best_quality": 0.95,
  "has_candidate": true,
  "method": "manual",
  "message": "Waiting for robot odometry"
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

### `align_marker`

Tracked marker pose from the XR client:

```json
{
  "type": "align_marker",
  "ts": 1730000000.123,
  "robot_id": "unitree_go2",
  "marker_position": [x, y, z],
  "marker_orientation": [qx, qy, qz, qw]
}
```

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
