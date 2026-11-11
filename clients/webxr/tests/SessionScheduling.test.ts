// @vitest-environment jsdom
import "./fixtures/xrEnvironment";
import { expect, it, vi } from "vitest";
import { FakeClock, FakeTransport, helloAt, stateFrame } from "../../specs/Tests/fixtures/SessionFixture";
import { DimOSWebXRClient } from "../src/DimOSWebXRClient";
import { WebXRApp } from "../src/WebXRApp";
import { cameraFixture } from "./fixtures/camera";

it("pumps real queued control and reconnect work once per update without a viewer or receive-triggered ticks", () => {
  class Transport extends FakeTransport { bind(): void {} }
  const transport = new Transport(), clock = new FakeClock(), camera = cameraFixture(undefined, clock);
  const client = new DimOSWebXRClient({ transport, clock, camera: camera.source });
  const app = new WebXRApp(client);
  const tick = vi.spyOn(client.session, "tick"), pose = vi.spyOn(camera.source, "samplePose");
  try {
    client.session.start(); client.session.onTransportOpen();
    client.session.onTransportText(JSON.stringify(helloAt(0)) + "\n");
    client.session.onTransportText(JSON.stringify(stateFrame()) + "\n");
    expect(client.session.view().state).toBeNull();
    app.update(0);
    expect(client.session.view().state?.nav.state).toBe("idle");
    expect(tick).toHaveBeenCalledOnce(); expect(pose).not.toHaveBeenCalled();
    const collaboration = client.session.collaboration;
    const shared = { type: "interaction_state" as const, epoch: "robot", revision: 0, mode: "manual" as const,
      authority: null, targets: [], motion_busy: false, following_tail: null, preview: null, active_goal: null };
    collaboration.apply(shared);
    collaboration.begin("navigation_planning", "test", { position: [0,0,0], orientation: [0,0,0,1] });
    const acquire = JSON.parse(transport.texts.at(-1)!);
    collaboration.accept({ type: "interaction_result", epoch: "robot", revision: 1, request_id: acquire.request_id,
      status: "accepted", code: "acquired", lease_id: "lease" });
    collaboration.apply({ ...shared, revision: 1, authority: { client_id: helloAt(0).client_id,
      source_id: "test", acquisition_id: acquire.acquisition_id, lease_id: "lease", kind: "navigation_planning",
      held: true, expires_at: 101, sequence: -1 } });
    clock.nowS = .2; app.update(200);
    expect(transport.texts.map(text => JSON.parse(text).action)).toContain("renew");
    expect(tick).toHaveBeenCalledTimes(2); expect(pose).not.toHaveBeenCalled();
    client.session.onTransportClose();
    clock.nowS = 5; app.update(5000);
    expect(transport.connectCount).toBe(2); expect(tick).toHaveBeenCalledTimes(3);
    expect(transport.texts.map(text => JSON.parse(text).type)).not.toContain("nav_joystick_request");
  } finally { app.dispose(); }
});
