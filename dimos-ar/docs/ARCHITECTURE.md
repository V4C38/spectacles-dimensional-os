# Architecture — dimos-ar

This document specifies *how* the package is built. Product scope, milestones,
and contributor-facing setup live in the repository root `README.md`.

## Monorepo layout

The `spectacles-unitree` repository contains the Python extension, marker page,
and Spectacles Lens. Only `dimos_ar/` stays platform-agnostic.

```text
spectacles-unitree/
├── dimos-ar/                    # this folder
│   ├── dimos_ar/                # Python ARBridge
│   ├── blueprints/
│   ├── clients/marker/          # QR-linked marker page
│   └── docs/PROTOCOL.md
└── lens-studio/
    ├── spectacles-unitree.esproj
    ├── Assets/Scripts/          # Lens TypeScript
    └── Packages/                # SIK, UIKit
         │
         └── PROTOCOL.md (JSON WebSocket) ───┘
```

| Component | Location | Notes |
|-----------|----------|-------|
| `ARBridge`, protocol, transforms | `dimos-ar/` | Platform-agnostic |
| Blueprint scripts | `dimos-ar/blueprints/` | Run on Mac with DimOS |
| Spectacles Lens | `lens-studio/` | Lens Studio; see `LENS_DEVELOPMENT.md` |

The contract between components is always `docs/PROTOCOL.md`.

## Package layout (this repo)

```
dimos-ar/
├── dimos_ar/                  # the DimOS extension — platform-agnostic
│   ├── __init__.py
│   ├── bridge_module.py       # ARBridge: the DimOS Module
│   ├── robot_bootstrap.py     # LAN discovery + replay/live selection at startup
│   ├── robot_select.py        # interactive serial picker (questionary)
│   ├── go2_connection.py      # ARGO2Connection: GO2 + reconnect by serial
│   ├── websocket_server.py    # the daemon-thread WebSocket server
│   ├── protocol.py            # message (de)serialization — see PROTOCOL.md
│   ├── transforms.py          # frame alignment / calibration math
│   └── filters.py             # lidar filtering + subsampling
├── blueprints/
│   └── go2_ar.py              # unitree_go2 + ARBridge (full stack)
├── clients/
│   └── marker/                # phone marker page served by Python
├── docs/
│   ├── ARCHITECTURE.md        # this file
│   ├── PROTOCOL.md
│   ├── LENS_DEVELOPMENT.md    # Spectacles / Lens Studio guide
│   └── MARKER_ASSETS.md       # AprilTag generate + Lens sync
├── scripts/                   # generate_marker.py
├── tests/                     # pytest unit + optional WS integration
└── pyproject.toml             # depends on: dimos, websockets
```

Spectacles code lives in the monorepo sibling `lens-studio/`, not under `clients/`.

## The ARBridge module

`ARBridge` subclasses `dimos.core.module.Module`. It declares typed streams.
`autoconnect` wires them to the rest of the blueprint by matching name + type.

```python
from dimos.core.module import Module
from dimos.core.stream import In, Out
from dimos.msgs.sensor_msgs.PointCloud2 import PointCloud2
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.geometry_msgs.PointStamped import PointStamped
from dimos.msgs.nav_msgs.Path import Path
from dimos_lcm.std_msgs import Bool, String

class ARBridge(Module):
    # --- inputs: filled automatically by autoconnect ---
    lidar:        In[PointCloud2]    # matches GO2Connection.lidar
    odom:         In[PoseStamped]    # matches GO2Connection.odom
    path:         In[Path]           # matches ReplanningAStarPlanner.path
    goal_reached: In[Bool]           # matches ReplanningAStarPlanner.goal_reached
    navigation_state: In[String]     # matches ReplanningAStarPlanner.navigation_state

    # --- outputs: autoconnect to planner inputs ---
    clicked_point: Out[PointStamped]
    goal_request:  Out[PoseStamped]
    stop_movement: Out[Bool]

    @rpc
    def start(self) -> None:
        super().start()  # auto-binds async handle_<input> methods
        # start the websocket server on a daemon thread (see Threading below)
        self._ws_server.start()
        ...

    async def handle_lidar(self, msg: PointCloud2) -> None:
        # filter, transform, encode, broadcast via ws server
        ...

    async def handle_odom(self, msg: PoseStamped) -> None:
        # cache odom for register; transform pose; broadcast
        ...
```

