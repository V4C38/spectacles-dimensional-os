# Native Specs integration tests

The runner uses the shared [integration catalog](../../../tools/integration-tests/README.md)
and runs the production Lens in a disposable Lens Studio 5.15 project. Native
SIK/SUK controls, ClientCore state and production renderers remain active;
transport, camera capture, recognition and tracked input poses are deterministic
fixtures. Physical hand tracking, recognition quality, hardware audio playback
and on-device performance still need Spectacles checks.

Install the official Python MCP SDK into your chosen tools environment and activate it. Set `DIMOS_CLAD_ROOT` to your CLAD installation root (default `~/.local/share/ls515-clad`), containing the app and `ls515-clad/state/mcp.json`, or pass `--app` and `--mcp-config` explicitly. Start the 5.15 CLAD app and its MCP server, then reserve the MCP session:

```sh
python3 clients/specs/tools/review.py
```

The default `--suite all` runs the golden and regression suites plus the manipulation
and navigation-overlap probes. Use `--suite golden` or
`--suite regression` for diagnosis. The golden path follows the shared
chapters with 87 seconds of declared holds at normal speed, including one brief re-localization. The shared catalog
owns chapter order and duration limits. It records continuous rendered
footage and performs **no screenshot exports during the flow**. The shared
finalizer extracts its stills after capture finishes. The 18 regression/platform cases run
separately and export native Preview PNGs after their assertions. Brief outcome
animations use frames from the continuous recording.

Results default to `Review Data/specs/<runId>/`:

- `golden-path.mp4`: readable 1280×900, 30 fps, 75–105 second continuous walkthrough, produced by default.
- `01_setup_entry.png`, etc.: catalog-ordered case evidence, matching WebXR names.
- `results.json`: catalog coverage, assertion results and source identity.
- `golden/` and `regression/`: per-suite manifests, events, native logs and evidence.
- `<suite>/diagnostics/`: original recording, frame-clock metadata and recorder log.
- `editor-restoration.json`: source project restoration result.

After a complete successful `all` or `golden` run and the production source handoff
audit, the latest video is atomically published as **`Review Data/specs_golden-path.mp4`**.
Failed, incomplete, focused-probe and `--keep-open` runs preserve the prior video.
This stable publication path also applies when `--output-root` changes run storage.

Publication requires matching production and tested-workspace input manifests,
covering production `Assets/` and `.esproj` files. Harness scene changes
are recorded as editor-owned overlays. A stale or modified prepared workspace may
still be inspected diagnostically but cannot publish a current-source golden video.

The raw recording contains only Preview content, including aspect-preserving
padding when needed. Chapter framing uses camera-projected UI/world bounds.
The review runner holds renewable macOS idle-display and user-active assertions
from startup through the final production handoff and media publication. It releases
only its own assertions on exit, including failures; a crashed owner releases them
too. Source-audit, editor-launch and offline compilation commands also guard their
execution. No screen-saver/password preferences are changed.

