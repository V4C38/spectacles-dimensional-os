# Contributing

Thanks for helping improve spectacles-unitree. This repo is a **monorepo** (formerly two repos merged together).

## Where to work

| Change | Location |
|--------|----------|
| DimOS bridge, protocol, blueprints | [`dimos-ar/`](dimos-ar/) |
| Spectacles Lens | [`lens-studio/`](lens-studio/) — open **`lens-studio/spectacles-unitree.esproj`** in Lens Studio |
| Cross-platform WebSocket API | [`dimos-ar/docs/PROTOCOL.md`](dimos-ar/docs/PROTOCOL.md) + all four implementations (see below) |
| README demo GIFs / images | [`assets/`](assets/) at repo root |

Do **not** open Lens Studio from the repo root — that creates stray `Cache/`, `Packages/`, etc.

## Protocol changes

Update together in one PR:

1. `dimos-ar/dimos_ar/protocol.py`
2. `dimos-ar/docs/PROTOCOL.md`
3. `dimos-ar/clients/web/src/protocol.ts`
4. `lens-studio/Assets/Scripts/Network/Protocol.ts`

## Python

```bash
cd dimos-ar
/path/to/dimos/.venv/bin/python3 -m pip install -e ".[dev]"
./start.sh --replay    # WebSocket :8765
pytest                 # unit tests (no integration)
ruff check .
mypy dimos_ar
```

DimOS is an external dependency — install from [dimensionalOS/dimos](https://github.com/dimensionalOS/dimos), not from this repo.

## Lens Studio

See [`dimos-ar/docs/LENS_DEVELOPMENT.md`](dimos-ar/docs/LENS_DEVELOPMENT.md) and [`lens-studio/docs/SCENE_SETUP.md`](lens-studio/docs/SCENE_SETUP.md).

## Marker assets

After changing the AprilTag, regenerate and sync to the Lens — see [`dimos-ar/docs/MARKER_ASSETS.md`](dimos-ar/docs/MARKER_ASSETS.md).

## Tests

- Default CI runs unit tests that do not require DimOS installed.
- Integration: `pytest tests/test_ws_integration.py -m integration` with `./start.sh --replay` running.

## License

MIT — see [LICENSE](LICENSE).
