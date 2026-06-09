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

1. `dimos-xr/dimos_xr/protocol.py`
2. `dimos-xr/PROTOCOL.md`
3. `lens-studio/Assets/Scripts/Network/ProtocolTypes.ts`
4. `lens-studio/Assets/Scripts/Network/ProtocolParser.ts`
5. `lens-studio/Assets/Scripts/Network/Protocol.ts`

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

See [`lens-studio/docs/SCENE_SETUP.md`](lens-studio/docs/SCENE_SETUP.md).

## Marker assets

After changing the AprilTag, regenerate and sync to the Lens: `python scripts/generate_marker.py --sync-lens` (from `dimos-xr/`).

## Bridge error codes

When introducing a new `Bridge Error (CODE)` surfaced in Lens setup, update **together in one change**:

1. `dimos-xr/dimos_xr/error_codes.py` — add `BridgeError` + register in `BRIDGE_ERRORS`
2. `dimos-xr/ERROR_CODES.md` — add table row and detailed section
3. `lens-studio/Assets/Scripts/Setup/BridgeErrorCodes.ts` — mirror numeric code
4. Wire the code in `CalibrationSession.ts` / `CalibrationPresenter.ts`

See [`dimos-xr/ERROR_CODES.md`](dimos-xr/ERROR_CODES.md) for the full catalog.

## Tests

- Default CI runs unit tests that do not require DimOS installed.
- Integration: `pytest tests/test_ws_integration.py -m integration` with the bridge already running from the DimOS `.venv`.

## License

MIT — see [LICENSE](LICENSE).
