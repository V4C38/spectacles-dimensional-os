import { FakeClock, FakeTransport, helloAt, stateFrame } from "./support/SessionFixture";
import { describe, expect, it } from "vitest";
import { ClientTrackingOriginStore } from "../src/localization/clientTrackingOrigin";
import { requestNavGoal } from "../src/navigation/navGoalRequest";
import { requestNavJoystick } from "../src/navigation/navJoystickRequest";
import { ARModuleSession } from "../src/websocket/arModuleSession";
import type { Capabilities } from "../src/websocket/protocolTypes";

const STATE = stateFrame();

function makeSession(): { session: ARModuleSession; transport: FakeTransport; clock: FakeClock } {
  const transport = new FakeTransport();
  const clock = new FakeClock();
  const session = new ARModuleSession({
    transport,
    clock,
    clientTrackingOriginStore: new ClientTrackingOriginStore(),
    config: { helloTimeoutS: 1, reconnectDelayS: 0.5 },
  });
  const receive = session.onTransportText.bind(session);
  session.onTransportText = text => { receive(text); session.tick(); };
  return { session, transport, clock };
}

function handshake(
  session: ARModuleSession,
  clock: FakeClock,
  capabilities?: Partial<Capabilities>,
): void {
  session.start();
  session.onTransportOpen();
  session.onTransportText(
    `${JSON.stringify(helloAt(clock.nowS, capabilities))}\n${JSON.stringify(STATE)}\n`,
  );
}

function grant(session: ARModuleSession, transport: FakeTransport): void {
  session.onTransportText(JSON.stringify({
    targets: [],
    motion_busy: false,
    following_tail: null,
    type: "interaction_state", epoch: "epoch", revision: 0, mode: "manual", authority: null, target: null, preview: null, active_goal: null }) + "\n");
  session.collaboration.begin("live", "test");
  const request = JSON.parse(transport.texts[transport.texts.length - 1]);
  session.onTransportText(JSON.stringify({
    targets: [],
    motion_busy: false,
    following_tail: null,
    type: "interaction_state", epoch: "epoch", revision: 1, mode: "manual", target: null, preview: null, active_goal: null,
    authority: { client_id: "c3f1a9", source_id: "test", acquisition_id: request.acquisition_id, lease_id: "lease", kind: "live", held: true, expires_at: 1, sequence: -1 } }) + "\n");
  session.onTransportText(JSON.stringify({ type: "interaction_result", request_id: request.request_id, epoch: "epoch", revision: 1, status: "accepted", code: "acquired", lease_id: "lease" }) + "\n");
}

const GOAL = {
  position: [1, 2, 0] as [number, number, number],
  orientation: [0, 0, 0, 1] as [number, number, number, number],
};

describe("requestNavGoal", () => {
  it("sends nav_goal_request JSON including the trailing newline", () => {
    const { session, transport, clock } = makeSession();
    handshake(session, clock);
    grant(session, transport);
    requestNavGoal(session, GOAL);
    expect(transport.texts[transport.texts.length - 1]).toBe(
      '{"type":"nav_goal_request","epoch":"epoch","lease_id":"lease","sequence":1,"position":[1,2,0],"orientation":[0,0,0,1]}\n',
    );
  });

  it("throws not-ready before capability", () => {
    const { session } = makeSession();
    expect(() => requestNavGoal(session, GOAL)).toThrow("send requires a ready session");
  });

  it("throws when hello.capabilities.navigation is unavailable", () => {
    const { session, transport, clock } = makeSession();
    handshake(session, clock, {
      navigation: {
        available: false,
        reason: "navigation not supported",
        nav_goal: { preview: false, available: false, reason: "nav_goal not available on this robot" },
        nav_joystick: { available: false, reason: "nav_joystick not available on this robot" },
      },
    });
    expect(() => requestNavGoal(session, GOAL)).toThrow(
      "hello.capabilities.navigation is not available",
    );
    expect(transport.texts).toHaveLength(1);
  });

  it("throws when nav_goal is off even if nav_joystick is on", () => {
    const { session, transport, clock } = makeSession();
    handshake(session, clock, {
      navigation: {
        available: true,
        reason: null,
        nav_goal: { preview: false, available: false, reason: "nav_goal not available on this robot" },
        nav_joystick: { available: true, reason: null },
      },
    });
    expect(() => requestNavGoal(session, GOAL)).toThrow(
      "hello.capabilities.navigation.nav_goal is not available",
    );
    expect(transport.texts).toHaveLength(1);
  });

  it("rejects a non-finite pose through encode", () => {
    const { session, transport, clock } = makeSession();
    handshake(session, clock);
    grant(session, transport);
    expect(() =>
      requestNavGoal(session, {
        position: [1, Number.NaN, 0],
        orientation: [0, 0, 0, 1],
      }),
    ).toThrow(/position\[1]/);
  });
});

describe("requestNavJoystick", () => {
  it("sends nav_joystick_request JSON including the trailing newline", () => {
    const { session, transport, clock } = makeSession();
    handshake(session, clock);
    grant(session, transport);
    requestNavJoystick(session, { linear: [0.4, 0, 0], angular: [0, 0, 0.3] });
    expect(transport.texts[transport.texts.length - 1]).toBe(
      '{"type":"nav_joystick_request","epoch":"epoch","lease_id":"lease","sequence":1,"linear":[0.4,0,0],"angular":[0,0,0.3]}\n',
    );
  });

  it("includes duration when provided", () => {
    const { session, transport, clock } = makeSession();
    handshake(session, clock);
    grant(session, transport);
    requestNavJoystick(session, { linear: [0.4, 0, 0], angular: [0, 0, 0], duration: 0.5 });
    expect(transport.texts[transport.texts.length - 1]).toBe(
      '{"type":"nav_joystick_request","epoch":"epoch","lease_id":"lease","sequence":1,"linear":[0.4,0,0],"angular":[0,0,0],"duration":0.5}\n',
    );
  });

  it("throws when nav_joystick is unavailable", () => {
    const { session, transport, clock } = makeSession();
    handshake(session, clock, {
      navigation: {
        available: true,
        reason: null,
        nav_goal: { preview: false, available: true, reason: null },
        nav_joystick: { available: false, reason: "nav_joystick not available on this robot" },
      },
    });
    expect(() =>
      requestNavJoystick(session, { linear: [0.4, 0, 0], angular: [0, 0, 0] }),
    ).toThrow("hello.capabilities.navigation.nav_joystick is not available");
    expect(transport.texts).toHaveLength(1);
  });
});
