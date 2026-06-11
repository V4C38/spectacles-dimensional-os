# Tests

## Layout

| File | Type | Needs running bridge |
|------|------|----------------------|
| `test_protocol.py` | Unit | No |
| `test_transforms.py` | Unit | No |
| `test_filters.py` | Unit | No |
| `test_calibration.py` | Unit | No |
| `test_ws_integration.py` | Integration | Yes |

## Run unit tests (default, used in CI)

```bash
/path/to/dimos/.venv/bin/python3 -m pytest tests/ -m "not integration"
```

Run tests from the DimOS `.venv`, not an arbitrary Python environment.

## Run integration test (headless protocol check)

Terminal 1 — start the bridge (from repo root):

```bash
./start.sh        # interactive robot chooser (Go2 or G1)
```

Or directly with `dimos run` once blueprints are registered upstream:

```bash
/path/to/dimos/.venv/bin/python3 -c "from dimos_xr.blueprints import xr_go2; ..."
```

Wait for `XR WebSocket server listening`.

### Go2

Start the bridge with the Go2 stack (`./start.sh` → choose "Unitree Go2").

Expected XR behavior:

- pose/lidar/path negotiate from the Go2 smart stack
- all capabilities enabled when the robot is live

### G1 nav-onboard

Start the bridge with the G1 stack (`./start.sh` → choose "Unitree G1").

Expected XR behavior:

- pose/lidar/path negotiate from the onboard nav stack
- navigation capabilities enabled when the nav stack is present
- marker alignment available

Terminal 2 — run the integration test:

```bash
/path/to/dimos/.venv/bin/python3 -m pytest tests/test_ws_integration.py -m integration
```

Optional: override the WebSocket URL:

```bash
DIMOS_XR_WS_URL=ws://192.168.1.10:8787 /path/to/dimos/.venv/bin/python3 -m pytest tests/test_ws_integration.py -m integration
```
