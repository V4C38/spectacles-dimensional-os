# Client integration contract

`scenarios.json` is the shared coverage contract for WebXR and Spectacles 2024.
It defines stable case IDs, applicability, the ordered hand-input golden path,
its timing budget, and deterministic server/hardware fixtures. Cases cannot be
substituted by similarly named screenshots: every applicable case needs a real
passing assertion with its exact ID and a captured image. Unsupported platform
features are listed explicitly as not applicable; missing implementations fail.

Run WebXR from `clients/webxr` with `npm run test:integration`. It runs the
existing browser regressions, the shared regressions, the hand walkthrough and
the separate controller walkthrough, then assembles their media and coverage.
The native Specs command and Lens Studio prerequisites are described in
`clients/specs/tools/README.md`. Native runs use Lens Studio 5.15 CLAD, disposable
project copies, actual SUK/SIK controls and source-project restoration.

Outputs are ignored and live under:

- `clients/specs/Tests/integration-tests/test-results/<run-id>/`
- `clients/webxr/tests/integration-tests/test-results/<run-id>/`

Each completed run contains consecutively numbered `01_setup_entry.png` style
images, `golden-path.mp4` (90–120 seconds), `results.json`, and diagnostics. WebXR
adds `controller-path.mp4` (20–30 seconds). Images include failure/regression
conditions; the main video follows the successful flow, including ordinary user
cancellation. Results match by case ID; platform exceptions may change image numbers.
Existing results are removed only after a new full run passes. Failed or partial
runs retain prior evidence. No generated recordings or screenshots belong in Git.

Videos use real continuous recordings at normal speed, never still-image slideshows.
Only completed action boundaries are cut. All animation and gesture movement
inside each chapter remains intact. The golden pass does not invoke native
screenshot export; its images are extracted afterward, preventing Preview pauses
from altering the walkthrough. The browser clock is aligned using a captured
magenta marker outside the final chapters; Specs uses actual ScreenCaptureKit
recording timestamps. Raw recordings and capture metadata remain in diagnostics.
Production UI scale and font sizes are not changed for recording. Declared capture
crops keep UI readable, with wider views for world interactions.

Fixtures simulate transport, camera, recognition and input facts, not production
state owners. WebXR drives emulated XR joints/controllers; Specs uses native SIK
events with a test interactor. Actual hardware hand tracking, ASR quality, robot
motion and device performance still need on-device verification.

`MultiClient.spec.ts` additionally starts one production Python ARModule and
connects five independent browser contexts to its real WebSocket server. It checks
selected-mode planning exclusivity across the first release, shared preview and
target state, the observer's grey cross, confirmation, handover, and disconnect
cleanup. Only native robot ports/planning and headset origins are simulated.
The fixture uses `$DIMOS_PYTHON`, `$CI_VENV/bin/python`, or `python3` on `PATH`,
in that order. The selected Python needs Python 3.12+ and the ARModule runtime
dependencies. The GitHub WebXR job installs and verifies this backend independently
of the Python unit-test job; the local CI script selects its backend virtualenv
explicitly. Run it alone with
`npx playwright test tests/integration-tests/MultiClient.spec.ts` from WebXR.
Physical cross-headset alignment and native Lens interaction remain device checks.

Validate the contract and encoder without a headset:

```sh
node --test tools/integration-tests/integration.test.mjs tools/visual-review.test.mjs
```

`finalize.mjs --client webxr|specs --run <directory> --scope all|golden|regression`
checks coverage, images and timing. Scoped runs explicitly mark other cases
not-run. They cannot authorize cleanup of existing results. A fresh full native
run also verifies restoration of the current production project without fixtures.


## Manipulation parity review

OpenYAM has an additional deterministic fixture shared by WebXR's
`Manipulation.spec.ts` and Specs' `ManipulationProbe.ts`. The native fixture copy
is checked against the browser fixture by the tooling tests. Review these paths
in addition to the Go2 catalog:

| Behavior | WebXR | Specs |
| --- | --- | --- |
| Measured full-pose marker, link bounds and model signature | Browser fixture | Native production renderer |
| Selected target, checked plan, articulated preview, exact execution binding | Controller path | Native SIK interaction |
| Unselected acquire/update/release | Controller and hands | Native SIK interaction |
| Second-hand Open/Close during drag | Hand path | Native second interactor |
| Speed, cancel/reset/resume, stop and tracking/session invalidation | Core/host regressions | Core/host regressions |
| Environment-depth occlusion of bounds/path | Optional adapter | Deferred platform exception |

Standalone manipulation runs retain their own screenshots, continuous video and
assertion logs. They do not substitute for the complete shared Go2 catalog or
physical device sign-off.

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
