# dimos-xr

`dimos-xr` is the bridge package in this monorepo that exposes a platform-agnostic
XR WebSocket interface on top of DimOS robot stacks.

It lives in this monorepo as a standalone bridge package, with all
platform-agnostic code under `dimos_xr/`.

At a glance:
- `dimos_xr/bridge_module.py`: `XRBridge`, the WebSocket/protocol/calibration core
- `dimos_xr/adapter_module.py`: `XRRobotAdapterModule`, the robot/runtime adapter layer
- `dimos_xr/protocol.py`: the XR WebSocket contract implementation
- `blueprints/dimos_xr.py`: monorepo entrypoint used by `start.sh`
- `PROTOCOL.md`: cross-client protocol documentation
- `tests/`: focused bridge unit and integration tests

<details>
<summary>Start</summary>

Use the DimOS `.venv`, then run:

```bash
cd /path/to/spectacles-dimensional-os/dimos-xr
./start.sh
```

`start.sh` always prompts for the target robot stack and then runs the matching
monorepo bridge entrypoint. The equivalent native DimOS compositions are:

```bash
dimos run unitree-go2 dimos-xr
dimos run unitree-go2-basic dimos-xr
dimos run unitree-g1-nav-onboard dimos-xr
dimos run unitree-g1 dimos-xr
```

`unitree-go2` is the primary, fully navigation-capable Go2 target.
`unitree-go2-basic` is a best-effort capability-driven runtime that works cleanly
when navigation-capable modules are absent.

For G1:

- `unitree-g1-nav-onboard` is the primary navigation-capable G1 target
- `unitree-g1` is supported through the same capability-driven contract
- G1 runtimes negotiate manual alignment support explicitly; marker
  alignment is only advertised when the active runtime has the required camera
  path and calibrated robot-camera geometry
- `unitree-g1-nav-onboard` requires the Unitree DDS dependency set in the DimOS
  `.venv`; if that runtime is missing `unitree_sdk2py`, install
  `unitree-sdk2py-dimos` into the same `.venv`

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

- `unitree-go2`: full intended experience, including navigation-capable runtime
  behavior and marker alignment support
- `unitree-go2-basic`: same Go2 family presentation, but navigation/path/cancel
  may negotiate unavailable
- `unitree-g1-nav-onboard`: navigation-capable G1 runtime, with capabilities
  negotiated from the actual onboard stack
- `unitree-g1`: reduced-capability G1 runtime; visualization and manual
  alignment are supported, while navigation/path/cancel may negotiate unavailable

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

For the integration test:

```bash
DIMOS_XR_STACK=unitree-go2 /path/to/dimos/.venv/bin/python3 blueprints/dimos_xr.py
/path/to/dimos/.venv/bin/python3 -m pytest tests/test_ws_integration.py -m integration
```

See [`tests/README.md`](tests/README.md) for the unit vs integration test split.

</details>

<details>
<summary>Protocol coupling</summary>

If the XR protocol changes, update these together:

- `dimos-xr/dimos_xr/protocol.py`
- `dimos-xr/PROTOCOL.md`
- `lens-studio/Assets/Scripts/Network/ProtocolTypes.ts`
- `lens-studio/Assets/Scripts/Network/Protocol.ts`
- `lens-studio/Assets/Scripts/Network/ProtocolParser.ts`

</details>
