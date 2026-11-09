# Contributing

## Start here

Use Python 3.12 and Node 22 (`nvm use`). Install Git LFS and ffmpeg/ffprobe. Follow the [README](README.md) for setup and choose the DimOS environment explicitly. Import installed DimOS; upstream changes belong in separate PRs.

## Ownership and structure

- `dimos-ar/dimos/ar/`: ARModule and platform-independent server collaborators; tests are colocated.
- `clients/specs/Assets/Scripts/DimOSARClient/`: portable ClientCore, imported directly by both clients. Never copy it or add Lens/Three.js APIs.
- `clients/specs/Assets/Scripts/DimOSSpecsClient/`: Specs composition, input, and rendering. Keep tests outside Assets.
- `clients/webxr/src/`: WebXR composition, input, and rendering.
- `launcher/`: setup and owned-process lifecycle; profile calibration is independent of source selection.

Give each runtime concern one mutable owner. Expose facts through that owner and derive presentation; avoid mirrored lifecycle flags. Keep platform mechanisms in hosts. Use descriptive role names such as Controller, Presenter, View, and Renderer.

Open Lens Studio from `clients/specs/spectacles-dimensional-os.esproj`. Manipulate scenes through Lens MCP, never hand edit them. Preserve asset metadata identities. The production Integration Test Harness must retain Auto Run false; native scenarios belong only in disposable editor projects.

The [DimOS compatibility boundary](docs/dimos-compatibility.md) records native ownership and migration requirements. The [architecture reference](docs/architecture.md) describes current subsystem and native-testing contracts. The [protocol](dimos-ar/PROTOCOL.md) is canonical: update it, Python protocol, and ClientCore protocol together when changing messages.

## Validation

Run `./launcher/scripts/run-ci.sh` before every commit, amend, or push, on the exact code involved. All jobs must pass: Python lint/type/unit checks, launcher checks, Specs/Core tests, WebXR tests/build, tooling tests, the official mock manipulation contract, and complete browser integration. Use an unrestricted terminal because DimOS logs outside the repository. Focused checks and previous runs do not replace this gate.

For native changes, follow [native testing](clients/specs/tools/README.md). TypeScript compilation does not prove Preview rendering or scene wiring. Browser transport shims do not prove native Specs input. Keep evidence provenance intact and distinguish simulated results from physical tests. Restore production source, verify Auto Run false and no Review fixtures, and check compiler-cache correspondence before handing back for hardware validation.

## Pull requests

Describe the concrete problem and resulting behavior, link issues, report validation, and include images for visual changes. Keep changes organized by owning concern. Use the [device validation handoff](docs/hardware-validation.md) to record hardware validation that remains outstanding. Do not commit or push after a failed or unavailable gate unless explicitly authorized to skip it.
