# dimos-ar

`dimos-ar` is the bridge package in this monorepo that exposes a platform-agnostic
AR WebSocket interface on top of DimOS robot stacks.

It lives in this monorepo as a standalone bridge package, with all
platform-agnostic code under `dimos/ar/`.

At a glance:
- `dimos/ar/bridge/`: `ARBridge` and collaborator classes (navigation, preview, telemetry, odom buffer, status service)
- `dimos/ar/registration/`: frame registration session, baseline collector, tag tracker, runtime refinement
- `dimos/ar/adapters/`: `ARRobotAdapterModule`, the robot/runtime adapter layer
- `dimos/ar/network/protocol.py`: the AR WebSocket contract implementation
- `dimos/ar/blueprints.py`: monorepo entrypoint used by `start.sh`
- `PROTOCOL.md`: cross-client protocol documentation

<details>
<summary>Start</summary>

Use the DimOS `.venv`, then run:

```bash
cd /path/to/spectacles-dimensional-os
./start.sh
```

`start.sh` always prompts for the target robot stack and then runs the matching
monorepo bridge entrypoint. The equivalent native DimOS compositions are:

```bash
dimos run ar-go2
dimos run ar-g1
```

Use `./start.sh` if these blueprints are not yet registered in your DimOS install.

Capability expectations by stack (negotiated at runtime via `hello` / `capability_states`):

- `ar-go2`: Go2 family — full navigation and AprilTag registration when the selected
  onboard stack exposes those modules; lighter stacks may negotiate unavailable
  navigation/path/cancel while keeping the same AR contract
- `ar-g1`: G1 nav-onboard — navigation-capable when the Unitree DDS dependency
  set is present in the DimOS `.venv`; manual registration is always supported,
  AprilTag baseline registration only when the runtime exposes the required camera path

The default AR WebSocket port is `8787`.

</details>

<details>
<summary>Runtime behavior contract</summary>

The bridge and Lens are handshake-driven to automatically adapt to any supported
robot family:

- `hello.robot` provides display identity plus geometry such as
  `body_bounds_m`, `footprint_m`, `base_height_m`, and
  `default_render_offset_m`
- `capability_states` tells the client which features are available for the
  active runtime
- the Lens keeps offline development affordances enabled until a bridge connects
  and completes the handshake
- unavailable controls stay visible and switch into disabled `Special` UI states
  with explanatory labels when the active runtime does not support them

Capability expectations by stack:

- `ar-go2`: full intended Go2 experience when navigation-capable modules are
  present; AprilTag registration support depends on the active onboard stack
- `ar-g1`: navigation-capable G1 runtime when DDS dependencies are installed;
  manual registration always supported, AprilTag baseline negotiated from the
  active camera path and calibrated robot-camera geometry

</details>

<details>
<summary>Tests</summary>

Run tests from the DimOS `.venv`, not an arbitrary Python environment.

```bash
cd /path/to/spectacles-dimensional-os/dimos-ar
/path/to/dimos/.venv/bin/python3 -m pytest
/path/to/dimos/.venv/bin/python3 -m ruff check .
/path/to/dimos/.venv/bin/python3 -m mypy dimos/ar
```

If you need the G1 onboard runtime in that environment, install its DDS
dependency set first:

```bash
/path/to/dimos/.venv/bin/pip3 install "unitree-sdk2py-dimos>=1.0.2"
```

For the integration test, start the blueprint first, then run:

```bash
/path/to/dimos/.venv/bin/python3 -m pytest dimos/ar/network/test_ws_integration.py -m integration
```

Tests are colocated with their modules under `dimos/ar/` rather than in a top-level `tests/` directory. Unit tests run without any external services; the integration test requires a live bridge WebSocket on port 8787.

</details>

<details>
<summary>Registration flows</summary>

Two flows are supported:

**AprilTag + odom baseline** (`registration_start{mode:"april_odom_baseline"}`)  
The bridge drives the robot through a 3-leg baseline-collection move while the
Spectacles user looks at the robot-mounted AprilTag. After each leg the robot
stops and samples until enough stable observations are collected. When baseline
collection completes, the bridge auto-commits. If no solve is produced the session
enters `failed` and the user can retry.

Requires the robot to advertise `registration_april_odom_baseline` (i.e., the
`cmd_vel` transport must be available and tag mounts configured). On robots
without baseline motion the AprilTag path returns `failed` and the user must
switch to manual pose registration.

**Manual pose** (`registration_start{mode:"manual_pose"}`)  
The user drags the robot marker to its real-world position in the Lens, streams
`registration_pose`, then sends `registration_commit`. No camera frames are
consumed. Always available when `registration_manual_pose` is advertised.

Notes:
- Baseline strafe motion uses the same pure lateral `cmd_vel.linear.y` path as
  the proven teleop/app controls. Go2 uses a `0.5` stick deflection streamed at
  50 Hz; G1 uses the same robot-agnostic driver path with adapter-provided speed
  and remains validation-pending on hardware.
- The client authorizes each baseline move with `registration_action:
  authorize_motion`; the bridge publishes structured `motion` hints in
  `registration_status`.
- Runtime drift correction reuses the robot-mounted Spectacles tag stream after
  registration. The bridge still uses `RobotAprilTagTracker.current_solve()` for
  multi-observation yaw + translation updates when odom baseline is available,
  and falls back to a translation-only correction path when the robot is
  stationary.
- The handheld-tag-scan flow (static robot, user collects many samples, cluster-averaged on
  commit) has been removed. It was only reachable on robots without `cmd_vel` transport,
  for which manual pose is the correct alternative.

**Tag mount geometry (Go2)**  
The robot marker and LiDAR share `T_world_odom`, which depends on the configured
`TagMount.position` lever arm in `dimos/ar/adapters/go2.py`. After registration,
while the tag is visible and the robot is static, `RobotAprilTagTracker.current_translation_solve()`
emits a one-shot `tag_mount_offset diagnostic` log comparing:

- `measured_base_to_tag` — base_link→tag offset inferred from vision and the committed
  `T_world_odom`
- `configured_mount.position` — the lever arm used by the tracker
- `residual` — difference; should be near zero when the marker sits on robot center

To tune on hardware: register, stand at 3–5 m with a static robot, read the
diagnostic from bridge logs, set `GO2_DEFAULT_TAG_MOUNTS[0].position` to
`measured_base_to_tag` (restart the bridge), re-register, and confirm the marker
and LiDAR stay co-registered within a few centimetres.

</details>

<details>
<summary>Protocol coupling</summary>

If the AR protocol changes, update these together:

- `dimos/ar/network/protocol.py`
- `PROTOCOL.md`
- `lens-studio/Assets/Scripts/Bridge/Protocol.ts`

</details>
