# Repository Guidelines

## Project Structure & Module Organization

- `dimos-ar/dimos/ar/`: Python ARModule, organized into WebSocket, localization, navigation, robot, and sensor modules; Python tests sit beside source files.
- `clients/core/`: portable ClientCore source in `src/`, independent tests in `tests/`, shared fixtures in `tests/support/`.
- `clients/specs/`: runnable Lens project. `Packages/DimOSARClient.lspkg` supplies Core; `Assets/Scripts/DimOSSpecsClient/` contains Spectacles logic. Host tests live in `Tests/`.
- `clients/webxr/`: Vite/Three.js WebXR client, with production code in `src/` and tests in `tests/`.
- `launcher/app/` and `launcher/scripts/`: local launcher, tests, setup, and CI scripts.
- `assets/`: documentation media and printable AprilTags in `markers/`.

Read [CONTRIBUTING.md](CONTRIBUTING.md) for architecture and scene wiring.

## Build, Test, and Development Commands

- `./launcher/scripts/run-ci.sh`: run the complete validation gate with Python 3.12 and Node 22, including Python lint/type/unit checks, launcher tests, Core and both client Vitest suites, WebXR build, and browser integration. Use a normal terminal outside the agent sandbox: DimOS logging writes under `~/.local/state/dimos/logs/`.
- In `clients/webxr/`, run `npm ci`, then `npm run dev` for HTTPS development or `npm run build` for type checking and production output. Run ARModule on the same machine for the `/ar` proxy.
- In `clients/core/`, run `npm ci`, `npm run typecheck`, and `npm test` for portable source validation.
- In `clients/specs/Tests/`, run `npm ci` and `npm test` for archive parity and host tests.
- In `dimos-ar/`, use the installed DimOS environment: `/path/to/dimos/.venv/bin/python3 -m pytest`.
- `./launcher/scripts/start-launcher.sh`: start the local launcher.

## Coding Style & Naming Conventions

Use four-space Python indentation, type annotations, Ruff's 100-character configuration, and strict mypy checks. TypeScript uses two-space indentation, double quotes, and semicolons. Host files/classes use PascalCase and properties camelCase; preserve protocol field spelling such as `nav_goal`. Match role suffixes: `Presenter`, `Controller`, `View`, and `Renderer`.

## Testing Guidelines

Use pytest/pytest-asyncio for Python (`test_*.py`) and Vitest for TypeScript (`*.test.ts`). Run `npm test` in Core or the relevant client test package. Keep Lens tests outside `Assets/`. Add regression coverage for changed behavior; no numeric coverage threshold is configured.

## Commit & Pull Request Guidelines

History uses short descriptive subjects, such as “Joystick navigation support”; follow that style. PRs should explain behavior changes, reference relevant issues, report validation, and include screenshots for visual changes.

Run focused tests during development and batch related fixes. Run `./launcher/scripts/run-ci.sh` once at the final checkpoint before committing, amending or pushing code. A failed, interrupted or unavailable gate forbids commit/push unless the user explicitly authorizes skipping validation. One checkpoint covers commit and push of the same change set.

For small follow-up fixes, rerun relevant tests only. Documentation, formatting, whitespace and Git metadata changes need no repeated full gate. Repeat it for substantial cross-system risk, failures requiring broader verification, or an explicit request. Report completed/deferred checks and platform limits; never describe interrupted checks as passed. Honor explicit commit/push instructions without further tests and disclose validation limits.

GitHub Actions must use the same gate with job selectors, sharing installation, versions and checks. Local macOS host libraries differ from Ubuntu 24.04 CI; local success does not guarantee remote success.

## Architecture & Protocol Rules

Import installed DimOS; do not edit upstream source. Reuse ClientCore without copying it or adding platform APIs. Change `dimos-ar/PROTOCOL.md`, Python `websocket/protocol.py`, and Core `clients/core/src/websocket/protocol.ts` together. Manipulate Lens `.scene` files through Lens Studio MCP tools rather than hand editing.

## Lens Studio and Core changes

Before preparing any Lens Studio verification or editor action, including work triggered outside Specs, read and follow [Specs instructions](clients/specs/AGENTS.md). Acquire its idle-lock guard immediately when LS work is requested, before preparation, implementation, other tests, or waiting for an editor.

Author Core only in `clients/core/src/`; WebXR imports it directly. After Core changes, run `python3 clients/specs/tools/core_package.py sync` before Specs validation, following the [package workflow](clients/specs/AGENTS.md#specs-core-package-updates). Never edit the installed archive as a second source tree. The read-only `check` subcommand needs no editor. Synchronization does not authorize committing or pushing.

## Review evidence

Follow the [evidence policy](tools/integration-tests/README.md#review-evidence) for output locations, retention and golden-video publication.
