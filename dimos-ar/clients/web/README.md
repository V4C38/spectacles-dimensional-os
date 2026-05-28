# dimos-ar web debug viewer

Vite + Three.js client for the [dimos-ar WebSocket protocol](../../docs/PROTOCOL.md). Use this to verify filtered world-frame lidar and robot pose from `ARBridge` during replay — no robot or Spectacles required.

For general DimOS robot debugging (odom-frame lidar, nav, costmaps), use DimOS Rerun instead (`dimos --replay run unitree-go2` with `--rerun-open web`). This client is the **AR protocol reference** and tests `register` calibration.

## Prerequisites

- DimOS venv with `dimos-ar` installed (`pip install -e` from repo root)
- Node.js 18+

## Run (two terminals)

**Terminal 1 — AR blueprint:**

```bash
# Offline / CI (no LAN discovery):
FORCE_REPLAY=1 CI=1 /path/to/dimos/.venv/bin/python3 \
  /path/to/dimos-ar/blueprints/go2_ar_basic.py

# Or interactive (discovers Go2 on LAN, else replay):
/path/to/dimos/.venv/bin/python3 \
  /path/to/dimos-ar/blueprints/go2_ar_basic.py
```

Wait for `AR WebSocket server listening` on `ws://127.0.0.1:8765`. Replay data may take 15–40 seconds before lidar streams.

After **Connect**, the client reads `robot_id` from the server `hello` message (`robots[0]`). Replay uses `"go2"`; live hardware uses the Go2 serial.

**Terminal 2 — web viewer:**

```bash
cd clients/web
npm install
npm run dev
```

Open the URL Vite prints (typically `http://localhost:5173`). Click **Connect**, then **Dev Register** to apply identity calibration for replay testing.

## Protocol check (headless)

With the blueprint running in another terminal:

```bash
cd /path/to/dimos-ar
pytest tests/test_ws_integration.py -m integration
```

## Ports

| Service | Port |
|---------|------|
| ARBridge WebSocket | **8765** |
| DimOS WebsocketVis (nav) | 7779 |
| This Vite dev server | 5173 |

Do not run `viewer=foxglove` on the same machine as ARBridge — both use port 8765.

## Build for production

```bash
npm run build
npm run preview
```
