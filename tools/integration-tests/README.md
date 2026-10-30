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
