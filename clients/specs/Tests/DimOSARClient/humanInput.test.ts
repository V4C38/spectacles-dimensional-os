import { describe, expect, it } from "vitest";
import { sendHumanInput } from "../../Assets/Scripts/DimOSARClient/agent/humanInput";
import { ClientTrackingOriginStore } from "../../Assets/Scripts/DimOSARClient/localization/clientTrackingOrigin";
import type { ClientClock, WebSocketTransport } from "../../Assets/Scripts/DimOSARClient/websocket/hostPorts";
import { ARModuleSession } from "../../Assets/Scripts/DimOSARClient/websocket/arModuleSession";
import type { Capabilities, Hello, State } from "../../Assets/Scripts/DimOSARClient/websocket/protocolTypes";

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
      agent: { available: false, reason: "current blueprint has no DimOS agent" },
      ...capabilities,
    },
  };
}

const STATE: State = {
  type: "state",
  server: { connected_clients: 1 },
  lidar: { enabled: true, min_height_m: 0.1, max_height_m: 1.5, max_range_m: 5 },
  nav: { state: "idle", outcome: null },
  agent: { idle: true },
};

function readySession(capabilities?: Partial<Capabilities>): {
  session: ARModuleSession;
  transport: FakeTransport;
} {
  const transport = new FakeTransport();
  const clock = new FakeClock();
  const session = new ARModuleSession({
    transport,
    clock,
    clientTrackingOriginStore: new ClientTrackingOriginStore(),
    config: { helloTimeoutS: 1, reconnectDelayS: 0.5 },
  });
  session.start();
  session.onTransportOpen();
  session.onTransportText(
    `${JSON.stringify(helloAt(clock.nowS, capabilities))}\n${JSON.stringify(STATE)}\n`,
  );
  return { session, transport };
}

describe("sendHumanInput", () => {
  it("sends human_input when agent is available", () => {
    const { session, transport } = readySession({
      agent: { available: true, reason: null },
    });
    sendHumanInput(session, "  go forward  ");
    expect(JSON.parse(transport.texts[transport.texts.length - 1])).toEqual({
      type: "human_input",
      text: "go forward",
    });
  });

  it("throws when the session is not ready", () => {
    const session = new ARModuleSession({
      transport: new FakeTransport(),
      clock: new FakeClock(),
      clientTrackingOriginStore: new ClientTrackingOriginStore(),
      config: { helloTimeoutS: 1, reconnectDelayS: 0.5 },
    });
    expect(() => sendHumanInput(session, "go")).toThrow(/ready session/);
  });

  it("throws when agent is unavailable", () => {
    const { session } = readySession();
    expect(() => sendHumanInput(session, "go")).toThrow(/capabilities.agent/);
  });
});