Stream names above are verified against DimOS source. `GO2Connection` outputs
`lidar`/`odom` exactly; `ReplanningAStarPlanner` accepts both `clicked_point:
In[PointStamped]` and `goal_request: In[PoseStamped]`, and outputs `path:
Out[Path]` and `goal_reached: Out[Bool]`. Do not rename these — name match is
what makes autoconnect work.

## Threading model — CRITICAL

A DimOS module must never block its RPC worker. A WebSocket server is a
long-lived blocking asyncio loop. **The module worker must never block.**

Pattern (read `dimos/web/websocket_vis/` for the WebSocket daemon-thread
template; stream handling follows DimOS `_auto_bind_handlers`):

1. In `start()`, call `super().start()` first — this auto-subscribes any
   `async def handle_<input>` methods (e.g. `handle_lidar`, `handle_odom`) via
   `process_observable`, marshalling them onto the module's asyncio loop.
2. Spawn a **daemon thread** that runs a separate asyncio event loop and the
   `websockets` server. `start()` blocks until the server is listening (ready
   event), then returns.
3. Stream handlers run on the **module asyncio loop** (not the RPC worker). They
   must NOT touch the WebSocket loop directly. Outbound data crosses threads via
   `asyncio.run_coroutine_threadsafe(...)` on the WS loop.
4. Inbound messages from the AR client are received on the ws thread. To send a
   navigation goal into DimOS, the ws thread publishes either
   `self.goal_request.publish(pose)` for pose goals or
   `self.clicked_point.publish(point)` for legacy point-only goals (publishing is
   thread-safe).
5. In `stop()`, shut down the WebSocket server first, then call `super().stop()`.

Never `await` or run the server inline in `start()` — it would block the worker.

## Robot discovery

Before any DimOS robot modules load, [`blueprints/go2_ar.py`](../blueprints/go2_ar.py)
calls [`dimos_ar/robot_bootstrap.py`](../dimos_ar/robot_bootstrap.py):

1. Probe the LAN via DimOS [`landiscovery.discover()`](../dimos_ar/robot_bootstrap.py) (~2 s).
2. If no robots → `global_config.replay = True` (WebSocket + replay data, no hardware).
3. If one robot → connect automatically.
4. If several → interactive terminal picker ([`robot_select.py`](../dimos_ar/robot_select.py));
   optional `ROBOT_SERIAL` env skips the menu.

There is **no user-facing robot IP configuration**. The chosen serial is passed to
`ARGO2Connection` and `ARBridge` (`robot_id` in the WebSocket protocol). DimOS still
needs a transient `global_config.robot_ip` internally for WebRTC — that is set only
after discovery, never from `.env`.

[`ARGO2Connection`](../dimos_ar/go2_connection.py) subclasses `GO2Connection`. When
lidar/odom go stale, it re-runs discovery for the same serial and reconnects WebRTC
to the robot’s current IP.

## Blueprint

The single blueprint composes the full Unitree Go2 stack with the AR bridge:

```python
# blueprints/go2_ar.py
from dimos.core.coordination.blueprints import autoconnect
from dimos.robot.unitree.go2.blueprints.smart.unitree_go2 import unitree_go2
from dimos_ar.bridge_module import ARBridge

go2_ar = autoconnect(
    unitree_go2,            # includes CostMapper + ReplanningAStarPlanner
    ARBridge.blueprint(robot_id=...),
)
```

Run development with the blueprint script (not stock `dimos --replay run`
alone — that omits `ARBridge`):

```bash
python blueprints/go2_ar.py          # discover → live or replay
FORCE_REPLAY=1 CI=1 python blueprints/go2_ar.py   # offline / CI
```

## Data flow

### Outbound (robot -> AR)
```
GO2Connection.lidar  --(autoconnect)-->  ARBridge.lidar
   -> filters.py: optional range/height filter, voxel/stride subsample
   -> protocol.py: encode as JSON lidar message
   -> websocket_server: broadcast to all connected clients

GO2Connection.odom   --(autoconnect)-->  ARBridge.odom
   -> protocol.py: encode as JSON pose message
   -> websocket_server: broadcast
   
ReplanningAStarPlanner.path  --(autoconnect)-->  ARBridge.path
   -> protocol.py: encode as JSON path message
   -> websocket_server: broadcast
```

Client: `lens-studio/` Lens (monorepo sibling).

### Inbound (AR -> robot)
```
AR client confirms floor goal -> JSON nav_goal message {x, y, z, qx, qy, qz, qw} in AR world frame
   -> websocket_server receives on ws thread
   -> transforms.py: AR world frame -> robot odom frame (inverse calibration)
   -> build PoseStamped (or PointStamped for legacy messages)
   -> ARBridge.goal_request.publish(pose)
   --(autoconnect)--> ReplanningAStarPlanner.goal_request
   -> planner emits path -> flows back out via ARBridge.path
```

