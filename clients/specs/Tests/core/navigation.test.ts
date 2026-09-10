import { describe, expect, it } from "vitest";
import { ClientTrackingOriginStore } from "../../Assets/Scripts/DimosARClient/core/localization/clientTrackingOrigin";
import { requestNavGoal } from "../../Assets/Scripts/DimosARClient/core/navigation/navGoalRequest";
import type { ClientClock, WebSocketTransport } from "../../Assets/Scripts/DimosARClient/core/websocket/hostPorts";
import { ARModuleSession } from "../../Assets/Scripts/DimosARClient/core/websocket/arModuleSession";
import type { Capabilities, Hello, State } from "../../Assets/Scripts/DimosARClient/core/websocket/protocolTypes";

class FakeClock implements ClientClock {
  nowS = 0;
  now(): number {
    return this.nowS;
  }
}

class FakeTransport implements WebSocketTransport {
  texts: string[] = [];

  connect(): void {}
  close(): void {}
  sendText(text: string): void {
    this.texts.push(text);
  }
  sendBinary(): void {}
}

function helloAt(tsClient: number, capabilities?: Partial<Capabilities>): Hello {
  return {
    type: "hello",
    client_id: "c3f1a9",
    time_sync: { ts_client: tsClient, ts_server: 100 },
    robot: {
      display_name: "Unitree Go2",
      body_bounds_m: [0.7, 0.5, 0.55],
      footprint_m: [0.7, 0.5],
      base_height_m: 0.33,
    },
    capabilities: {
      lidar: { available: true, reason: null },
      navigation: { available: true, reason: null },
      localization: { available: true, reason: null },
      estop: { available: true, reason: null },
      ...capabilities,
    },
  };
}

const STATE: State = {
  type: "state",
  server: { connected_clients: 1 },
  lidar: { enabled: true, min_height_m: 0.1, max_height_m: 1.5, max_range_m: 5 },
  nav: { state: "idle", outcome: null },
};

function makeSession(): { session: ARModuleSession; transport: FakeTransport; clock: FakeClock } {
  const transport = new FakeTransport();
  const clock = new FakeClock();
  const session = new ARModuleSession({
    transport,
    clock,
    clientTrackingOriginStore: new ClientTrackingOriginStore(),
    config: { helloTimeoutS: 1, reconnectDelayS: 0.5 },
  });
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

const GOAL = {
  position: [1, 2, 0] as [number, number, number],
  orientation: [0, 0, 0, 1] as [number, number, number, number],
};

describe("requestNavGoal", () => {
  it("sends nav_goal_request JSON including the trailing newline", () => {
    const { session, transport, clock } = makeSession();
    handshake(session, clock);
    requestNavGoal(session, GOAL);
    expect(transport.texts[transport.texts.length - 1]).toBe(
      '{"type":"nav_goal_request","position":[1,2,0],"orientation":[0,0,0,1]}\n',
    );
  });

  it("throws not-ready before capability", () => {
    const { session } = makeSession();
    expect(() => requestNavGoal(session, GOAL)).toThrow("send requires a ready session");
  });

  it("throws when hello.capabilities.navigation is unavailable", () => {
    const { session, transport, clock } = makeSession();
    handshake(session, clock, {
      navigation: { available: false, reason: "navigation not supported" },
    });
    expect(() => requestNavGoal(session, GOAL)).toThrow(
      "hello.capabilities.navigation is not available",
    );
    expect(transport.texts).toHaveLength(1);
  });

  it("rejects a non-finite pose through encode", () => {
    const { session, clock } = makeSession();
    handshake(session, clock);
    expect(() =>
      requestNavGoal(session, {
        position: [1, Number.NaN, 0],
        orientation: [0, 0, 0, 1],
      }),
    ).toThrow(/position\[1]/);
  });
});
