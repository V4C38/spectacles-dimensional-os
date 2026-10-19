# DimOS WebXR client

Standalone WebXR host for ARModule. It reuses portable ClientCore from [`../specs/Assets/Scripts/DimOSARClient`](../specs/Assets/Scripts/DimOSARClient) and talks to ARModule only over the [`PROTOCOL.md`](../../dimos-ar/PROTOCOL.md) WebSocket.

Composition root: `DimOSWebXRClient`. Stack: Google XR Blocks + Three.js + Vite.

The landing page has a **Your headset** control. Current options: Quest 3 (`quest3`) and Quest 3S (`quest3s`).

## Requirements

- An HMD from the selector
- HTTPS page origin (Vite serves HTTPS for LAN headset access)
- ARModule already listening on `ws://127.0.0.1:8787` on the same machine as Vite
- The selected HMD profile (`src/camera/hmdProfiles.ts`)

The Quest browser opens the WebXR page and connects to same-origin `wss://<page-host>/ar`. Vite forwards `/ar` to local ARModule. The headset never types an ARModule IP or port. A non-HTTPS page fails before XR entry. The selected HMD profile is the camera calibration.

If ARModule restarts, ClientCore reconnects `/ar` every second. Vite forwards each new attempt. Localization origin is cleared on disconnect, so the wearer localizes again. If Vite itself stops, reload the page.

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
LiDAR stays off in setup and defaults to obstacles afterward.

Show your left palm or press controller button 4 to open the menu in front of you,
18 cm below eye level and about 90 cm away. It follows head movement slowly, with an
approximately 1.8-second time constant; grabbing the panel pauses following. Choose Manual for drag navigation
and the left joystick; choose Agent for conversation. Voice listens for “agent”, keeps a
30-second conversation window, and handles “stop” with the existing emergency-stop command.
Select Message agent for an in-world keyboard when [browser recognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition) is unavailable or denied.
Robot name, connection, activity, prompt and response appear above the robot.

The tracking reference space lasts for the immersive session. Focus loss pauses input and
capture while retaining setup and alignment. Reference-space resets with a reported transform
are compensated using an offset reference space. A reset without a transform invalidates
alignment because the runtime cannot relate the old coordinates to the new ones. Exiting AR
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

The framework's controller target-ray transform, ordered hit list, `User` capture/selection,
button callbacks and native reticle drive both UI and world interaction. The beam attaches
to the framework's controller and ends at the same first hit. A miss shows a 3 m beam;
registered surfaces remain targetable up to 20 m, with no minimum distance that prevents
close interaction. There is no separate pose reader, application hit sorter, UI raycaster,
or cursor implementation. See [XR Blocks 0.18 input](https://github.com/google/xrblocks/blob/v0.18.0/src/input/Input.ts)
and [Three.js raycaster layers](https://threejs.org/docs/pages/Raycaster.html#layers).

The navigation marker has a white circle and arrow with a transparent center, and follows
the robot while idle. Routes render white at 1.5 cm width. Robot position and rotation use
the Specs smoothing rates (8 and 4.5 per second); the robot label is quarter size and the
gizmo is 20% smaller. LiDAR draws before UI without writing depth.

Navigation uses the horizontal plane
at the localized robot's floor height, so dragging does not require a room scan.
Temporary tracking/focus loss pauses input and capture while keeping the socket and
alignment. Reported recenter transforms preserve alignment; an unknown reset or session exit clears it.

## Browser startup regression and logs

`npm run test:browser` starts a separate HTTPS test server on port 5175 and uses Meta's
[IWER Quest runtime](https://meta-quest.github.io/immersive-web-emulation-runtime/getting-started.html)
to verify rendered setup text, controller-trigger / hand-pinch activation, connection,
camera capture, automatic localization completion and the runtime panel.
Install Chromium once with `npx playwright install chromium`. These tests exercise Vite's
runtime bundling, which the Node-only unit tests cannot cover. They simulate the robot and camera boundary; they do not measure hardware accuracy.
Screenshots are written under `test-results/`.

During development, browser startup, XR session, panel placement and exception diagnostics
are forwarded through Vite to the launcher's existing log as `[WebXR browser]` entries.
The browser console also retains them. Add `?debug=1` to inspect XR Blocks' `window.xb` scene.
The actual `three-mesh-bvh` dependency must be installed: an empty stub can overwrite
`Mesh.raycast` and crash the render loop before setup is drawn.