## Frame alignment / transforms

`transforms.py` holds one calibration: a 4x4 matrix `T_world_odom` mapping the
robot's `odom` frame to the AR `world` frame.

- It is captured once at registration: the AR client reports the pose of the
  shared phone-held calibration marker in AR world space while the bridge
  simultaneously detects that same marker in the Go2 camera and samples the
  current `odom` pose. The solve uses the observed marker pose directly. When
  the calibration is committed, the bridge assumes the robot is on level ground
  and gravity-levels the final `T_world_odom` so the AR floor remains planar and
  lidar is not rendered with phone tilt baked in.
- Frame ownership is explicit:
  - Lens inbound alignment messages are always raw AR-world poses.
  - Calibration leveling is bridge-owned and uses world `+Y` as up plus the
    tracked object's local `+X` axis as semantic robot-forward.
  - That yaw-only rule applies only while solving a calibration candidate; the
    final `T_world_odom` may still encode the fixed basis change between DimOS
    robot frames and Lens world coordinates.
- Manual debug alignment extends the same contract. During an active `align_start`
  session, the AR client may send `align_manual_pose` instead of `align_marker`;
  the bridge auto-levels that ground-robot pose, combines it with the latest odom
  sample, and stores it as an approximate candidate that still commits through
  `align_commit`.
- AprilTag camera calibration is treated as part of the alignment contract.
  The bridge validates `CameraInfo.width` / `height` against the actual image
  frames, logs the active camera model, and for the Go2 front camera can fall
  back to the calibrated `front_camera_720.yaml` intrinsics/distortion profile
  instead of trusting placeholder zero-distortion values.
- Automatic alignment candidates are no longer "best reprojection wins". The
  bridge keeps a short rolling window of `T_world_odom` samples, scores each one
  by reprojection plus translation/yaw cluster stability, and only exposes a
  committable candidate after a stable cluster forms. A committed best candidate
  is stored as an immutable snapshot so later phone movement does not replace it
  unless a clearly better stable cluster appears.
- That calibration-only leveling does **not** change normal runtime transforms
  after registration. Once `T_world_odom` is fixed, outbound lidar/pose and
  inbound navigation goals continue to use the full transform pipeline.
- **Important:** the calibration marker is not attached to the robot base. It is
  held in view of both the robot camera and the AR device during calibration, so
  marker-to-base offsets are not part of the solve. The floor-leveling step is
  what removes phone tilt from the committed world frame.
- Outbound: every lidar point and the robot pose are multiplied by
  `T_world_odom` before broadcast, so the AR client renders in world space.
- Inbound: nav goals use `inverse_transform_point` / `inverse_transform_pose`.
- Before building custom ArUco code, READ DimOS's
  `dimos/perception/fiducial/marker_tf_module.py` and `RelocalizationModule` —
  they may already provide the robot-side detection and drift correction.

## Filtering (filters.py)

Lidar arrives as an (N,3) numpy array. Before broadcast:
- Optional 360-degree range filter: can drop points beyond a configurable
  horizontal distance around the robot.
- Optional height-band filter: trims floor noise and clutter high above the
  robot while still allowing the bridge to keep a nearby world-space cloud.
- Optional bridge-side colour classification can label ground and obstacles
  before sending the cloud to clients.
- Subsample: voxel downsample (Open3D, already a DimOS dep) preferred over a
  plain stride; target ~1-3k points.
- Rate-limit the broadcast (RxPY `sample`) to ~10Hz.
All filtering happens on the Mac, before JSON encoding — it is the main lever
protecting both the WebSocket and AR-client framerate.

## Testing without hardware

`dimos --replay run unitree-go2` plays recorded robot data inside DimOS, but AR
development should use `blueprints/go2_ar.py` so `ARBridge` is in the
graph. The replay blueprint plus `pytest tests/test_ws_integration.py -m integration`
let the bridge be verified with no robot present before moving on to Lens testing
in `lens-studio/`.

## Documentation map

| Doc | Contents |
|-----|----------|
| `../../README.md` | Project overview, setup, milestones, contributor map |
| `ARCHITECTURE.md` | This file — layout, threading, data flow |
| `PROTOCOL.md` | WebSocket message schema (cross-repo contract) |
| `LENS_DEVELOPMENT.md` | Spectacles Lens Studio practices, Agent Center patterns, MCP |
