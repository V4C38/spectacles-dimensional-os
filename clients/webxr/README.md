# DimOS WebXR client

Standalone WebXR host for ARModule. It reuses portable ClientCore from [`../specs/Assets/Scripts/DimOSARClient`](../specs/Assets/Scripts/DimOSARClient) and talks to ARModule only over the [`PROTOCOL.md`](../../dimos-ar/PROTOCOL.md) WebSocket.

Composition root: `DimOSWebXRClient`. Stack: Google XR Blocks + Three.js + Vite.
Domain folders mirror ClientCore and Specs; see [CONTRIBUTING.md](../../CONTRIBUTING.md#webxr-architecture) for ownership and the ARModule → ClientCore → host mapping.

The landing page has a **Your headset** control. Current options: Quest 3 (`quest3`) and Quest 3S (`quest3s`).

## Requirements

- An HMD from the selector
- HTTPS page origin (Vite serves HTTPS for LAN headset access)
- ARModule already listening on `ws://127.0.0.1:8787` on the same machine as Vite
- The selected HMD profile (`src/localization/HmdProfiles.ts`)

The Quest browser opens the WebXR page and connects to same-origin `wss://<page-host>/ar`. Vite forwards `/ar` to local ARModule. The headset never types an ARModule IP or port. A non-HTTPS page fails before XR entry. The selected HMD profile is the camera calibration.

If ARModule restarts, ClientCore reconnects `/ar` every second. Vite forwards each new attempt. Localization is retained across a transient disconnect only when the server advertises the same odometry reference and headset tracking remains valid. A changed or unavailable reference requires re-localization. If Vite itself stops, reload the page.

The launcher builds the optimized WebXR bundle and starts its compressed HTTPS preview only after ARModule reports that its WebSocket server is
ready. During robot startup, the WebXR page is temporarily unavailable and its
links remain hidden in the launcher. An already-open page can reconnect once
Vite starts; reload it if the browser does not recover automatically. This keeps
WebXR proxy requests out of robot initialization. When running Vite independently,
start ARModule first.

## Develop

```bash
cd clients/webxr
npm ci
npm test
npm run dev
```

Run ARModule first. Open the HTTPS LAN URL Vite prints in the headset browser (bookmark it). Select the HMD and press **Allow camera**, accept the browser permission prompt, then
press **Enter AR**. Camera permission and a successfully opened, calibrated physical camera
are required before XR entry. The permission request uses a preferred environment facing
mode; required device constraints are applied only after permission and enumeration.
The permission stream remains live during enumeration so temporary grants expose labels.
Avatar cameras are never used for localization.

If no headset-camera prompt appears, check the site's camera permission and the Browser
app's headset-camera permission in Quest settings. Meta tracks a
[Quest Browser headset-camera permission issue](https://developers.meta.com/vr/support/investigations/1557993751977106/)
where only the avatar camera is exposed. A website cannot grant the Browser app's OS
permission. For development devices affected by that issue, Meta reports that granting
`horizonos.permission.HEADSET_CAMERA` to `com.oculus.browser` with ADB resolves it:

```bash
adb shell pm grant com.oculus.browser horizonos.permission.HEADSET_CAMERA
```

Reload the page afterward and repeat **Allow camera**. See the
[Media Capture specification](https://www.w3.org/TR/mediacapture-streams/#dom-mediadevices-getusermedia)
for the permission and constraint-selection sequence.

```bash
npm run build
npm test
npm run preview
```

`preview` serves `dist/` with the same `/ar` proxy.

## Tests

`npm test` is the `client-webxr-tests` job. It covers transport framing, same-origin `/ar` URLs, coordinates, calibration matching, timestamps, ray-floor placement, navigation marker lifecycle, joystick stop behavior, and `localization_observations` byte compatibility with ClientCore.

## Setup and controls

The in-world wizard follows **Connect → Localization**. Connection
uses the serving PC through `/ar`, with automatic retries and a visible handshake state.
Back pauses capture; returning resumes a retained server prompt. Localization success finishes
setup automatically. Skip opens runtime controls without enabling spatial navigation.
LiDAR stays off in setup and defaults to obstacles afterward. Mode selection changes
when ARModule confirms settings; point limits remain local rendering preferences.

Show either palm or press controller button 4 to summon the runtime menu. It
follows the summoning hand/controller and faces the viewer; grabbing it or losing
that source pins it. The setup panel uses its own viewer-following placement.
Choose Manual for direct marker dragging, floor placement and the left joystick;
choose Agent to edit and send a message. Voice edits the draft while the field is
held; it does not open a wake-phrase conversation window.
Hold the message field to record, release to review, and press Send to agent.
Further recordings append to the draft; Clear empties it. Scrollbars and controller
thumbsticks reveal long text. Recording requires browser speech recognition.
Robot name, connection, activity, prompt and response appear above the robot.

The tracking reference space lasts for the immersive session. Focus loss pauses input and
capture while retaining setup and alignment. Reference-space resets with a reported transform
are compensated using an offset reference space. A reset without a transform retires the old capture/transport episode and
retains alignment pending a user review. Dismissing the review closes the menu
without certifying the retained alignment; Realign reruns localization. Exiting AR
ends the tracking session; reenter from the landing page without reloading.

Camera localization uses the Quest 3 and Quest 3S device profiles directly. Model-specific
calibration files take precedence. See [CALIBRATION.md](CALIBRATION.md) for camera sources,
stream cropping, and the offline calibration utility.

Panels open at 60% of their previous size. Use the controller grip anywhere on a panel,
or trigger/pinch its header or bottom handle, to move and rotate it with smoothing.
Grab an edge with trigger/pinch and drag to resize, anchored at the opposite edge. Controller triggers and
hand pinches share the same ray/cursor interactions. `XRBlocksRayInteraction` configures
XR Blocks 0.18's `Input` raycaster to pick only registered application surfaces on interaction
layer 1. Camera rendering remains on layer 0. Controller/hand models, pointer visuals and
decorations stay visible but cannot intercept rays. Hidden UI is excluded at its mesh
raycast boundary, before hover, selection, or reticle resolution.

The framework supplies controller target rays, intersections, `User` capture/selection,
button callbacks and its native reticle. `WebXRInputController` owns gesture and
capture dispatch; `XRBlocksRayInteraction` filters and orders application hits,
including marker/robot priority and UI occlusion. The beam attaches
to the framework's controller and ends at the same first hit. A miss shows a 3 m beam;
registered surfaces remain targetable up to 20 m, with no minimum distance that prevents
close interaction. Direct fingertip presses use the same guarded button callbacks.
See [XR Blocks 0.18 input](https://github.com/google/xrblocks/blob/v0.18.0/src/input/Input.ts)
and [Three.js raycaster layers](https://threejs.org/docs/pages/Raycaster.html#layers).

The navigation marker has a white circle and arrow with a transparent center, and follows
the robot while idle. Routes render white at 1.5 cm width. Robot position and rotation use
the Specs smoothing rates (8 and 4.5 per second); the robot label is quarter size and the
gizmo is 20% smaller. LiDAR draws before UI without writing depth.

Navigation uses the horizontal plane
at the localized robot's floor height, so dragging does not require a room scan.
Temporary tracking/focus loss pauses input and capture while keeping the socket and
alignment. Reported recenter transforms preserve alignment; an unknown reset or session exit clears it.

## Integration tests and logs

`npm run test:integration` starts a separate HTTPS test server on port 5175 and uses Meta's
[IWER Quest runtime](https://meta-quest.github.io/immersive-web-emulation-runtime/getting-started.html)
to verify rendered setup text, controller-trigger / hand-pinch activation, connection,
camera capture, automatic localization completion and the runtime panel.
Install Chromium once with `npx playwright install chromium`. These tests exercise Vite's
runtime bundling, which the Node-only unit tests cannot cover. They simulate the robot and camera boundary; they do not measure hardware accuracy.
The harness lives in `tests/integration-tests/`. Each full run writes a new
Git-ignored `tests/integration-tests/test-results/<run-id>/` folder with numbered
images, `golden-path.mp4` (90–120 seconds), `controller-path.mp4` (20–30 seconds),
assertions and diagnostics. The main video follows the successful hand-input flow;
error and regression states are captured as images. Passing full runs replace old
results; failures retain previous evidence. `npm run review:video` regenerates
media for the latest run, or accepts an explicit run directory.

Both clients follow the shared [integration contract](../../tools/integration-tests/README.md).
The integration server disables hot reload so Lens Studio updates to shared
TypeScript configuration cannot restart the browser during a recording.

Browser diagnostics default to warnings and errors, deduplicated for 30 seconds.
Routine startup, connection, tracking, panel, and interaction traces are silent.
Use `?diagnostics=1` to enable rate-limited traces in the browser console and the
launcher's `[WebXR browser]` development log. `?debug=1` exposes XR Blocks' `window.xb`
scene without enabling traces; combine both parameters when needed.
The actual `three-mesh-bvh` dependency must be installed: an empty stub can overwrite
`Mesh.raycast` and crash the render loop before setup is drawn.

## Quest capture latency

Localization freezes each video frame together with its exposure timestamp and viewer pose. A persistent worker encodes full-resolution JPEGs at quality 0.85 using OffscreenCanvas; it avoids Chromium Android’s main-thread `toBlob()` idle-scheduling delay. Unsupported worker APIs use a reusable synchronous JPEG fallback. One encode may be pending, and camera stop cancels it. WebXR images older than 1.5 seconds are discarded before submission; three consecutive stale batches require an explicit retry. The server independently enforces its 2-second admission limit.

Use `?diagnostics=1` for frame/encoding/batch timing. Native Quest measurements during this change were about 4.04 seconds per image on the old path and 31–34 ms with the worker after a 100 ms cold call, at unchanged 1280×960 resolution and quality. These are device observations, not desktop benchmark guarantees. The launcher serves a production build by default; `npm run dev` remains the development/HMR command.
