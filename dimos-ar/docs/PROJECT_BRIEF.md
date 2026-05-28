# Project Brief — dimos-ar

## What this project is

`dimos-ar` is an **AR extension package for DimOS** (the robotics framework at
github.com/dimensionalOS/dimos). It lets AR headsets and phones visualize a
robot's sensor data and issue navigation commands by interacting with the real
world in augmented reality.

The first target robot is a **Unitree Go2 Air** quadruped. The first target AR
device is **Snap Spectacles**. Neither is hardcoded — see "Platform-agnostic"
below.

This is **not a fork of DimOS**. It is a separate, independently versioned
package that *depends on* DimOS and imports from it. DimOS is the framework;
this is a plugin for it.

## The hardware/data path

```
Unitree Go2 Air
    | WebRTC over WiFi (no jailbreak; handled entirely by DimOS)
MacBook Air (macOS, 8GB) running DimOS + this package
    | WebSocket server (this package exposes it)
AR client (Snap Spectacles Lens / phone web app / future Quest)
```

The Mac runs DimOS and our extension. DimOS connects to the robot. Our
extension module subscribes to DimOS data streams and re-broadcasts them over a
WebSocket to the AR client. The AR client also sends data back (navigation
goals) over the same socket.

## Core architecture decision: the bridge IS a DimOS module

The component that talks to the AR client is a **DimOS `Module` subclass**, not
a standalone script. It declares typed stream inputs (`In[]`) and outputs
(`Out[]`) and is composed into a DimOS blueprint via `autoconnect`. This means:

- It receives `lidar`, `odom`, and the planner's `path` stream automatically by
  declaration — no manual stream plumbing.
- Its navigation-goal output auto-connects to the existing DimOS planner.
- It gets DimOS lifecycle management, backpressure, and RPC for free.

See `ARCHITECTURE.md` for the full design. This decision is fixed.

## Platform-agnostic

The DimOS-side code (the module, the protocol, the transform math) knows
nothing about Snap Spectacles. It speaks a documented JSON protocol (see
`PROTOCOL.md`) over a WebSocket. Any client that speaks that protocol works:
Spectacles, a phone web app, a future Quest app.

Therefore:
- Name things generically: `ARBridge`, not `SpectaclesBridge`.
- Platform-specific code lives in **client repos/projects**, not in `dimos_ar/`.
  The Spectacles Lens Studio project lives in `lens-studio/` at the monorepo root
  `lens-studio/` (see `docs/LENS_DEVELOPMENT.md`). The web debug client
  stays in `clients/web/` in this repo.
- The protocol schema is the real cross-platform contract — treat it as an API.

## Tech stack (fixed — do not substitute)

- **Robot connection & data:** DimOS, package `dimos[base,unitree]`. Connects to
  the Go2 over WebRTC. Provides streams as RxPY (`reactivex`) Observables. NO
  ROS2 is involved for the Go2 — do not add ROS2 dependencies.
- **Bridge:** a DimOS `Module` subclass in this package. Python.
- **WebSocket:** the `websockets` library, run on a daemon thread (see
  ARCHITECTURE.md — the module worker must never block).
- **AR client (first):** Snap Lens Studio project (`lens-studio/`),
  TypeScript. See `docs/LENS_DEVELOPMENT.md`.
- **Debug/phone client:** a three.js web page under `clients/web/` in this repo —
  build this early; it is the no-hardware test tool and doubles as the phone
  client.
- **Frame alignment:** a printed **ArUco** fiducial marker. NOTE: DimOS already
  ships `dimos/perception/fiducial/marker_tf_module.py` (`MarkerTfModule`) and a
  `RelocalizationModule` — read these before building custom calibration.
- **WebSocket payload format:** JSON for now. Binary is a later optimization.

## Milestones

1. **M1 — Lidar visualization.** Robot lidar renders in AR, positioned correctly
   in the AR world frame via one-time ArUco registration. (This is the first
   public release.)
2. **M2 — Waypoint navigation.** User places a pin on the floor in AR; robot
   navigates there; planned path is drawn in AR.
3. **M3 — Object detection pins.** Open-vocabulary detection on the bridge;
   detected objects appear as labeled AR markers.
4. **M4 — Voice commands.** Speech-to-text into a DimOS agent driving existing
   skills.
5. **M5+** — semantic queries ("find the exit"), spatial map in AR, multi-robot.

Build strictly in order. Each milestone is a verifiable, demoable unit.

## Out of scope (do not build ahead)

- ROS2 anything.
- Binary protocol optimization (until JSON is proven a bottleneck).
- Drone support (a much later, separate platform).
- CUDA / heavy GPU perception — the dev machine is an 8GB MacBook Air, CPU only.

## Key terminology

- **Odometry** — dead-reckoned position estimate; continuous but drifts.
- **Pose** — 6DOF state: position (x,y,z) + orientation (quaternion).
- **Transform / TF** — relationship between two coordinate frames. The ArUco
  registration step computes one static transform: robot `odom` frame <-> AR
  `world` frame.
- **Costmap** — a 2D occupancy grid of traversable space, built from lidar by
  DimOS's `CostMapper`. The planner needs it to exist before it can plan.
- **Frontier** — boundary between mapped and unmapped space.

## Known facts about the Go2 + DimOS (verified against DimOS source)

- `GO2Connection` is the DimOS module for the robot. Its outputs are exactly:
  `pointcloud: Out[PointCloud2]`, `odom: Out[PoseStamped]`,
  `lidar: Out[PointCloud2]`, `color_image: Out[Image]`,
  `camera_info: Out[CameraInfo]`. Its input is `cmd_vel: In[Twist]`.
- Odometry comes from WebRTC topic `rt/utlidar/robot_pose` and is a FULL pose:
  position **and** orientation quaternion. No velocity integration needed.
- Lidar comes from WebRTC topic `ULIDAR_ARRAY`; points are an (N,3) numpy array.
- Some Go2 firmware emits stale lidar timestamps; DimOS already compensates.
- The blueprint `unitree_go2_basic` = connection only (lidar/odom/video/cmd_vel).
- The blueprint `unitree_go2` = basic + full nav stack (VoxelGridMapper,
  CostMapper, ReplanningAStarPlanner, WavefrontFrontierExplorer, MovementManager).
- The replay mode `dimos --replay run unitree-go2` runs against recorded data
  with no robot present — use it for all development that does not strictly
  need live hardware.
