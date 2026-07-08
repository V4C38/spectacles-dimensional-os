# dimos-ar

`dimos-ar` is the bridge package in this monorepo that exposes a platform-agnostic
AR WebSocket interface on top of DimOS robot stacks.

It lives in this monorepo as a standalone bridge package, with all
platform-agnostic code under `dimos/ar/`.

At a glance:
- `dimos/ar/bridge/`: `ARBridge` composition root; telemetry, odom buffer, status service, `MotionRouter`, `BridgeSafetyCoordinator`
- `dimos/ar/navigation/`: `NavigateGoalHandler`, world-frame goal transform
- `dimos/ar/world_frame/`: committed `WorldFrameState`, registry, runtime refinement
- `dimos/ar/tag_tracking/`: robot-mounted AprilTag detect + solve
- `dimos/ar/registration/`: setup wizard session only (baseline, types, wire)
- `dimos/ar/lidar/`: LiDAR height-band filtering for AR payloads
- `dimos/ar/robot_profile/`: per-robot handshake, tag geometry, capabilities
- `dimos/ar/network/protocol.py`: the AR WebSocket contract implementation
- `dimos/ar/blueprints.py`: monorepo entrypoint used by `scripts/start.sh`
- `PROTOCOL.md`: cross-client protocol documentation

<details>
<summary>Start</summary>

Use the DimOS `.venv`, then run:

```bash
cd /path/to/spectacles-dimensional-os
./scripts/start.sh
```

`scripts/start.sh` always prompts for the target robot stack and then runs the matching
monorepo bridge entrypoint. The equivalent native DimOS compositions are:

```bash
dimos run ar-go2
dimos run ar-g1
```

Use `./scripts/start.sh` if these blueprints are not yet registered in your DimOS install.

Capability expectations by stack (negotiated at runtime via `hello` / `capabilities`):

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
  `default_render_offset_m`; `tag_tracking_profile` carries tag geometry only
  (`tag_ids`, `tag_total_size_m`)
- `hello.capabilities` tells the client which features are available for the
  active runtime
- after `hello`, the bridge sends `runtime_snapshot` (bridge + nav phase + optional
  active path) so reconnecting clients resync without replaying live streams
- navigation uses `nav_goal` to dispatch world-frame goals; active goals can be
  cancelled with `cancel_nav_goal`
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

Tests are colocated with their modules under `dimos/ar/` rather than in a top-level `tests/` directory.

| Tier | Command | Requires |
|------|---------|----------|
| Unit | `pytest -m "not integration"` | DimOS `.venv` only |
| Handshake | included in unit (`test_ws_handshake.py`) | In-process stub server; verifies `hello` + `get_status` wire flow |
| Integration | `pytest dimos/ar/network/test_ws_integration.py -m integration` | Live bridge on port 8787 (`./scripts/start.sh`) |

Lens-side protocol tests run separately: `cd lens-studio/Tests && npm test`.

</details>

<details>
<summary>Registration flows</summary>

Two flows are supported:

**AprilTag** (`registration_command{command:"start",mode:"april_tag"}`)  
The Spectacles user looks at the robot-mounted AprilTag while the bridge
collects stable tag observations. When position and yaw spread stay within
configured thresholds for enough samples, the bridge auto-commits. If stability
is not reached or the tag is lost, the session enters `failed` and the user can
retry.

Requires the robot to advertise `registration_april_tag` (tag mounts must be
configured). Robots without tag mounts must use manual pose registration.

**Manual pose** (`registration_command{command:"start",mode:"manual_pose"}`)  
The user drags the robot marker to its real-world position in the Lens, streams
`registration_pose`, then sends `registration_command{command:"commit"}`. No camera
frames are consumed. Always available when `registration_manual_pose` is advertised.

Notes:
- On commit, `WorldRegistry` locks the robot base floor height (world Y) into
  `WorldFrameRefiner` for flat-ground profiles.
- Runtime drift correction reuses the robot-mounted Spectacles tag stream after
  registration:
  - **Cruise:** `RobotAprilTagTracker.current_solve()` for yaw+translation when the
    yaw gate and `runtime_solve_max_dist_cam_m` pass; otherwise translation-only.
  - **Stop transition:** one-shot stop-yaw solve from recent approach observations
    when the robot transitions from cruise/fast to static (`runtime_stop_yaw_window_s`).
  - **Static:** translation-only re-anchor via `current_translation_solve()`.
  - **Floor shim:** when `flat_ground` is enabled and base Y drifts > 3 cm for 2 s,
    `check_floor_y_drift` applies a Y-only correction without emitting
    `world_frame_correction`.
- Corrections that exceed the notification deadband (≥ 5 cm translation or ≥ 1° yaw)
  are emitted as `world_frame_correction`; sub-threshold updates still commit on the
  bridge.

**Tag mount geometry (Go2)**  
The robot marker and LiDAR share `T_world_odom`, which depends on the configured
`TagMount.position` lever arm in `dimos/ar/robot_profile/go2.py`. After registration,
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

Protocol **v11** is current (`PROTOCOL_VERSION = 11` in `dimos/ar/network/protocol.py`).
See [`PROTOCOL.md`](PROTOCOL.md) for the full changelog and wire schema. If the AR
protocol changes, update these together:

- `dimos/ar/network/protocol.py`
- `PROTOCOL.md`
- `lens-studio/Assets/Scripts/ARBridge/Network/Protocol.ts`

</details>
