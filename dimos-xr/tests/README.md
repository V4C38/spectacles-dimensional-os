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

Terminal 1 — start the blueprint:

```bash
DIMOS_XR_STACK=unitree-go2 /path/to/dimos/.venv/bin/python3 blueprints/dimos_xr.py
```

Wait for `XR WebSocket server listening`.

For a best-effort non-navigation Go2 check, you can also start:

```bash
DIMOS_XR_STACK=unitree-go2-basic /path/to/dimos/.venv/bin/python3 blueprints/dimos_xr.py
```

In that mode, the bridge negotiates a valid handshake and streams pose/lidar,
while navigation-related capabilities may be disabled.

### G1 nav-onboard

```bash
DIMOS_XR_STACK=unitree-g1-nav-onboard /path/to/dimos/.venv/bin/python3 blueprints/dimos_xr.py
```

Expected XR behavior:

- pose/lidar/path should negotiate from the onboard nav stack when present
- navigation-related capabilities should reflect the actual runtime contract
- alignment may negotiate as manual-only if the runtime does not expose the
  camera path and calibrated robot-camera geometry required for marker alignment

### G1 reduced / non-nav

```bash
DIMOS_XR_STACK=unitree-g1 /path/to/dimos/.venv/bin/python3 blueprints/dimos_xr.py
```

Expected XR behavior:

- passive visualization and pose negotiate when the underlying LCM topics are
  present
- navigation/cancel/path capabilities are negotiated from the actual runtime
  transports
- manual alignment is available even when marker alignment is disabled

Terminal 2 — run the integration test:

```bash
/path/to/dimos/.venv/bin/python3 -m pytest tests/test_ws_integration.py -m integration
```

Optional: override the WebSocket URL:

```bash
DIMOS_XR_WS_URL=ws://192.168.1.10:8787 /path/to/dimos/.venv/bin/python3 -m pytest tests/test_ws_integration.py -m integration
```
