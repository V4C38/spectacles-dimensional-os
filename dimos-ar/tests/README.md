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
pytest tests/ -m "not integration"
```

## Run integration test (headless protocol check)

Terminal 1 — start the blueprint:

```bash
CI=1 python3 blueprints/go2_ar.py
```

Wait for `AR WebSocket server listening` and allow 15–40s for replay lidar.

Terminal 2 — run the integration test:

```bash
pytest tests/test_ws_integration.py -m integration
```

Optional: override the WebSocket URL:

```bash
DIMOS_AR_WS_URL=ws://192.168.1.10:8765 pytest tests/test_ws_integration.py -m integration
```
