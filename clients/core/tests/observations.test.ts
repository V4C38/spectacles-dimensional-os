import { createTrackingOriginStore, FakeClock, FakeTransport, helloAt, stateFrame } from "./support/SessionFixture";
import { expect, it } from "vitest";
import { ARModuleSession } from "../src/websocket/ARModuleSession";

it("retains nested observation identities until the corresponding fact changes", () => {
  const session = new ARModuleSession({
    transport: new FakeTransport(), clock: new FakeClock(),
    clientTrackingOriginStore: createTrackingOriginStore(),
  });
  session.start();
  session.onTransportOpen();
  session.onTransportText(JSON.stringify(helloAt(0)) + "\n");
  session.onTransportText(JSON.stringify(stateFrame()) + "\n");
  session.onTransportText(JSON.stringify({ type: "pose", shared_frame_id: "fixture-map", position: [1, 2, 3], orientation: [0, 0, 0, 1], ts: 100 }) + "\n");
  session.tick();
  const before = session.view();
  expect(session.view().pose).toBe(before.pose);
  expect(session.view().state).toBe(before.state);
  expect(session.view().pose?.position).toBe(before.pose?.position);
  session.onTransportText(JSON.stringify(stateFrame()) + "\n");
  session.tick();
  expect(session.view().state).not.toBe(before.state);
  expect(session.view().pose).toBe(before.pose);
});
