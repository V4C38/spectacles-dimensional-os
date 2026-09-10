import { describe, expect, it } from "vitest";
import { ClientTrackingOriginStore } from "../../Assets/Scripts/DimosARClient/core/localization/clientTrackingOrigin";
import { LIDAR_FOURCC } from "../../Assets/Scripts/DimosARClient/core/websocket/protocol";
import {
  AR_MODULE_CLIENT_CONFIG,
  type ClientClock,
  type WebSocketTransport,
} from "../../Assets/Scripts/DimosARClient/core/websocket/hostPorts";
import { ARModuleSession } from "../../Assets/Scripts/DimosARClient/core/websocket/arModuleSession";
import type {
  Capabilities,
  Hello,
  LocalizationObservationsRequest,
  State,
} from "../../Assets/Scripts/DimosARClient/core/websocket/protocolTypes";

class FakeClock implements ClientClock {
  nowS = 0;
  now(): number {
    return this.nowS;
  }
}

class FakeTransport implements WebSocketTransport {
  connectCount = 0;
  closeCount = 0;
  texts: string[] = [];
  binaries: Uint8Array[] = [];

  connect(): void {
    this.connectCount += 1;
  }

  close(): void {
    this.closeCount += 1;
  }

  sendText(text: string): void {
    this.texts.push(text);
  }

