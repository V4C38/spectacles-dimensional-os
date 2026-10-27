# Native Specs integration tests

The runner uses the shared [integration catalog](../../../tools/integration-tests/README.md)
and runs the production Lens in a disposable Lens Studio 5.15 project. Native
SIK/SUK controls, ClientCore state and production renderers remain active;
transport, camera capture, recognition and tracked input poses are deterministic
fixtures. Physical hand tracking, recognition quality, hardware audio playback
and on-device performance still need Spectacles checks.

Start the 5.15 CLAD app and its MCP server, then reserve the MCP session:

```sh
/Volumes/M2_EXT_1/CLAD/tools-venv/bin/python clients/specs/tools/review.py
```

The default `--suite all` runs both suites. Use `--suite golden` or
`--suite regression` for diagnosis. The golden path follows all 25 shared
chapters in about 103 seconds at normal speed. It records continuous rendered
footage and performs **no screenshot exports during the flow**. The shared
finalizer extracts its stills after capture finishes. The 18 regression/platform cases run
separately and export native Preview PNGs after their assertions. Brief outcome
animations use frames from the continuous recording.

Results default to `clients/specs/Tests/integration-tests/test-results/<runId>/`:

- `golden-path.mp4`: readable 1280×900, 30 fps, 90–120 second continuous walkthrough.
- `01_setup_entry.png`, etc.: catalog-ordered case evidence, matching WebXR names.
- `results.json`: catalog coverage, assertion results and source identity.
- `golden/` and `regression/`: per-suite manifests, events, native logs and evidence.
- `<suite>/diagnostics/`: original recording, frame-clock metadata and recorder log.
- `editor-restoration.json`: source project restoration result.

The raw recording contains only Preview content, including aspect-preserving
padding when needed. Chapter framing uses camera-projected UI/world bounds.
The recorder uses the display compositor, prevents idle sleep and keeps Lens
Studio foreground. It finds the Preview viewport through macOS Accessibility,
refreshes its bounds during window resizing, and reframes chapters without
changing UI scale. Its metadata records windows, viewport bounds and actual
ScreenCaptureKit timestamps. Video duration must match the capture clock; visual
inspection of checkpoint frames remains necessary. No slideshow is substituted.

The runner dismisses blocking Home/Welcome windows. It copies source assets,
attaches the harness with the editor API, waits for native compilation, and
restores and resumes the real source project after success or failure. It never
hand edits scene files. `--keep-open` is an explicit diagnostic opt-out: that
project contains fake hardware ports and scripted UI transitions.

Use `--app`, `--mcp-config`, `--work-root` and `--output-root` on other machines.
The private MCP JSON contains `url` and `token`; credentials are never copied to
projects or results. Requirements are the official Python `mcp` package, Node.js,
FFmpeg, Xcode command-line tools, Screen Recording permission, and Accessibility
permission for the terminal/recorder. `--recorder` selects an existing binary;
otherwise Swift compilation is cached under `~/Library/Caches/dimos-specs-review`.

Cold SDK imports may take several minutes. The 600-second deadline accommodates
regression PNG exports that can each pause Preview for 30 seconds. Golden timing
uses visible frame time and has no such exports. Native 5.15 has no LEAF or
runtime PreviewInteract bridge: the fixture drives public Interactable events
with the real registered editor interactor. Native Frame manipulation and
following use injected pose ports; callbacks are not replaced with fake motion.

`--prepare-only` makes a copy without connecting. `--prepared-project` retries a
runner-created disposable project and refreshes the test harness; it does not
refresh production scripts. Use a fresh default run to validate changed source.
Do not hot reload during recording; duplicate chapter names fail the run.

Run tooling checks without Lens Studio:

```sh
python3 -m unittest discover -s clients/specs/Tests/integration-tests -p 'test_*.py'
```

Focused repo-backed probes use the same runner and restoration contract:

```sh
/Volumes/M2_EXT_1/CLAD/tools-venv/bin/python clients/specs/tools/review.py --harness clients/specs/Tests/integration-tests/HeightProfiles.ts
/Volumes/M2_EXT_1/CLAD/tools-venv/bin/python clients/specs/tools/review.py --harness clients/specs/Tests/integration-tests/NativeInteractionProbe.ts
/Volumes/M2_EXT_1/CLAD/tools-venv/bin/python clients/specs/tools/review.py --harness clients/specs/Tests/integration-tests/BendyLaserProbe.ts
/Volumes/M2_EXT_1/CLAD/tools-venv/bin/python clients/specs/tools/review.py --harness clients/specs/Tests/integration-tests/NavMarkerOverlapProbe.ts
```

`HeightProfiles` measures setup heights and fixed world top edge.
`NativeInteractionProbe` exercises PIN/IP, follow and restart with real disabled
or idle audio. `HeaderProbe` measures native title baselines. These diagnostic
runs cannot substitute for complete catalog coverage.
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
`diagnostics/source-audit/`. Old result directories are removed with the shared safe cleanup command only
after a complete, passing `all` run; failed and partial runs never trigger cleanup.

# Rebuilding world shaders

Readable shader code is checked in under `Assets/Materials/Shaders/*.customCode`.
The legacy graph generator uses those files, the installed 5.15 Empty graph and
an existing project custom-code/float-parameter node as templates:

```sh
python3 clients/specs/tools/shaders/generate.py \
  --app '/Volumes/M2_EXT_1/CLAD/LS 5.15 CLAD.app' \
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
directory, writes `compile.log` and `result.json`, and never upgrades the project.
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
