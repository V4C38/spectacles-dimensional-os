# dimos-xr

`dimos-xr` is the bridge package in this monorepo that exposes a platform-agnostic
XR WebSocket interface on top of DimOS robot stacks.

It lives in this monorepo as a standalone bridge package, with all
platform-agnostic code under `dimos_xr/`.

At a glance:
- `dimos_xr/bridge/`: `XRBridge` and collaborator classes (alignment, navigation, preview, telemetry, odom buffer, status service)
- `dimos_xr/adapters/`: `XRRobotAdapterModule`, the robot/runtime adapter layer
- `dimos_xr/network/protocol.py`: the XR WebSocket contract implementation
- `dimos_xr/blueprints.py`: monorepo entrypoint used by `start.sh`
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
dimos run xr-go2
dimos run xr-g1
```

Use `./start.sh` if these blueprints are not yet registered in your DimOS install.

Capability expectations by stack (negotiated at runtime via `hello` / `capability_states`):

- `xr-go2`: Go2 family — full navigation and marker alignment when the selected
  onboard stack exposes those modules; lighter stacks may negotiate unavailable
  navigation/path/cancel while keeping the same XR contract
- `xr-g1`: G1 nav-onboard — navigation-capable when the Unitree DDS dependency
  set is present in the DimOS `.venv`; manual alignment is always supported,
  marker alignment only when the runtime exposes the required camera path

The default XR WebSocket port is `8787`.

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

- `xr-go2`: full intended Go2 experience when navigation-capable modules are
  present; marker alignment support depends on the active onboard stack
- `xr-g1`: navigation-capable G1 runtime when DDS dependencies are installed;
  manual alignment always supported, marker alignment negotiated from the
  active camera path and calibrated robot-camera geometry

</details>

<details>
<summary>Tests</summary>

Run tests from the DimOS `.venv`, not an arbitrary Python environment.

```bash
cd /path/to/spectacles-dimensional-os/dimos-xr
/path/to/dimos/.venv/bin/python3 -m pytest
/path/to/dimos/.venv/bin/python3 -m ruff check .
/path/to/dimos/.venv/bin/python3 -m mypy dimos_xr
```

If you need the G1 onboard runtime in that environment, install its DDS
dependency set first:

```bash
/path/to/dimos/.venv/bin/pip3 install "unitree-sdk2py-dimos>=1.0.2"
```

For the integration test, start the blueprint first, then run:

```bash
/path/to/dimos/.venv/bin/python3 -m pytest dimos_xr/network/test_ws_integration.py -m integration
```

Tests are colocated with their modules under `dimos_xr/` rather than in a top-level `tests/` directory. Unit tests run without any external services; the integration test requires a live bridge WebSocket on port 8787.

</details>

<details>
<summary>Protocol coupling</summary>

If the XR protocol changes, update these together:

- `dimos_xr/network/protocol.py`
- `PROTOCOL.md`
- `lens-studio/Assets/Scripts/Bridge/Protocol.ts`

</details>
