# Contributing

Thanks for helping improve spectacles-dimensional-os. This repo is a **monorepo**.

## Where to work

| Change | Location |
|--------|----------|
| DimOS bridge, protocol, blueprints | [`dimos-ar/`](dimos-ar/) |
| Spectacles Lens | [`lens-studio/`](lens-studio/) — open **`lens-studio/spectacles-dimensional-os.esproj`** in Lens Studio |
| Cross-platform WebSocket API | [`dimos-ar/PROTOCOL.md`](dimos-ar/PROTOCOL.md) + the Python and Lens implementations (see below) |
| README demo GIFs / images | [`assets/`](assets/) at repo root |

Do **not** open Lens Studio from the repo root — that creates stray `Cache/`, `Packages/`, etc.

## Protocol changes

Update together in one change:

1. `dimos-ar/dimos/ar/network/protocol.py`
2. `dimos-ar/PROTOCOL.md`
3. `lens-studio/Assets/Scripts/Bridge/Protocol.ts`

## Python

```bash
cd dimos-ar
/path/to/dimos/.venv/bin/python3 -m pip install -e ".[dev]"
./start.sh            # WebSocket :8787, interactive robot selection
/path/to/dimos/.venv/bin/python3 -m pytest
/path/to/dimos/.venv/bin/python3 -m ruff check .
/path/to/dimos/.venv/bin/python3 -m mypy dimos/ar
```

DimOS is an external dependency — install from [dimensionalOS/dimos](https://github.com/dimensionalOS/dimos), not from this repo.

## Lens Studio

Scene wiring is centralized on [`DimosServices.ts`](lens-studio/Assets/Scripts/Core/DimosServices.ts): assign cross-tree `@input`s there once. Entry scripts need [`DimosManager`](lens-studio/Assets/Scripts/Core/DimosManager.ts) (plus `mainUIFrame` and `setupWizard` on [`UIManager`](lens-studio/Assets/Scripts/UI/UIManager.ts)). Runtime services (`DimosState`, `BridgeRuntime`, `RobotRuntime`, `NavigationHost`, `AlignmentSession`, `SetupAlignmentPreview`) are plain TypeScript classes owned by `DimosServices`, not separate scene objects.

### Architecture rules — one owner per concern

Each subsystem (navigation, alignment, robot, lidar, setup) has **one owner class** that holds all state, logic, and lifecycle for that concern. Do not split a concern across coordinator + controller + presenter layers or introduce lambda-bundle dependency interfaces. If a subsystem needs a sibling's API, pass a concrete reference (or the shared `AppState`) in the constructor.

### Scene-reference policy

1. **Cross-tree references are `@input`s on [`DimosServices`](lens-studio/Assets/Scripts/Core/DimosServices.ts)** (or on leaf components that legitimately need a spatial/camera ref, e.g. `RobotMarker`, `FrameCaptureController`). No global scene scans (`requireSceneObjectByName` is deleted — do not re-introduce it).
2. **Entry scripts (`SetupWizard`, `UIManager`) take `DimosManager` only** (plus `mainUIFrame` and `setupWizard` on `UIManager`).
3. **A View class may resolve children by name only under a root it was handed**, only in its constructor, via `requireChild` (throwing) for required nodes and `findChildRecursive` for optional ones. Fail fast at startup, never lazily at runtime.
4. **No new code-built UI.** The wizard panel is grandfathered; anything new is scene-authored with a View class wired to it via `@input`.

## Marker assets

After changing the AprilTag contract, regenerate robot-mounted assets: `python scripts/generate_marker.py` (from `dimos-ar/`).

## Diagnostics and logging

Alignment and bridge failures are logged to the Lens Studio Logger (`print`) and
the bridge terminal / `dimos log -f`. `./start.sh` defaults to `DIMOS_LOG_LEVEL=DEBUG`.
When changing protocol or alignment behavior, add or extend log lines at failure
points rather than introducing UI error catalogs.

## Tests

- Default CI runs unit tests that do not require DimOS installed.
- Integration: `pytest dimos/ar/network/test_ws_integration.py -m integration` with the bridge already running from the DimOS `.venv`.

## License

MIT — see [LICENSE](LICENSE).
