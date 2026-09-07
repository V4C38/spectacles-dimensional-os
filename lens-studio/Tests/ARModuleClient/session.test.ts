import { describe, expect, it } from "vitest";
import { Alignment } from "../../Assets/Scripts/ARModuleClient/localization/alignment";
import { LIDAR_FOURCC } from "../../Assets/Scripts/ARModuleClient/websocket/protocol";
import type { Clock, Transport } from "../../Assets/Scripts/ARModuleClient/websocket/ports";
import { Session } from "../../Assets/Scripts/ARModuleClient/websocket/session";
import type { Hello, LocalizationObservationsRequest, State } from "../../Assets/Scripts/ARModuleClient/websocket/types";

class FakeClock implements Clock {
  nowS = 0;
  now(): number {
    return this.nowS;
  }
}

class FakeTransport implements Transport {
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

function helloAt(tsClient: number): Hello {
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
  session: Session;
  transport: FakeTransport;
  clock: FakeClock;
  alignment: Alignment;
} {
  const transport = new FakeTransport();
  const clock = new FakeClock();
  const alignment = new Alignment();
  const session = new Session({
    transport,
    clock,
    alignment,
    config: { helloTimeoutS: 1, reconnectDelayS: 0.5 },
  });
  return { session, transport, clock, alignment };
}

function handshake(session: Session, transport: FakeTransport, clock: FakeClock = new FakeClock()): Hello {
  const hello = helloAt(clock.nowS);
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
      aligned: false,
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

describe("session facts and alignment", () => {
  it("stores telemetry and routes localization_result to alignment", () => {
    const { session, transport, clock, alignment } = makeSession();
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
    expect(session.view().aligned).toBe(true);
    expect(alignment.T_odom_client?.confidence).toBe(0.9);
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

  it("turns an alignment failure into a reconnectable protocol failure", () => {
    class FailingAlignment extends Alignment {
      override apply(): ReturnType<Alignment["apply"]> {
        throw new Error("alignment rejected");
      }
    }
    const transport = new FakeTransport();
    const clock = new FakeClock();
    const session = new Session({
      transport,
      clock,
      alignment: new FailingAlignment(),
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
      lastError: "alignment rejected",
    });
  });

  it("replaces T_odom_client with the newest localization_result", () => {
    const { session, transport, clock, alignment } = makeSession();
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
    expect(alignment.T_odom_client?.position).toEqual([2, 0, 0]);
    expect(alignment.T_odom_client?.ts).toBe(2);
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
  it("clears facts and T_odom_client on disconnect, then reconnects", () => {
    const { session, transport, clock, alignment } = makeSession();
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
    expect(alignment.aligned).toBe(true);

    session.onTransportClose();
    expect(session.view().connection).toBe("failed");
    expect(session.view().hello).toBeNull();
    expect(session.view().aligned).toBe(false);
    expect(alignment.T_odom_client).toBeNull();

    clock.nowS = 0.5;
    session.tick();
    expect(session.view().connection).toBe("connecting");
    expect(transport.connectCount).toBe(2);

    session.onTransportOpen();
    session.onTransportText(`${JSON.stringify(helloAt(clock.nowS))}\n`);
    expect(session.view().connection).toBe("ready");
    expect(session.view().aligned).toBe(false);
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

describe("session config", () => {
  it("rejects missing timeout configuration", () => {
    expect(
      () =>
        new Session({
          transport: new FakeTransport(),
          clock: new FakeClock(),
          alignment: new Alignment(),
          config: { helloTimeoutS: 0, reconnectDelayS: 1 },
        }),
    ).toThrow(/helloTimeoutS/);
    expect(
      () =>
        new Session({
          transport: new FakeTransport(),
          clock: new FakeClock(),
          alignment: new Alignment(),
          config: { helloTimeoutS: 1, reconnectDelayS: Number.NaN },
        }),
    ).toThrow(/reconnectDelayS/);
  });
});