  sendBinary(data: Uint8Array): void {
    this.binaries.push(data);
  }
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

function makeSession(): {
  session: ARModuleSession;
  transport: FakeTransport;
  clock: FakeClock;
  originStore: ClientTrackingOriginStore;
} {
  const transport = new FakeTransport();
  const clock = new FakeClock();
  const originStore = new ClientTrackingOriginStore();
  const session = new ARModuleSession({
    transport,
    clock,
    clientTrackingOriginStore: originStore,
    config: { helloTimeoutS: 1, reconnectDelayS: 0.5 },
  });
  return { session, transport, clock, originStore };
}

function handshake(
  session: ARModuleSession,
  transport: FakeTransport,
  clock: FakeClock = new FakeClock(),
  capabilities?: Partial<Capabilities>,
): Hello {
  const hello = helloAt(clock.nowS, capabilities);
  session.start();
  session.onTransportOpen();
  session.onTransportText(`${JSON.stringify(hello)}\n${JSON.stringify(STATE)}\n`);
  expect(session.view().connection).toBe("ready");
  expect(transport.texts).toHaveLength(1);
  expect(JSON.parse(transport.texts[0])).toEqual({ type: "hello_request", ts_client: clock.nowS });
  return hello;
}

function pythonLidar(ts: number, points: [number, number, number][]): Uint8Array {
  const out = new Uint8Array(16 + points.length * 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, LIDAR_FOURCC, true);
  view.setFloat64(4, ts, true);
  view.setUint32(12, points.length, true);
  return out;
}

describe("session handshake", () => {
  it("sends hello_request as the first text frame and becomes ready on hello", () => {
    const { session, transport, clock } = makeSession();
    const hello = handshake(session, transport, clock);
    expect(session.view()).toMatchObject({
      connection: "ready",
      hasTrackingOrigin: false,
      hello,
      state: STATE,
      capabilities: hello.capabilities,
      nav: STATE.nav,
    });
  });

  it("rejects a second start and a send before ready", () => {
    const { session } = makeSession();
    session.start();
    expect(() => session.start()).toThrow(/already started/);
    expect(() => session.sendText("{}\n")).toThrow(/ready session/);
  });

  it("fails when the first outbound message is not hello", () => {
    const { session } = makeSession();
    session.start();
    session.onTransportOpen();
    session.onTransportText(`${JSON.stringify(STATE)}\n`);
    expect(session.view().connection).toBe("failed");
    expect(session.view().lastError).toMatch(/expected hello/);
  });

  it("fails when hello never arrives", () => {
    const { session, transport, clock } = makeSession();
    session.start();
    session.onTransportOpen();
    clock.nowS = 1;
    session.tick();
    expect(session.view().connection).toBe("failed");
    expect(session.view().lastError).toBe("hello timeout");
    clock.nowS = 1.5;
    session.tick();
    expect(transport.connectCount).toBe(2);
  });

  it("fails when hello.time_sync.ts_client does not echo hello_request", () => {
    const { session } = makeSession();
    session.start();
    session.onTransportOpen();
    session.onTransportText(`${JSON.stringify(helloAt(99))}\n`);
    expect(session.view().connection).toBe("failed");
    expect(session.view().lastError).toMatch(/echo hello_request/);
  });

  it("throws on transport events in the wrong phase", () => {
    const { session } = makeSession();
    expect(() => session.onTransportOpen()).toThrow(/unexpected transport open/);
    expect(() => session.onTransportClose()).toThrow(/unexpected transport close/);
    expect(() => session.onTransportText("{}\n")).toThrow(/before session is open/);
    session.start();
    expect(() => session.onTransportBinary(new Uint8Array(16))).toThrow(/before hello/);
  });
});

describe("session facts and tracking origin", () => {
  it("stores telemetry and routes localization_result to the origin store", () => {
    const { session, transport, clock, originStore } = makeSession();
    handshake(session, transport, clock);
    const outbound: string[] = [];
    const views: string[] = [];
    session.subscribeOutbound((message) => outbound.push(message.type));
    session.subscribeView((view) => views.push(view.connection));

    session.onTransportText(
      JSON.stringify({
        type: "pose",
        position: [1, 0, 0],
        orientation: [0, 0, 0, 1],
        ts: 2,
      }) + "\n",
    );
    session.onTransportText(
      JSON.stringify({
        type: "nav_goal",
        path_poses: [],
        ts: 3,
      }) + "\n",
    );
    session.onTransportBinary(pythonLidar(4, []));
    session.onTransportText(
      JSON.stringify({
        type: "localization_result",
        position: [0, 0, 0],
        orientation: [0, 0, 0, 1],
        confidence: 0.9,
        ts: 5,
      }) + "\n",
    );

    expect(session.view().pose?.position).toEqual([1, 0, 0]);
    expect(session.view().nav_goal?.path_poses).toEqual([]);
    expect(session.view().lidar?.ts).toBe(4);
    expect(session.view().hasTrackingOrigin).toBe(true);
    expect(originStore.T_odom_client?.confidence).toBe(0.9);
    expect(outbound).toEqual(["pose", "nav_goal", "lidar", "localization_result"]);
    expect(views[views.length - 1]).toBe("ready");
    session.sendText('{"type":"state_request"}\n');
    expect(transport.texts[transport.texts.length - 1]).toBe('{"type":"state_request"}\n');
  });

  it("fails a second hello or a malformed frame after ready", () => {
    const { session, transport, clock } = makeSession();
    handshake(session, transport, clock);
    session.onTransportText(`${JSON.stringify(helloAt(clock.nowS))}\n`);
    expect(session.view().connection).toBe("failed");
    expect(session.view().lastError).toMatch(/unexpected hello/);

    const again = makeSession();
    handshake(again.session, again.transport, again.clock);
    again.session.onTransportText("not-json\n");
    expect(again.session.view().connection).toBe("failed");
    again.clock.nowS = 0.5;
    again.session.tick();
    expect(again.transport.connectCount).toBe(2);
  });

  it("turns a bad lidar frame after ready into a reconnectable protocol failure", () => {
    const { session, transport, clock } = makeSession();
    handshake(session, transport, clock);
    session.onTransportBinary(new Uint8Array([1, 2, 3]));
    expect(session.view()).toMatchObject({
      connection: "failed",
      lastError: expect.stringMatching(/too short/),
    });
    clock.nowS = 0.5;
    session.tick();
    expect(transport.connectCount).toBe(2);
  });

  it("turns an origin-store failure into a reconnectable protocol failure", () => {
    class FailingClientTrackingOriginStore extends ClientTrackingOriginStore {
      override setFromLocalizationResult(): ReturnType<ClientTrackingOriginStore["setFromLocalizationResult"]> {
        throw new Error("origin rejected");
      }
    }
    const transport = new FakeTransport();
    const clock = new FakeClock();
    const session = new ARModuleSession({
      transport,
      clock,
      clientTrackingOriginStore: new FailingClientTrackingOriginStore(),
      config: { helloTimeoutS: 1, reconnectDelayS: 0.5 },
    });
    handshake(session, transport, clock);
    session.onTransportText(
      JSON.stringify({
        type: "localization_result",
        position: [0, 0, 0],
        orientation: [0, 0, 0, 1],
        confidence: 1,
        ts: 1,
      }) + "\n",
    );
    expect(session.view()).toMatchObject({
      connection: "failed",
      lastError: "origin rejected",
    });
  });

  it("replaces ClientTrackingOrigin with the newest localization_result", () => {
    const { session, transport, clock, originStore } = makeSession();
    handshake(session, transport, clock);
    session.onTransportText(
      JSON.stringify({
        type: "localization_result",
        position: [1, 0, 0],
        orientation: [0, 0, 0, 1],
        confidence: 0.4,
        ts: 1,
      }) + "\n",
    );
    session.onTransportText(
      JSON.stringify({
        type: "localization_result",
        position: [2, 0, 0],
        orientation: [0, 0, 0, 1],
        confidence: 0.8,
        ts: 2,
      }) + "\n",
    );
    expect(originStore.T_odom_client?.position).toEqual([2, 0, 0]);
    expect(originStore.T_odom_client?.ts).toBe(2);
  });

  it("notifies localization_observations_request subscribers without storing episode state", () => {
    const { session, transport, clock } = makeSession();
    handshake(session, transport, clock);
    const requests: LocalizationObservationsRequest[] = [];
    session.subscribeLocalizationObservationsRequest((request) => requests.push(request));
    const request = {
      type: "localization_observations_request",
      capture_policy: "any_angle",
      observation_count: 2,
    } as const;
    session.onTransportText(`${JSON.stringify(request)}\n`);
    expect(requests).toEqual([request]);
    expect(session.view().connection).toBe("ready");
  });
});

describe("disconnect and reconnect", () => {
  it("clears facts and ClientTrackingOrigin on disconnect, then reconnects", () => {
    const { session, transport, clock, originStore } = makeSession();
    handshake(session, transport, clock);
    session.onTransportText(
      JSON.stringify({
        type: "localization_result",
        position: [0, 0, 0],
        orientation: [0, 0, 0, 1],
        confidence: 1,
        ts: 1,
      }) + "\n",
    );
    expect(originStore.hasTrackingOrigin).toBe(true);

    session.onTransportClose();
    expect(session.view().connection).toBe("failed");
    expect(session.view().hello).toBeNull();
    expect(session.view().hasTrackingOrigin).toBe(false);
    expect(originStore.T_odom_client).toBeNull();

    clock.nowS = 0.5;
    session.tick();
    expect(session.view().connection).toBe("connecting");
    expect(transport.connectCount).toBe(2);

    session.onTransportOpen();
    session.onTransportText(`${JSON.stringify(helloAt(clock.nowS))}\n`);
    expect(session.view().connection).toBe("ready");
    expect(session.view().hasTrackingOrigin).toBe(false);
  });

  it("stop does not schedule reconnect", () => {
    const { session, transport, clock } = makeSession();
    handshake(session, transport, clock);
    session.stop();
    expect(session.view().connection).toBe("disconnected");
    clock.nowS = 10;
    session.tick();
    expect(transport.connectCount).toBe(1);
    expect(session.view().connection).toBe("disconnected");
  });
});

describe("session control", () => {
  it("sends estop_request when estop is available", () => {
    const { session, transport, clock } = makeSession();
    handshake(session, transport, clock);
    session.requestEstop();
    expect(transport.texts[transport.texts.length - 1]).toBe('{"type":"estop_request"}\n');
  });

  it("sends state_request with no capability key", () => {
    const { session, transport, clock } = makeSession();
    handshake(session, transport, clock);
    session.requestState();
    expect(transport.texts[transport.texts.length - 1]).toBe('{"type":"state_request"}\n');
  });

  it("throws not-ready before capability on estop and state", () => {
    const { session } = makeSession();
    expect(() => session.requestEstop()).toThrow("send requires a ready session");
    expect(() => session.requestState()).toThrow("send requires a ready session");
  });

  it("throws when hello.capabilities.estop is unavailable", () => {
    const { session, transport, clock } = makeSession();
    handshake(session, transport, clock, {
      estop: { available: false, reason: "estop not supported" },
    });
    expect(() => session.requestEstop()).toThrow("hello.capabilities.estop is not available");
    expect(transport.texts).toHaveLength(1);
    session.requestState();
    expect(transport.texts[transport.texts.length - 1]).toBe('{"type":"state_request"}\n');
  });
});

describe("session config", () => {
  it("uses AR_MODULE_CLIENT_CONFIG.session when config is omitted", () => {
    const transport = new FakeTransport();
    const clock = new FakeClock();
    const session = new ARModuleSession({
      transport,
      clock,
      clientTrackingOriginStore: new ClientTrackingOriginStore(),
    });
    session.start();
    session.onTransportOpen();
    clock.nowS = AR_MODULE_CLIENT_CONFIG.session.helloTimeoutS - 0.1;
    session.tick();
    expect(session.view().connection).toBe("awaiting_hello");
    clock.nowS = AR_MODULE_CLIENT_CONFIG.session.helloTimeoutS;
    session.tick();
    expect(session.view().connection).toBe("failed");
    expect(session.view().lastError).toBe("hello timeout");
  });

  it("rejects missing timeout configuration", () => {
    expect(
      () =>
        new ARModuleSession({
          transport: new FakeTransport(),
          clock: new FakeClock(),
          clientTrackingOriginStore: new ClientTrackingOriginStore(),
          config: { helloTimeoutS: 0, reconnectDelayS: 1 },
        }),
    ).toThrow(/helloTimeoutS/);
    expect(
      () =>
        new ARModuleSession({
          transport: new FakeTransport(),
          clock: new FakeClock(),
          clientTrackingOriginStore: new ClientTrackingOriginStore(),
          config: { helloTimeoutS: 1, reconnectDelayS: Number.NaN },
        }),
    ).toThrow(/reconnectDelayS/);
  });
});