For queued LS work, follow [AGENTS.md](../../../AGENTS.md#lens-studio-queued-work-and-automatic-screen-locking):
start a unique `ls_awake.py` lease as soon as LS work is requested, retain it during
preparation, and stop it in final cleanup after the last LS action. Detached leases
expire after four hours by default or on owner exit. Replace an expiring lease
before releasing it if work remains. Other tasks' guards are independent.
These guards prevent automatic idle locking; an existing/manual/managed lock still
requires an unlocked session before visual verification.

The recorder uses the display compositor, prevents idle sleep and allows bounded attempts to keep Lens
Studio foreground under the focus limit below. It finds the Preview viewport through macOS Accessibility,
refreshes its bounds during window resizing, and reframes chapters without
changing UI scale. Its metadata records windows, viewport bounds and actual
ScreenCaptureKit timestamps. Video duration must match the capture clock; visual
inspection of checkpoint frames remains necessary. No slideshow is substituted.

The runner dismisses blocking Home/Welcome windows. It copies source assets,
attaches the harness with the editor API, waits for native compilation, and
restores and resumes the real source project after success or failure. It never
hand edits scene files. `--keep-open` is an explicit diagnostic opt-out: that
project contains fake hardware ports and scripted UI transitions.

Disposable projects default to `Review Data/specs-work/<runId>/`.
Use `--app`, `--mcp-config`, `--work-root` and `--output-root` to override defaults.
Quote paths containing spaces, for example `--output-root "/path/to/review evidence"`.
The private MCP JSON contains `url` and `token`; credentials are never copied to
projects or results. Requirements are the official Python `mcp` package, Node.js,
FFmpeg, Xcode command-line tools, Screen Recording permission, and Accessibility
permission for the terminal/recorder. `--recorder` selects an existing binary;
otherwise Swift compilation is cached under `~/Library/Caches/dimos-specs-review`.

Run native compilation/review and the official mock manipulation contract sequentially. Cold Lens imports can saturate the desktop and exceed the unchanged 500 ms control lease; the resulting E-stop is a valid fail-closed response, not a reason to loosen deadlines.

Cold SDK imports may take several minutes. The 600-second deadline accommodates
regression PNG exports that can each pause Preview for 30 seconds. Golden timing
uses visible frame time and has no such exports. Native 5.15 has no LEAF or
runtime PreviewInteract bridge: the fixture drives public Interactable events
with the real registered editor interactor. Native Frame manipulation and
following use injected pose ports; callbacks are not replaced with fake motion.

`--prepare-only` makes a copy without connecting. `--prepared-project` retries a
runner-created disposable project and refreshes the test harness; it does not
refresh production scripts, assets or packages. This diagnostic reuse preserves
the original tested-input identity. Use a fresh default run to validate changed source.
Do not hot reload during recording; duplicate chapter names fail the run.
When retrying after an ordinary test failure, pass `--focus-budget` with the prior
run's `focus-budget` path so restoration attempts remain cumulative. An aborted
budget still refuses to resume; only explicit user authorization permits a new
budget after a focus-limit abort.

Canonical full golden video and all functional/failure evidence remain enabled by
default. Pass `--extra-media` for edited probe and supplemental review clips. A
focused probe without `--keep-open` must also pass the restored-source audit.

Run tooling checks without Lens Studio:

```sh
python3 -m unittest discover -s clients/specs/Tests/integration-tests -p 'test_*.py'
```

Focused repo-backed probes use the same runner and restoration contract:

```sh
python3 clients/specs/tools/review.py --harness clients/specs/Tests/integration-tests/BendyLaserProbe.ts
python3 clients/specs/tools/review.py --harness clients/specs/Tests/integration-tests/NavMarkerOverlapProbe.ts
```

Setup profile heights, fixed top edge, follow controls, PIN/IP, audio reset,
frame grabbing and header metrics belong to the shared catalog scenarios.
Focused probes retain only additional coverage and cannot replace a full run.
`BendyLaserProbe` verifies that the straight beam mirrors the rendered SIK cursor,
including during motion and held input, and checks width, opacity, start offset,
tracking loss, direct input and native ray-only targets. `NavMarkerOverlapProbe`
uses real physics hits and SIK's target chooser to drag an unselected marker through
the robot's selection box, then verifies that robot picking and UI occlusion remain.

Harness log lines begin `SPECS_REVIEW ` followed by JSON. Each result includes
`caseId`, `name`, boolean `passed`, and `unixMs`. The canonical case assertion
has `name === caseId`; additional measurements are allowed. Scenes include
catalog ID, duration and optional normalized capture bounds. Completion alone
cannot pass a suite: mandatory cases need actual assertions and image evidence.
The Source byte/compiler audit gates overall success and is saved under
`diagnostics/source-audit/`. Earlier passing full runs in the default results directory may be removed only
after a complete, passing `all` run. Failed, partial and unclassified evidence stays;
explicit output directories never trigger automatic cleanup of neighboring runs.

# Rebuilding world shaders

Readable shader code is checked in under `Assets/Materials/Shaders/*.customCode`.
The custom-node template lives under `tools/shaders/templates/`, outside shipped
Lens assets.
The legacy graph generator uses those files, the installed 5.15 Empty graph and
an existing project custom-code/float-parameter node as templates:

```sh
python3 clients/specs/tools/shaders/generate.py \
  --app "$DIMOS_CLAD_ROOT/LS 5.15 CLAD.app" \
  --out /tmp/specs-shaders
```

Generation is deterministic for the same sources/templates and does not change
checked-in assets by default. No Snap binary templates are vendored. Import
generated graphs with CLAD/editor APIs and create materials with
`material.addPass(importedPass)`. Then compile and inspect native render captures
before replacing production assets. Native saving may populate compiler caches;
these are not a reason to hand-author the caches or migrate graph formats.

The codec preserves all original primitive types and bytes. In particular,
node IDs/counts and port metadata require `UInt32`, while dependency indices and
connection target IDs use `Int32`. Mixing these caused native import to fail
with a misleading missing-generated-GLSL error during preflight. Existing shader
roundtrip coverage protects this container contract.


### Static native compilation without CLAD

If the CLAD drive is unavailable, validate current scripts against the installed
5.15 compiler and existing package cache without touching the production scene:

```sh
python3 clients/specs/tools/compile_scripts.py --include clients/specs/Tests/integration-tests/LidarAlignmentProbe.ts
```

The command copies current scripts and cached package declarations into a disposable
`Review Data/native-compile/compile-<unique>/` directory, writes `compile.log` and
`result.json`, and never upgrades the project. Use `--output-root` to select another directory.
`--include` uses the same harness preparation as Preview, including sibling fixtures
and the generated shared catalog; stale Review assets from the cache are excluded.
A pass proves native TypeScript/component compilation only, not GPU rendering,
scene wiring, stereo alignment or on-device performance.

`LidarAlignmentProbe.ts` renders the production LiDAR shader alongside hollow native
reference brackets at 1/2/3 metres, then moves the camera laterally. Its
`LIDAR_ALIGNMENT` logs contain raw odometry, composed world centres and native screen
projections for comparison with captured frames. The fixture initialization result
is not an automatic GPU/stereo alignment assertion. In the real lens, Debug enables
bounded `LiDAR alignment` samples every 30 seconds, including the advertised XY
scale factor and corrected/native planar distances. At factor 1.25, 1.2 native
metres becomes 1.5 displayed metres; this is a shared server heuristic, not
evidence of a Specs-only rendering defect. Do not add fixed offsets or undo
the shared odometry scale factor without a measured failing transform boundary.

For a 20-minute device soak, record `Capture diagnostics` with the camera gate open
and closed, LiDAR on/off, and after repeated localization misses. During closed-gate
and cooldown periods, encode/send counts must not advance; native encodes must never
overlap, and camera listener counts must return to zero between runtime batches.
Compare FPS/worst-frame time and a Spectacles Monitor trace; desktop virtual-time
budget tests cannot establish headset thermal, memory or stereo behavior.

## Native execution policy

[AGENTS.md](../../../AGENTS.md#lens-studio-integration-test-focus-limit) owns the focus-restoration budget, abort/resume rules, editor-only harness requirements and production handoff checks. Follow that policy for every run. The runner persists one focus budget across recorder processes and suites through `FocusPolicy.swift`. It disables the disposable harness on exit and gates success on restored production source with Auto Run false, matching compiler bytes and matching source/workspace manifests. Never deploy a disposable test copy.

## Specs arm rendering

Arm links retain the canonical model geometry. ArmStroke stores link-local endpoints
and fixed local-length dashes; rigid motion updates pose uniforms, not vertex buffers.
Only the vertex shader projects outlines. Its fragment shader performs dash masking
and simple antialiasing without projection or distance-dependent dash merging.
ArmSurface provides flat color/opacity; end-effector indicators retain Fresnel.
Surface and outline buffers upload once per model revision. Per-link displacement uses 15 opacity uniforms whose
coefficients sample the latest state at 10 Hz with no catch-up queue, then smooth
over 0.12 seconds. The vertex shaders evaluate point opacity and send it through a
native Interpolate node to the fragment shaders. This retains spatial fading without
rebuilding meshes for alpha changes. Zero-opacity fills are disabled independently
of visible outlines. Global fades, poses and warning colors remain at display rate.
Automated upload and shader-graph checks do not establish headset FPS or power use.

SpecsArmPanelPresenter owns the native Frame, attached/pinned state and placement.
Controls live under Frame.content; the frame's top center attaches 13 cm below the
localized arm-base origin in the viewing plane. Grabbing/resizing pins it; Pin
returns it to the current base. Missing arm root poses hide the frame rather than
placing it at odometry zero. The full native command now includes ManipulationProbe,
which checks Frame ancestry, anchor geometry and outline upload budgets. These
checks remain opt-in through Integration Test Harness and cannot run on device.

Successful non-golden raw recordings are discarded after validation unless extra
media is requested. Golden footage, screenshots, logs and failure recordings remain.
