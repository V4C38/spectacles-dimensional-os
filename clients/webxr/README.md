# WebXR client

The WebXR host shares portable ClientCore with Specs and renders through Three.js/XR Blocks.
Use Node 22 (`nvm use` at repository root) and Python 3.12 for backend tooling.

## Development

Run `npm ci`, then `npm run dev` for HTTPS development. `npm run build` checks types and builds production assets. Run `npm test` for unit tests and `npm run test:integration` for browser integration.

The browser service and ARModule have independent lifetimes. The shipped browser page uses the service's same-origin `/ar` backend route and paired bulk proxy; it has no remote PIN entry flow. The server-side PIN gateway remains available to explicit API consumers. Multiple clients can connect to the same backend; ARModule grants editing authority separately.

For physical XR use, trust the HTTPS certificate on the headset and ensure it can reach the browser service on the LAN. Supported headset profiles are Quest 3 and Quest 3S. Browser fixtures verify application behavior, not physical tracking, camera quality, or device performance.

## Quest microphone checks

Open the client directly over trusted HTTPS on the headset. Microphone capture uses
[`getUserMedia`](https://www.w3.org/TR/mediacapture-streams/) and requires a secure
context and permission for the current origin. Check Browser's microphone permission
in headset app settings and the site's microphone permission in Browser. After a
denial, restore the permission and retry recording; repeated clicks cannot override
a saved denial. If embedding the client, the parent permissions policy must also
allow microphone access.

Connect to an ARModule advertising local dictation support before recording. The
microphone request starts only with explicit recording. First transcription may
prepare/download Whisper's base model on the server. Verify on the actual headset
that transcription fills the draft without sending, permission-denial recovery
works, releasing before permission/transcription completes behaves correctly, and
canceling prevents late text from appearing. Browser fixtures do not establish
physical microphone behavior.

See the [project README](../../README.md), [contributor guide](../../CONTRIBUTING.md), and [integration contract](../../tools/integration-tests/README.md). Follow [AGENTS.md](../../AGENTS.md#commit--pull-request-guidelines) for the final validation checkpoint and focused follow-up checks.
