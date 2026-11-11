# Client integration contract

`scenarios.json` is the shared coverage contract for WebXR and Spectacles 2024.
It defines stable case IDs, applicability, the ordered hand-input golden paths,
its timing budget, and deterministic server/hardware fixtures. Cases cannot be
substituted by similarly named screenshots: every applicable case needs a real
passing assertion with its exact ID and a captured image. Unsupported platform
features are listed explicitly as not applicable; missing implementations fail.

Run WebXR from `clients/webxr` with `npm run test:integration`. It runs only the
compact hand golden path (setup, navigation, agent, LiDAR and manipulation) and
short controller walkthrough, then validates their media
and coverage. Detailed behavior remains covered by backend and client unit tests.
The native Specs command and Lens Studio prerequisites are described in
`clients/specs/tools/README.md`. Native runs use Lens Studio 5.15 CLAD, disposable
project copies, actual SUK/SIK controls and source-project restoration.

Outputs are ignored and live under:

- `Review Data/specs/<run-id>/`
- `Review Data/webxr/<run-id>/`

Paths are relative to the repository root, regardless of the invoking directory.
WebXR accepts an explicit run directory through `INTEGRATION_RESULTS_DIR`; native
review accepts a parent directory through `--output-root`. Quote paths containing
spaces. Explicit destinations keep their evidence without pruning neighboring runs.
Direct Playwright invocations use `Review Data/webxr/playwright/` diagnostics.
Unit reports, coverage, static native compilation and official mock contracts live
under `Review Data/unit/`, `coverage/`, `native-compile/` and `mock-manipulation/`.

The latest verified golden videos always have these stable top-level paths:

- `Review Data/webxr_golden-path.mp4`
- `Review Data/specs_golden-path.mp4`

Publication atomically replaces only that client's previous video after the whole
run passes its functional, golden-media and source checks. Specs also requires the
production source handoff audit. A complete native `--suite golden` run can publish;
incomplete, failed, focused-probe and `--keep-open` runs leave the previous video
intact. Each run keeps its own evidence below the client directory. Explicit output
overrides change run storage; the latest verified video still publishes at the
stable repository-root path. Older client-prefixed golden export spellings are
removed only after a new successful publication; unrelated files remain.

Each completed full run contains consecutively numbered `01_setup_entry.png` style
images, `golden-path.mp4` (WebXR targets one minute within 45–75 seconds;
native Specs uses 16 chapters with 87 seconds of declared holds within 75–105), `results.json`, and diagnostics. Both golden paths include one brief re-localization. The
canonical golden video is produced by default for both clients. Set
`INTEGRATION_EXTRA_MEDIA=1` for WebXR or pass native `--extra-media` to also encode
controller/probe and supplemental edited clips. Functional tests and failure
artifacts run regardless of that option. Images include failure/regression
conditions; the main video follows the successful flow, including ordinary user
cancellation. Results match by case ID; platform exceptions may change image numbers.
Earlier passing full runs may be removed after a new full run passes. Failed, partial
and unclassified runs retain their evidence. No generated recordings or screenshots belong in Git.

Videos use real continuous recordings at normal speed, never still-image slideshows.
Only completed action boundaries are cut. All animation and gesture movement
inside each chapter remains intact. The golden pass does not invoke native
screenshot export; its images are extracted afterward, preventing Preview pauses
from altering the walkthrough. The browser clock is aligned using a captured
magenta marker outside the final chapters; Specs uses actual ScreenCaptureKit
recording timestamps. Golden and failure recordings and capture metadata remain
in diagnostics; successful non-golden raw recordings follow the retention policy below.
Production UI scale and font sizes are not changed for recording. Declared capture
crops keep UI readable, with wider views for world interactions.

Fixtures simulate transport, camera, recognition and input facts, not production
state owners. WebXR drives emulated XR joints/controllers; Specs uses native SIK
events with a test interactor. Actual hardware hand tracking, ASR quality, robot
motion and device performance still need on-device verification.

Validate the contract and encoder without a headset:

```sh
node --test tools/integration-tests/integration.test.mjs tools/visual-review.test.mjs
```

`finalize.mjs --client webxr|specs --run <directory> --scope all|golden|regression`
checks coverage, images and timing. Scoped runs explicitly mark other cases
not-run. They cannot authorize cleanup of existing results. A fresh full native
run also verifies restoration of the current production project without fixtures.


## Native manipulation review

Specs retains its deterministic manipulation fixture and native probes. Both clients include arm selection, checked Preview
and Execute, unselected following/release, gripper, Reset and Stop/Resume in the
same golden video. The full native run retains additional manipulation probes.
Browser motion uses a fixture; the official ARModule mock
contract remains the evidence for installed DimOS planning/control.

## Native execution policy

[AGENTS.md](../../AGENTS.md#lens-studio-integration-test-focus-limit) owns focus,
Auto Run, disposable-project and source-restoration rules. Every non-`--keep-open`
native run, including focused probes, must pass the source handoff audit.

## Official manipulation runtime

`python dimos-ar/tools/run_mock_manipulation_contract.py` exercises the installed DimOS planning/control composition through the current AR control/bulk protocol. Install `dimos-ar[manipulation,dev]` in the selected Python 3.12 environment first. The runner always selects mock hardware, disables relay/localization, uses a temporary configuration, chooses a localhost test port, and owns cleanup of its process group. The local CI gate and ARModule GitHub job run this contract; a browser mock planner does not replace it.

Successful non-golden raw recordings are discarded after validation unless extra
media is requested. Golden footage, screenshots, logs and failure recordings remain.

## Browser coverage boundary

Browser CI contains two walkthroughs: the compact hand golden path (including
manipulation) and controller input. WebXR-specific chapter order and holds live in
`golden.webxrChapters`; `golden.chapters` has the same compact order with native
holds long enough for complete SIK gestures. Repeated panel/settings tours are
covered by unit tests and native regressions where declared, not counted as golden coverage.
Repeated startup, layout, rendering, manipulation soak and failure-matrix browser
tests have been removed. The catalog explicitly limits WebXR applicability to
these walkthroughs; native Specs regression requirements remain unchanged.
