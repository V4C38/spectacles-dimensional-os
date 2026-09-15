# DimOS WebXR client

Standalone WebXR host for ARModule. It reuses portable ClientCore from [`../specs/Assets/Scripts/DimOSARClient`](../specs/Assets/Scripts/DimOSARClient) and talks to ARModule only over the [`PROTOCOL.md`](../../dimos-ar/PROTOCOL.md) WebSocket.

Composition root: `DimOSWebXRClient`. Stack: Google XR Blocks + Three.js + Vite.

The landing page has a **Select HMD** control. Current options: Quest 3 (`quest3`) and Quest 3S (`quest3s`).

## Requirements

- An HMD from the selector
- HTTPS page origin (Vite serves HTTPS for LAN headset access)
- ARModule already listening on `ws://127.0.0.1:8787` on the same machine as Vite
- Accepted calibration profile for the selected HMD (`src/camera/hmdProfiles.ts`)

The Quest browser opens the WebXR page and connects to same-origin `wss://<page-host>/ar`. Vite forwards `/ar` to local ARModule. The headset never types an ARModule IP or port. Unaccepted profiles or a non-HTTPS page fail before XR entry.

If ARModule restarts, ClientCore reconnects `/ar` every second. Vite forwards each new attempt. Localization origin is cleared on disconnect, so the wearer localizes again. If Vite itself stops, reload the page.

## Develop

```bash
cd clients/webxr
npm ci
npm test
npm run dev
```

Run ARModule first. Open the HTTPS LAN URL Vite prints in the headset browser (bookmark it). Enter AR requires an HMD selection.

```bash
npm run build
npm test
npm run preview
```

`preview` serves `dist/` with the same `/ar` proxy.

## Tests

`npm test` is the `client-webxr-tests` job. It covers transport framing, same-origin `/ar` URLs, coordinates, calibration matching, timestamps, ray-floor placement, navigation marker lifecycle, joystick stop behavior, and `localization_observations` byte compatibility with ClientCore.
