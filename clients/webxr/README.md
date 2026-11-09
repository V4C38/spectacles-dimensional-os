# WebXR client

The WebXR host shares portable ClientCore with Specs and renders through Three.js/XR Blocks.
Use Node 22 (`nvm use` at repository root) and Python 3.12 for backend tooling.

## Development

Run `npm ci`, then `npm run dev` for HTTPS development. `npm run build` checks types and builds production assets. Run `npm test` for unit tests and `npm run test:integration` for browser integration.

The browser service and ARModule have independent lifetimes. A browser may use the service's same-origin backend route or join a LAN ARModule using its PIN. Control and bulk sockets remain bound to the resolved backend. Multiple clients can share one PIN; editing authority is granted separately by ARModule.

For physical XR use, trust the HTTPS certificate on the headset and ensure it can reach the browser service on the LAN. Supported headset profiles are Quest 3 and Quest 3S. Browser fixtures verify application behavior, not physical tracking, camera quality, or device performance.

See the [project README](../../README.md), [contributor guide](../../CONTRIBUTING.md), and [integration contract](../../tools/integration-tests/README.md). Run the complete repository CI gate before committing.
