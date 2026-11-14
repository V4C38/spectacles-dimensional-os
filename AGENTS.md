# Repository Guidelines

## Project Structure & Module Organization

- `dimos-ar/dimos/ar/`: Python ARModule, organized into WebSocket, localization, navigation, robot, and sensor modules; Python tests sit beside source files.
- `clients/core/`: portable ClientCore source in `src/`, independent tests in `tests/`, shared fixtures in `tests/support/`.
- `clients/specs/`: runnable Lens project. `Packages/DimOSARClient.lspkg` supplies Core; `Assets/Scripts/DimOSSpecsClient/` contains Spectacles logic. Host tests live in `Tests/`.
- `clients/webxr/`: Vite/Three.js WebXR client, with production code in `src/` and tests in `tests/`.
- `launcher/app/` and `launcher/scripts/`: local launcher, tests, setup, and CI scripts.
- `assets/`: documentation media and printable AprilTags in `markers/`.

Read `CONTRIBUTING.md` for architecture and scene-wiring rules.

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

Before committing, amending, or pushing code, the complete local `./launcher/scripts/run-ci.sh` gate must pass for the completed change set. Never commit or push after a failed, interrupted, or unavailable gate unless the user explicitly authorizes skipping validation. GitHub Actions must invoke this same script (with job selectors); keep dependency installation, tool versions, and checks shared rather than duplicating commands in the workflow. macOS uses host libraries; GitHub runs Ubuntu 24.04, so report platform limits and never promise that local success guarantees remote success.

Use focused tests for the behavior being changed during development. Batch related changes and fixes, then run the full `./launcher/scripts/run-ci.sh` gate once at the end of the completed change set. Do not alternate individual edits with repeated full-suite runs.

After a small follow-up fix, rerun the relevant tests rather than restarting the complete gate. Documentation, formatting, whitespace, and Git metadata changes do not justify another full run. Repeat the full gate only when new changes introduce substantial cross-system risk, a failure requires broader verification, or the user explicitly requests it. A single final validation checkpoint covers committing and pushing the same change set; do not rerun tests separately for each Git command.

Report the checks actually completed and any deferred verification. If the user explicitly directs a commit or push without further tests, honor that instruction and disclose the remaining validation limits. Never imply that an interrupted or failed run passed.

## Architecture & Protocol Rules

Import installed DimOS; do not edit upstream source. Reuse ClientCore without copying it or adding platform APIs. Change `dimos-ar/PROTOCOL.md`, Python `websocket/protocol.py`, and Core `clients/core/src/websocket/protocol.ts` together. Manipulate Lens `.scene` files through Lens Studio MCP tools rather than hand editing.

### Specs Core package updates

`clients/core/src/` is the only authored Core source. WebXR imports it directly;
Specs uses `clients/specs/Packages/DimOSARClient.lspkg`. After Core changes, agents
must run `python3 clients/specs/tools/core_package.py sync` before Specs validation.
The command uses Lens Studio 5.15 MCP and an external disposable authoring project
under `~/Library/Caches/dimos-clientcore-package/`. Never commit that project or edit
the installed archive as a second source tree. Preserve package and asset identities.
`python3 clients/specs/tools/core_package.py check` is read-only and needs no editor.
Only Specs tests check package freshness; Core/WebXR test raw source independently.
Tests must not silently rebuild packages. Exclude tests, fixtures, SDK dependencies,
and host code from the archive. Wait for native import/compile readiness and publish
atomically after checking actual archive contents. Retain the previous archive and
diagnostics after failure. Follow queued-work guards, focus limits and production
handoff rules below. Synchronization does not authorize a commit or push.

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

## Lens Studio queued work and automatic screen locking

As soon as the user instructs any Lens Studio verification or editor action,
acquire an idle-lock guard, **before** preparation, implementation, other tests,
or waiting for an available editor. Do not wait until native recording starts.
Keep the guard through all queued LS work, verification, cleanup, and production
source handoff. Release it automatically in the task's final cleanup after the
last LS action, including failure, cancellation, or focus-limit abort. If LS work
is cancelled, release it then; unrelated work must not keep the desktop awake.

Use the repository's temporary macOS power assertions, not persistent screen-saver,
password, or security preference changes:

```sh
python3 clients/specs/tools/ls_awake.py start TASK_LEASE --owner-pid TASK_PID
python3 clients/specs/tools/ls_awake.py status TASK_LEASE
# In final cleanup after the last LS action:
python3 clients/specs/tools/ls_awake.py stop TASK_LEASE
```

Choose a unique lease per task and a long-lived task process PID, not an ephemeral
tool shell. CLI leases expire after four hours by default and on owner exit; before
a queued lease expires, acquire its replacement under a new lease name, then
release the old one. Concurrent tasks own independent assertions: stopping one
must not release another's guard. The native review, source-audit and editor-launch
commands also guard their complete execution automatically; the review guard covers
all suites, recorder restarts, source restoration and media publication, renewing
its assertions until exit. Process death releases its assertions too.

Releasing the last guard restores ordinary automatic screen locking without
rewriting user preferences. These assertions prevent **idle** locking; they cannot
unlock an already locked desktop or override an explicit/manual or managed lock.
Check the actual screen-lock state before native visual verification and never
accept cached captures from a locked session. Idle prevention does not consume or
relax the separate focus-restoration budget below.

## Lens Studio integration-test focus limit

Lens Studio may take focus to start a native integration recording. During the test,
allow at most **three focus-restoration attempts in total**, spaced at least one
second apart. The budget does not reset when focus is briefly restored, between
chapters/suites, or when a process restarts. Never continuously reactivate Lens
Studio while the user is using another application.
For a retry after an ordinary test failure, pass the previous run's `focus-budget`
path through `review.py --focus-budget`; a new output directory must not reset it.

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
