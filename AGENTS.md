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

## Lens Studio integration-test focus limit

Lens Studio may take focus to start a native integration recording. During the test,
allow at most **three focus-restoration attempts in total**, spaced at least one
second apart. The budget does not reset when focus is briefly restored, between
chapters/suites, or when a process restarts. Never continuously reactivate Lens
Studio while the user is using another application.

After the budget is exhausted and focus is lost again, abort the integration run,
stop its recorder and scripted interactions, retain diagnostic evidence, and notify
the user that testing stopped because of the focus limit. Do not retry, restart,
open/raise another Lens window for cleanup, or continue another native suite until
the user explicitly authorizes resuming. Time passing is not authorization.
An earlier inability to restore focus may also abort the run. Any resumed run gets
a new budget only after that explicit user authorization.

## Integration Test Harness

The production scene contains a scene object named **Integration Test Harness**
with the **Integration Test Harness** script component. Its **Auto Run** (`autoRun`)
boolean defaults to **false** and must remain false for normal use and device builds.
The component also forces Auto Run off on Spectacles. Every test scenario checks
both this switch and `global.deviceInfoSystem.isEditor()` before registering events
or replacing dependencies: tests cannot run on the device even if the switch was
saved on accidentally.

Integration tests run only when explicitly requested. The native test runner copies
the project, attaches the optional scenario to **Integration Test Harness**, and uses
Lens Studio MCP to set **Auto Run = true** in that disposable editor project. It
switches Auto Run off on exit, including failure and focus-limit abort, without
raising the editor. The normal production project retains Auto Run off and contains
no `Assets/Review` fixtures. Never deploy a disposable test copy.

Before handing the lens back for device testing, verify the production project is
open, Auto Run is false, no Review scenario assets/hosts are present, and the native
compiler cache matches production scripts. A test abort must be reported; it must
never be described as a production build ready for device testing without this check.
