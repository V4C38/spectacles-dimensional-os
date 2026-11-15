# Specs instructions

Read the [root guidelines](../../AGENTS.md). Keep tests outside `Assets/`. Commands below run from the repository root; see the [tooling guide](tools/README.md) for runner options.

## Specs Core package updates

`clients/core/src/` is the only authored Core source. WebXR imports it directly; Specs uses `clients/specs/Packages/DimOSARClient.lspkg`. After Core changes, agents must run `python3 clients/specs/tools/core_package.py sync` before Specs validation. The command uses Lens Studio 5.15 MCP and an external disposable authoring project under `~/Library/Caches/dimos-clientcore-package/`. Never commit that project or edit the installed archive as a second source tree. Preserve package and asset identities. `python3 clients/specs/tools/core_package.py check` is read-only and needs no editor. Only Specs tests check package freshness; Core/WebXR test raw source independently. Tests must not silently rebuild packages. Exclude tests, fixtures, SDK dependencies, and host code from the archive. Wait for native import/compile readiness and publish atomically after checking actual archive contents. Retain the previous archive and diagnostics after failure. Follow queued-work guards, focus limits and production handoff rules below. Synchronization does not authorize a commit or push.

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
