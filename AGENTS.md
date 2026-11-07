# Repository Guidelines

## Project Structure & Module Organization

- `dimos-ar/dimos/ar/`: Python ARModule, organized into WebSocket, localization, navigation, robot, and sensor modules; Python tests sit beside source files.
- `clients/specs/`: Lens Studio project. `Assets/Scripts/DimOSARClient/` contains portable ClientCore; `Assets/Scripts/DimOSSpecsClient/` contains Spectacles logic. Tests live separately in `Tests/`.
- `clients/webxr/`: Vite/Three.js WebXR client, with production code in `src/` and tests in `tests/`.
- `launcher/app/` and `launcher/scripts/`: local launcher, tests, setup, and CI scripts.
- `assets/`: documentation media and printable AprilTags in `markers/`.

Read `CONTRIBUTING.md` for architecture and scene-wiring rules.

## Build, Test, and Development Commands

- `./launcher/scripts/run-ci.sh`: run Python linting, mypy, pytest, both Vitest suites, and the WebXR build. Use a normal terminal outside the agent sandbox: DimOS logging writes under `~/.local/state/dimos/logs/`.
- In `clients/webxr/`, run `npm ci`, then `npm run dev` for HTTPS development or `npm run build` for type checking and production output. Run ARModule on the same machine for the `/ar` proxy.
- In `clients/specs/Tests/`, run `npm ci` and `npm test`.
- In `dimos-ar/`, use the installed DimOS environment: `/path/to/dimos/.venv/bin/python3 -m pytest`.
- `./launcher/scripts/start-launcher.sh`: start the local launcher.

## Coding Style & Naming Conventions

Use four-space Python indentation, type annotations, Ruff's 100-character configuration, and strict mypy checks. TypeScript uses two-space indentation, double quotes, and semicolons. Host files/classes use PascalCase and properties camelCase; preserve protocol field spelling such as `nav_goal`. Match role suffixes: `Presenter`, `Controller`, `View`, and `Renderer`.

## Testing Guidelines

Use pytest/pytest-asyncio for Python (`test_*.py`) and Vitest for TypeScript (`*.test.ts`). Run `npm test` in either client test package. Keep Lens tests outside `Assets/`. Add regression coverage for changed behavior; no numeric coverage threshold is configured.

## Commit & Pull Request Guidelines

History uses short descriptive subjects, such as “Joystick navigation support”; follow that style. PRs should explain behavior changes, reference relevant issues, report validation, and include screenshots for visual changes.

Before every commit, amend, or push, run `./launcher/scripts/run-ci.sh` on the exact code being committed and require all jobs to pass. This includes Python lint/type/unit checks, launcher tests, both client suites, WebXR build, integration tooling tests, and the complete WebXR browser integration suite. Selected tests, previous runs against different code, and native Lens compilation do not replace this gate. After a code change or failure, fix it and rerun the full script before committing or pushing. Report the result; if the full gate cannot run, explain the blocker and do not commit or push unless the user explicitly authorizes skipping it.

## Architecture & Protocol Rules

Import installed DimOS; do not edit upstream source. Reuse ClientCore without copying it or adding platform APIs. Change `dimos-ar/PROTOCOL.md`, Python `websocket/protocol.py`, and ClientCore `websocket/protocol.ts` together. Manipulate Lens `.scene` files through Lens Studio MCP tools rather than hand editing.
