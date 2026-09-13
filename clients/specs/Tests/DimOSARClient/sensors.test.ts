import { describe, expect, it } from "vitest";
import { ClientTrackingOriginStore } from "../../Assets/Scripts/DimOSARClient/localization/clientTrackingOrigin";
import {
  LIDAR_PRESETS,
  lidarModeFromSettings,
  nextLidarMode,
  requestLidarSettings,
} from "../../Assets/Scripts/DimOSARClient/sensors/lidarSettings";
import type { ClientClock, WebSocketTransport } from "../../Assets/Scripts/DimOSARClient/websocket/hostPorts";
import { ARModuleSession } from "../../Assets/Scripts/DimOSARClient/websocket/arModuleSession";
import type {
  Capabilities,
  Hello,
  LidarSettings,
  State,
} from "../../Assets/Scripts/DimOSARClient/websocket/protocolTypes";

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

const SETTINGS: LidarSettings = {
  enabled: true,
  min_height_m: 0.1,
  max_height_m: 1.5,
  max_range_m: 5,
};

describe("requestLidarSettings", () => {
  it("sends lidar_settings_request JSON including the trailing newline", () => {
    const { session, transport, clock } = makeSession();
    handshake(session, clock);
    requestLidarSettings(session, SETTINGS);
    expect(transport.texts[transport.texts.length - 1]).toBe(
      '{"type":"lidar_settings_request","enabled":true,"min_height_m":0.1,"max_height_m":1.5,"max_range_m":5}\n',
    );
  });

  it("throws not-ready before capability", () => {
    const { session } = makeSession();
    expect(() => requestLidarSettings(session, SETTINGS)).toThrow(
      "send requires a ready session",
    );
  });

  it("throws when hello.capabilities.lidar is unavailable", () => {
    const { session, transport, clock } = makeSession();
    handshake(session, clock, {
      lidar: { available: false, reason: "lidar not supported" },
    });
    expect(() => requestLidarSettings(session, SETTINGS)).toThrow(
      "hello.capabilities.lidar is not available",
    );
    expect(transport.texts).toHaveLength(1);
  });

  it("rejects an inverted band through encode", () => {
    const { session, clock } = makeSession();
    handshake(session, clock);
    expect(() =>
      requestLidarSettings(session, {
        enabled: true,
        min_height_m: 2,
        max_height_m: 1,
        max_range_m: 5,
      }),
    ).toThrow(/min_height_m/);
  });
});

describe("lidar presets", () => {
  it("cycles off → obstacles → full → off", () => {
    expect(nextLidarMode("off")).toBe("obstacles");
    expect(nextLidarMode("obstacles")).toBe("full");
    expect(nextLidarMode("full")).toBe("off");
  });

  it("recognizes preset settings from wire state", () => {
    expect(lidarModeFromSettings(LIDAR_PRESETS.off)).toBe("off");
    expect(lidarModeFromSettings(LIDAR_PRESETS.obstacles)).toBe("obstacles");
    expect(lidarModeFromSettings(LIDAR_PRESETS.full)).toBe("full");
  });
});
