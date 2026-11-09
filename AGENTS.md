# Repository Guidelines

## Project Structure & Module Organization

- `dimos-ar/dimos/ar/`: Python ARModule, organized into WebSocket, localization, navigation, robot, and sensor modules; Python tests sit beside source files.
- `clients/specs/`: Lens Studio project. `Assets/Scripts/DimOSARClient/` contains portable ClientCore; `Assets/Scripts/DimOSSpecsClient/` contains Spectacles logic. Tests live separately in `Tests/`.
- `clients/webxr/`: Vite/Three.js WebXR client, with production code in `src/` and tests in `tests/`.
- `launcher/app/` and `launcher/scripts/`: local launcher, tests, setup, and CI scripts.
- `assets/`: documentation media and printable AprilTags in `markers/`.

Read `CONTRIBUTING.md` for architecture and scene-wiring rules.

## Build, Test, and Development Commands

- `./launcher/scripts/run-ci.sh`: run the complete validation gate with Python 3.12 and Node 22, including Python lint/type/unit checks, launcher tests, both Vitest suites, WebXR build, and browser integration. Use a normal terminal outside the agent sandbox: DimOS logging writes under `~/.local/state/dimos/logs/`.
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

Use focused tests for the behavior being changed during development. Batch related changes and fixes, then run the full `./launcher/scripts/run-ci.sh` gate once at the end of the completed change set. Do not alternate individual edits with repeated full-suite runs.

After a small follow-up fix, rerun the relevant tests rather than restarting the complete gate. Documentation, formatting, whitespace, and Git metadata changes do not justify another full run. Repeat the full gate only when new changes introduce substantial cross-system risk, a failure requires broader verification, or the user explicitly requests it. A single final validation checkpoint covers committing and pushing the same change set; do not rerun tests separately for each Git command.

Report the checks actually completed and any deferred verification. If the user explicitly directs a commit or push without further tests, honor that instruction and disclose the remaining validation limits. Never imply that an interrupted or failed run passed.

## Architecture & Protocol Rules

Import installed DimOS; do not edit upstream source. Reuse ClientCore without copying it or adding platform APIs. Change `dimos-ar/PROTOCOL.md`, Python `websocket/protocol.py`, and ClientCore `websocket/protocol.ts` together. Manipulate Lens `.scene` files through Lens Studio MCP tools rather than hand editing.

The complete functional gate has no numeric test cutoff. Both client integration
runners produce the canonical golden-path video by default and retain failure
artifacts. Supplemental edited videos/reports are opt-in (`INTEGRATION_EXTRA_MEDIA=1`
for WebXR, native `--extra-media`); this never skips functional tests.

All generated test/review evidence defaults to the gitignored repository-root
`Review Data/`: browser/native runs under `webxr/` and `specs/`, unit reports under
`unit/`, coverage under `coverage/`, native compilation under `native-compile/`,
and official mock contracts under `mock-manipulation/`. Disposable native review
projects belong in `specs-work/`. Preserve explicit output overrides and quote paths
containing spaces. Source fixtures, build products and dependency caches keep their
own directories. Retain failed or incomplete run evidence during automatic cleanup.

Publish the latest verified golden videos at `Review Data/webxr_golden-path.mp4`
and `Review Data/specs_golden-path.mp4`. Replace each atomically after its complete
run passes, including source handoff for Specs. A complete `--suite golden` native
run can publish; failed, incomplete, focused-probe and `--keep-open` runs cannot.
Keep only one published top-level golden video per client.

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

Successful non-golden raw recordings are discarded after validation unless extra
media is requested. Golden footage, screenshots, logs and failure recordings remain.
