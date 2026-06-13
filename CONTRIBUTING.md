# Contributing

Thanks for helping improve spectacles-dimensional-os. This repo is a **monorepo**.

## Where to work

| Change | Location |
|--------|----------|
| DimOS bridge, protocol, blueprints | [`dimos-xr/`](dimos-xr/) |
| Spectacles Lens | [`lens-studio/`](lens-studio/) — open **`lens-studio/spectacles-dimensional-os.esproj`** in Lens Studio |
| Cross-platform WebSocket API | [`dimos-xr/PROTOCOL.md`](dimos-xr/PROTOCOL.md) + the Python and Lens implementations (see below) |
| README demo GIFs / images | [`assets/`](assets/) at repo root |

Do **not** open Lens Studio from the repo root — that creates stray `Cache/`, `Packages/`, etc.

## Protocol changes

Update together in one change:

1. `dimos-xr/dimos_xr/network/protocol.py`
2. `dimos-xr/PROTOCOL.md`
3. `lens-studio/Assets/Scripts/Bridge/Protocol.ts`

## Python

```bash
cd dimos-xr
/path/to/dimos/.venv/bin/python3 -m pip install -e ".[dev]"
./start.sh            # WebSocket :8787, interactive robot selection
/path/to/dimos/.venv/bin/python3 -m pytest
/path/to/dimos/.venv/bin/python3 -m ruff check .
/path/to/dimos/.venv/bin/python3 -m mypy dimos_xr
```

DimOS is an external dependency — install from [dimensionalOS/dimos](https://github.com/dimensionalOS/dimos), not from this repo.

## Lens Studio

Scene wiring, authored object names, and `@input` references are documented inline in the script files via comments at lookup sites (see [`SetupWizard.ts`](lens-studio/Assets/Scripts/Setup/SetupWizard.ts) and [`DimosManager.ts`](lens-studio/Assets/Scripts/Core/DimosManager.ts)).

### Architecture rules — one owner per concern

Each subsystem (navigation, alignment, robot, lidar, setup) has **one owner class** that holds all state, logic, and lifecycle for that concern. Do not split a concern across coordinator + controller + presenter layers or introduce lambda-bundle dependency interfaces. If a subsystem needs a sibling's API, pass a concrete reference (or the shared `AppState`) in the constructor.

### Scene-reference policy

1. **Cross-tree references are `@input`s** on the owning component. No global scene scans (`requireSceneObjectByName` is deleted — do not re-introduce it).
2. **A View class may resolve children by name only under a root it was handed**, only in its constructor, via `requireChild` (throwing) for required nodes and `findChildRecursive` for optional ones. Fail fast at startup, never lazily at runtime.
3. **No new code-built UI.** The wizard panel is grandfathered; anything new is scene-authored with a View class wired to it via `@input`.

## Marker assets

After changing the AprilTag contract, regenerate robot-mounted assets: `python scripts/generate_marker.py` (from `dimos-xr/`).

## Diagnostics and logging

Alignment and bridge failures are logged to the Lens Studio Logger (`print`) and
the bridge terminal / `dimos log -f`. `./start.sh` defaults to `DIMOS_LOG_LEVEL=DEBUG`.
When changing protocol or alignment behavior, add or extend log lines at failure
points rather than introducing UI error catalogs.

## Tests

- Default CI runs unit tests that do not require DimOS installed.
- Integration: `pytest dimos_xr/network/test_ws_integration.py -m integration` with the bridge already running from the DimOS `.venv`.

## License

MIT — see [LICENSE](LICENSE).
