import { FakeClock, FakeTransport, helloAt, stateFrame, navigationSnapshot } from "../fixtures/SessionFixture";
import { ARM_FIXTURE } from "../integration-tests/IntegrationArmFixture";
import { describe, expect, it } from "vitest";
import { ClientTrackingOriginStore } from "../../Assets/Scripts/DimOSARClient/localization/clientTrackingOrigin";
import { LIDAR_FOURCC } from "../../Assets/Scripts/DimOSARClient/websocket/protocol";
import {
  AR_MODULE_CLIENT_CONFIG,
} from "../../Assets/Scripts/DimOSARClient/websocket/hostPorts";
import { ARModuleSession } from "../../Assets/Scripts/DimOSARClient/websocket/arModuleSession";
import type {
  Capabilities,
  Hello,
  LocalizationObservationsRequest,
} from "../../Assets/Scripts/DimOSARClient/websocket/protocolTypes";

const STATE = stateFrame();

function makeSession(pumpSnapshots = true): {
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
  const receive = session.onTransportText.bind(session);
  let publication: import("../../Assets/Scripts/DimOSARClient/replication/CollaborationTypes").InteractionState | null = null;
  session.onTransportText = text => {
    for (const line of text.split("\n").filter(value => value.trim())) {
      let value: any;
      try { value = JSON.parse(line); } catch { receive(line + "\n"); continue; }
      if (value.type === "nav_goal") value = navigationSnapshot(publication, value);
      if (value.type === "interaction_state") publication = value;
      receive(JSON.stringify(value) + "\n");
    }
    if (pumpSnapshots) session.tick();
  };
  return { session, transport, clock, originStore };
}

function submitForResult(session: ARModuleSession, resultTs: number): void {
  session.onTransportText(JSON.stringify({ result_timeout_s: 15, type: "localization_observations_request", capture_id: `capture-${resultTs}`, capture_policy: "any_angle", observation_count: 1 }) + "\n");
  const sync = session.view().hello!.time_sync;
  session.submitLocalizationObservations([{
    ts_capture: resultTs - (sync.ts_server - sync.ts_client), jpeg: new Uint8Array([1]),
    intrinsics: { fx: 1, fy: 1, cx: 0, cy: 0, width: 1, height: 1, distortion_model: "none", distortion: [] },
    camera_position: [0, 0, 0], camera_orientation: [0, 0, 0, 1],
  }], 15);
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
  expect(JSON.parse(transport.texts[0])).toEqual({ type: "hello_request", protocol_version: 2, ts_client: clock.nowS });
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
  it.each([undefined, 1, 3])("rejects incompatible hello version %s with an actionable error", version => {
    const { session } = makeSession();
    session.start(); session.onTransportOpen();
    session.onTransportText(JSON.stringify({ ...helloAt(0), protocol_version: version }) + "\n");
    expect(session.view().connection).toBe("failed");
    expect(session.view().lastError).toContain("Incompatible ARModule protocol: expected version 2");
    expect(session.view().hello).toBeNull();
  });
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
  it("clears an accepted goal and preview when their authoritative snapshot clears them", () => {
    const { session, transport, clock } = makeSession(); handshake(session, transport, clock);
    const interaction = {
      targets: [],
      motion_busy: false,
      following_tail: null,
      type: "interaction_state", epoch: "robot", revision: 1, mode: "manual", authority: null, target: null,
      active_goal: { type: "nav_goal", pose: [2,0,0,0], path_poses: [], ts: 1 },
      preview: { type: "nav_goal", preview: true, pose: [2,0,0,0], path_poses: [[0,0,0,0],[2,0,0,0]], ts: 1 } };
    session.onTransportText(JSON.stringify(interaction) + "\n");
    expect(session.view().nav_goal?.pose).toEqual([2,0,0,0]);
    expect(session.view().nav_preview).not.toBeNull();
    session.onTransportText(JSON.stringify({ ...interaction, revision: 2, active_goal: null, preview: null }) + "\n");
    expect(session.view().nav_goal).toBeNull(); expect(session.view().nav_preview).toBeNull();
  });
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
    transport.bulk.lidar(pythonLidar(4, []));
    submitForResult(session, 5);
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
    expect(outbound).toEqual(["pose", "interaction_state", "localization_observations_request", "lidar", "localization_result"]);
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
    expect(again.session.view().lastError).toContain("Invalid critical unknown");
    again.clock.nowS = 0.5;
    again.session.tick();
    expect(again.transport.connectCount).toBe(2);
  });

  it("reports a bad lidar frame without reconnecting", () => {
    const { session, transport, clock } = makeSession();
    handshake(session, transport, clock);
    transport.bulk.lidar(new Uint8Array(16)); session.tick();
    expect(session.view()).toMatchObject({
      connection: "ready",
      lastError: null,
    });
    clock.nowS = 0.5;
    session.tick();
    expect(transport.connectCount).toBe(1);
    expect(JSON.parse(transport.texts.at(-1)!)).toMatchObject({ type: "client_error", message_type: "lidar" });
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
    submitForResult(session, 1);
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
    submitForResult(session, 1);
    session.onTransportText(
      JSON.stringify({
        type: "localization_result",
        position: [1, 0, 0],
        orientation: [0, 0, 0, 1],
        confidence: 0.4,
        ts: 1,
      }) + "\n",
    );
    submitForResult(session, 2);
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
    session.subscribeOutbound(message => { if (message.type === "localization_observations_request") requests.push(message); });
    const request = {
      capture_id: "fixture-capture",
      result_timeout_s: 15,
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
  it("clears live facts and restores same-reference localization on reconnect", () => {
    const { session, transport, clock, originStore } = makeSession();
    handshake(session, transport, clock);
    submitForResult(session, 1);
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
    expect(session.view().hello).not.toBeNull();
    expect(session.view().hasTrackingOrigin).toBe(false);
    expect(originStore.T_odom_client).toBeNull();

    clock.nowS = 0.5;
    session.tick();
    expect(session.view().connection).toBe("connecting");
    expect(transport.connectCount).toBe(2);

    session.onTransportOpen();
    session.onTransportText(`${JSON.stringify(helloAt(clock.nowS))}\n`);
    expect(session.view().connection).toBe("ready");
    expect(session.view().hasTrackingOrigin).toBe(true);
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

  it("caches latest agent text and exposes idle from the state frame", () => {
    const { session, transport, clock } = makeSession();
    handshake(session, transport, clock, {
      agent: { available: true, reason: null },
    });
    const outbound: string[] = [];
    session.subscribeOutbound((message) => outbound.push(message.type));
    session.onTransportText(JSON.stringify({ type: "agent_message", text: "Heading out." }) + "\n");
    expect(session.view().agentMessage).toBe("Heading out.");
    session.onTransportText(
      JSON.stringify({
        ...STATE,
        agent: { idle: false },
      }) + "\n",
    );
    expect(session.view().state?.agent.idle).toBe(false);
    session.onTransportText(
      JSON.stringify({
        type: "agent_skill",
        name: "ar_place_marker",
        args: { id: "kitchen", x: 1, y: 0, z: 0 },
      }) + "\n",
    );
    expect(outbound).toContain("agent_message");
    expect(outbound).toContain("agent_skill");
    session.stop();
    expect(session.view().agentMessage).toBeNull();
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

it("stores preview replies separately from active navigation and clears both on disconnect", () => {
  const { session, transport } = makeSession(); handshake(session, transport);
  const active = { type: "nav_goal", pose: [1, 2, 0, 0], path_poses: [[1, 2, 0, 0]], ts: 1 };
  const preview = { type: "nav_goal", preview: true, pose: [3, 4, 0, 0], path_poses: [[3, 4, 0, 0]], ts: 2 };
  session.onTransportText(JSON.stringify(active) + "\n" + JSON.stringify(preview) + "\n");
  expect(session.view().nav_goal).toEqual(active);
  expect(session.view().nav_preview).toEqual(preview);
  expect(session.view().nav).toEqual({ state: "idle", outcome: null });
  session.onTransportClose();
  expect(session.view().nav_goal).toBeNull(); expect(session.view().nav_preview).toBeNull();
});

for (const reference of ["room-a", "room-b", undefined]) {
  it(`only restores localization on reconnect to the same odometry reference (${reference})`, () => {
    const { session, clock, originStore } = makeSession();
    session.start(); session.onTransportOpen();
    session.onTransportText(JSON.stringify({ ...helloAt(0), odom_reference_id: "room-a" }) + "\n");
    originStore.setFromLocalizationResult({ type: "localization_result", position: [2, 3, 1], orientation: [0, 0, 0, 1], confidence: 1, ts: 100 });
    session.onTransportClose();
    expect(session.view().hasTrackingOrigin).toBe(false);
    expect(session.view().hasRetainedTrackingOrigin).toBe(true);
    clock.nowS = 0.5; session.tick(); session.onTransportOpen();
    session.onTransportText(JSON.stringify({ ...helloAt(0.5), odom_reference_id: reference }) + "\n");
    expect(originStore.hasTrackingOrigin).toBe(reference === "room-a");
    expect(session.view().alignmentRequired === true).toBe(reference !== "room-a");
    session.stop(); expect(originStore.hasTrackingOrigin).toBe(false);
  });
}

it("assigns distinct monotonic revisions to identical agent messages across connection teardown", () => {
  const { session, transport, clock } = makeSession(); handshake(session, transport, clock);
  expect(session.view().agentMessageRevision).toBe(0);
  session.onTransportText(JSON.stringify({ type: "agent_message", text: "Done" }) + "\n");
  expect(session.view().agentMessageRevision).toBe(1);
  session.onTransportText(JSON.stringify({ type: "agent_message", text: "Done" }) + "\n");
  expect(session.view().agentMessageRevision).toBe(2);
  session.stop(); expect(session.view().agentMessage).toBeNull();
  expect(session.view().agentMessageRevision).toBe(2);
  session.start(); session.onTransportOpen(); session.onTransportText(JSON.stringify(helloAt(clock.nowS)) + "\n");
  session.onTransportText(JSON.stringify({ type: "agent_message", text: "Done" }) + "\n");
  expect(session.view().agentMessageRevision).toBe(3);
});

describe("bulk isolation and capture replacement", () => {
  it("waits for a slow advisory asset without losing control and retires it on estop", () => {
    const { session, transport, clock } = makeSession();
    handshake(session, transport, clock);
    const ref = { epoch: "fixture-epoch", id: "route:preview", revision: "slow" };
    session.onTransportText(JSON.stringify({ type: "nav_goal", preview: true, preview_id: "slow-preview", pose: [1, 0, 0, 0], ts: 100, route_ref: ref }) + "\n");
    transport.bulk.receive({ type: "bulk_record", ...ref, kind: "route", part: 0, parts: 2,
      data: { metadata: { ts: 100, pose: [1, 0, 0, 0] } } });
    session.tick();
    clock.nowS += 6;
    session.tick();
    expect(session.assetTransferDeadline("slow-preview")).toBeGreaterThan(clock.nowS);
    session.requestEstop();
    expect(JSON.parse(transport.texts.at(-1)!).type).toBe("estop_request");
    transport.bulk.receive({ type: "bulk_record", ...ref, kind: "route", part: 1, parts: 2,
      data: { points: [[0, 0, 0, 0], [1, 0, 0, 0]] } });
    session.tick();
    expect(session.view().connection).toBe("ready");
    expect(session.view().nav_preview).toBeNull();
  });

  it("keeps the control session available after an ordinary asset cache miss", () => {
    const { session, transport, clock } = makeSession();
    handshake(session, transport, clock);
    const ref = { epoch: "fixture-epoch", id: "route:preview", revision: "evicted" };
    session.onTransportText(JSON.stringify({ type: "nav_goal", preview: true, preview_id: "missing-preview", pose: [1, 0, 0, 0], ts: 100, route_ref: ref }) + "\n");
    transport.bulk.receive({ type: "bulk_error", code: "asset_unavailable", kind: "route", ...ref });
    session.tick();
    expect(session.view().connection).toBe("ready");
    session.requestEstop();
    expect(JSON.parse(transport.texts.at(-1)!).type).toBe("estop_request");
  });

  it("retires an unavailable preview after bounded retries without disabling control or arm health", () => {
    const { session, transport, clock } = makeSession(); handshake(session, transport, clock);
    const ref = { epoch: "fixture-epoch", id: "permanently-missing-preview", revision: "1" };
    const preview = { type: "nav_goal", preview: true, preview_id: "unavailable", pose: [1, 0, 0, 0], ts: 100, route_ref: ref };
    session.onTransportText(JSON.stringify(preview) + "\n");
    for (const time of [0, 2, 6]) {
      clock.nowS = time; session.tick();
      transport.bulk.receive({ type: "bulk_error", code: "asset_unavailable", kind: "route", ...ref });
      session.tick();
    }
    expect(session.view().connection).toBe("ready");
    expect(session.view().nav_preview).toMatchObject({ preview: true, preview_id: "unavailable", pose: null, path_poses: [] });
    expect(session.view().manipulationError).toBeNull();
    session.onTransportText(JSON.stringify({ ...preview, preview_id: "same-unavailable-asset" }) + "\n");
    expect(session.view().connection).toBe("ready");
    session.requestEstop();
    expect(JSON.parse(transport.texts.at(-1)!).type).toBe("estop_request");
  });

  it("retains an accepted endpoint when optional active-route geometry is unavailable", () => {
    const { session, transport, clock } = makeSession(); handshake(session, transport, clock);
    const ref = { epoch: "fixture-epoch", id: "permanently-missing-active-route", revision: "1" };
    const goal = { type: "nav_goal", pose: [3, 0, 0, 0], ts: 100, route_ref: ref };
    session.onTransportText(JSON.stringify({
      targets: [],
      motion_busy: false,
      following_tail: null,
      type: "interaction_state", epoch: "robot", revision: 1, mode: "manual",
      authority: null, target: null, preview: null, active_goal: { ...goal, path_poses: [] } }) + "\n");
    session.onTransportText(JSON.stringify(goal) + "\n");
    expect(session.view().nav_goal).toMatchObject({ pose: [3, 0, 0, 0], path_poses: [] });
    expect(session.assetTransferDeadline("interaction_state")).not.toBeNull();
    for (const time of [0, 2, 6]) {
      clock.nowS = time; session.tick();
      transport.bulk.receive({ type: "bulk_error", code: "asset_unavailable", kind: "route", ...ref });
      session.tick();
    }
    expect(session.view().connection).toBe("ready");
    expect(session.view().lastError).toBeNull();
    expect(session.view().nav_goal).toMatchObject({ pose: [3, 0, 0, 0], path_poses: [] });
    expect(session.view().interaction?.active_goal?.pose).toEqual([3, 0, 0, 0]);
    expect(session.view().manipulationError).toBeNull();
  });

  it("cancels old pixels before admitting a replacement capture with a different ID", () => {
    const { session, transport, clock } = makeSession();
    handshake(session, transport, clock);
    const messages: Record<string, unknown>[] = [];
    const original = transport.bulk.sendText.bind(transport.bulk);
    transport.bulk.sendText = text => { messages.push(JSON.parse(text)); original(text); };
    const request = (capture_id: string) => session.onTransportText(JSON.stringify({ result_timeout_s: 15, type: "localization_observations_request", capture_id, capture_policy: "any_angle", observation_count: 1 }) + "\n");
    request("old-capture");
    session.sendBinary(new Uint8Array(1000000));
    expect(messages.find(m => m.type === "bulk_upload_begin")?.capture_id).toBe("old-capture");
    request("replacement-capture");
    expect(messages.some(m => m.type === "bulk_upload_cancel")).toBe(true);
    session.sendBinary(new Uint8Array(12));
    session.tick();
    expect(messages.filter(m => m.type === "bulk_upload_begin").at(-1)?.capture_id).toBe("replacement-capture");
    expect(session.view().connection).toBe("ready");
    expect(transport.binaries).toHaveLength(1);
    expect(transport.binaries[0]).toHaveLength(12);
  });
});

describe("deferred asset state ordering", () => {
  const routeRef = { epoch: "fixture-epoch", id: "old-route", revision: "1" };
  const planRef = { epoch: "fixture-epoch", id: "old-plan", revision: "1" };
  const interaction = (revision: number, epoch = "robot") => ({
    motion_busy: false,
    following_tail: null,
    type: "interaction_state", epoch, revision,
    mode: "manual", authority: null, target: null, targets: [], preview: null, active_goal: null });
  const wire = (session: ARModuleSession, value: object) => session.onTransportText(JSON.stringify(value) + "\n");
  const finishRoute = (transport: FakeTransport) => {
    transport.bulk.receive({ type: "bulk_record", ...routeRef, kind: "route", part: 0, parts: 2,
      data: { metadata: { pose: [1, 0, 0, 0], ts: 1 } } });
    transport.bulk.receive({ type: "bulk_record", ...routeRef, kind: "route", part: 1, parts: 2,
      data: { points: [[0, 0, 0, 0], [1, 0, 0, 0]] } });
  };
  const state = (ts: number) => ({ type: "manipulation_state", available: true, ts,
    model: ARM_FIXTURE.model, root_pose: { position: [0, 0, 0], orientation: [0, 0, 0, 1] },
    groups: [{ id: "arm", joint_names: Object.keys(ARM_FIXTURE.joints), base_frame: "base", tip_frame: "gripper_tip", has_gripper: true, following: true }],
    observations: { arm: { joints: ARM_FIXTURE.joints, measured_at: ts, pose: ARM_FIXTURE.pose, gripper: 0 } },
    execution: "idle", stopped: false });
  const finishPlan = (transport: FakeTransport) => {
    transport.bulk.receive({ type: "bulk_record", ...planRef, kind: "trajectory", part: 0, parts: 2,
      data: { metadata: { plan_id: "old-plan", group_id: "arm", target_revision: 1, joint_names: Object.keys(ARM_FIXTURE.joints), duration: 2 } } });
    transport.bulk.receive({ type: "bulk_record", ...planRef, kind: "trajectory", part: 1, parts: 2,
      data: { points: [{ time: 0, positions: Object.values(ARM_FIXTURE.joints) }, { time: 2, positions: Object.values(ARM_FIXTURE.joints) }] } });
  };

  it("does not restore a pending route after the server clears the accepted goal", () => {
    const { session, transport } = makeSession(); handshake(session, transport);
    wire(session, { type: "nav_goal", pose: [1, 0, 0, 0], ts: 1, route_ref: routeRef });
    expect(session.view().nav_goal?.pose).toEqual([1, 0, 0, 0]);
    wire(session, interaction(2));
    finishRoute(transport); session.tick();
    expect(session.view().nav_goal).toBeNull();
    expect(session.view().connection).toBe("ready");
  });

  it("keeps a newer route when an older route finishes downloading", () => {
    const { session, transport } = makeSession(); handshake(session, transport);
    wire(session, { type: "nav_goal", pose: [1, 0, 0, 0], ts: 1, route_ref: routeRef });
    wire(session, { type: "nav_goal", pose: [3, 0, 0, 0], ts: 2, path_poses: [[0, 0, 0, 0], [3, 0, 0, 0]] });
    finishRoute(transport); session.tick();
    expect(session.view().nav_goal?.pose).toEqual([3, 0, 0, 0]);
    expect(session.view().nav_goal?.ts).toBe(2);
  });

  it("keeps a newer canonical endpoint while an earlier route completes", () => {
    const { session, transport } = makeSession(); handshake(session, transport);
    wire(session, { type: "nav_goal", pose: [1, 0, 0, 0], ts: 1, route_ref: routeRef });
    wire(session, { ...interaction(2), active_goal: { type: "nav_goal", pose: [3, 0, 0, 0], path_poses: [], ts: 2 } });
    finishRoute(transport); session.tick();
    expect(session.view().nav_goal?.pose).toEqual([3, 0, 0, 0]);
    expect(session.view().nav_goal?.path_poses).toEqual([]);
  });

  it("does not restore a pending preview after the planning reservation is cancelled", () => {
    const { session, transport } = makeSession(); handshake(session, transport);
    wire(session, { type: "nav_goal", preview: true, preview_id: "cancelled", pose: [1, 0, 0, 0], ts: 1, route_ref: routeRef });
    wire(session, interaction(2));
    finishRoute(transport); session.tick();
    expect(session.view().nav_preview).toBeNull();
  });

  it("retires pending canonical snapshot assets immediately when requesting estop", () => {
    const { session, transport } = makeSession(); handshake(session, transport);
    wire(session, { ...interaction(1), active_goal: { type: "nav_goal", pose: [1, 0, 0, 0], ts: 1, route_ref: routeRef } });
    expect(session.view().nav_goal?.path_poses).toEqual([]);
    session.requestEstop();
    finishRoute(transport); session.tick();
    expect(session.view().nav_goal?.path_poses).toEqual([]);
    expect(session.view().connection).toBe("ready");
  });

  it("does not roll back newer arm execution or restore a cleared plan", () => {
    const { session, transport } = makeSession(); handshake(session, transport);
    wire(session, { ...state(1), plan_ref: planRef });
    wire(session, { ...state(2), execution: "executing", plan: null });
    finishPlan(transport); session.tick();
    expect(session.view().manipulation?.ts).toBe(2);
    expect(session.view().manipulation?.execution).toBe("executing");
    expect(session.view().manipulation?.plan).toBeNull();
  });

  it("does not replace a newer model when an older model finishes downloading", () => {
    const { session, transport } = makeSession(); handshake(session, transport);
    const modelRef = { epoch: "fixture-epoch", id: "old-model", revision: "old" };
    wire(session, { ...state(1), model: undefined, model_ref: modelRef });
    wire(session, { ...state(2), model: { ...ARM_FIXTURE.model, revision: "new-model" } });
    const { links, joints, ...metadata } = ARM_FIXTURE.model;
    transport.bulk.receive({ type: "bulk_record", ...modelRef, kind: "model", part: 0, parts: 3, data: { metadata } });
    transport.bulk.receive({ type: "bulk_record", ...modelRef, kind: "model", part: 1, parts: 3, data: { links } });
    transport.bulk.receive({ type: "bulk_record", ...modelRef, kind: "model", part: 2, parts: 3, data: { joints } });
    session.tick();
    expect(session.view().manipulation?.model?.revision).toBe("new-model");
    expect(session.view().manipulation?.ts).toBe(2);
  });

  it("retires prior interaction-epoch state completions", () => {
    const { session, transport } = makeSession(); handshake(session, transport);
    wire(session, interaction(1, "old-reference"));
    wire(session, { ...state(1), plan_ref: planRef });
    wire(session, interaction(1, "new-reference"));
    finishPlan(transport); session.tick();
    expect(session.view().interaction?.epoch).toBe("new-reference");
    expect(session.view().manipulation?.plan).toBeNull();
    expect(session.view().connection).toBe("ready");
  });

  it("retires pending facts across reconnect to another odometry reference", () => {
    const { session, transport, clock } = makeSession(); handshake(session, transport, clock);
    wire(session, { type: "nav_goal", pose: [1, 0, 0, 0], ts: 1, route_ref: routeRef });
    session.stop(); session.start(); session.onTransportOpen();
    wire(session, { ...helloAt(clock.nowS), odom_reference_id: "different-room" });
    finishRoute(transport); session.tick();
    expect(session.view().hello?.odom_reference_id).toBe("different-room");
    expect(session.view().nav_goal).toBeNull();
  });

  it("still delivers a correlated native plan result after a newer state or estop", () => {
    const { session, transport } = makeSession(); handshake(session, transport);
    const results: any[] = [];
    session.subscribeOutbound(message => { if (message.type === "manipulation_result") results.push(message); });
    wire(session, { type: "manipulation_result", request_id: "accepted-action", action: "plan", group_id: "arm",
      status: "planned", plan_id: "old-plan", target_revision: 1, joint_names: Object.keys(ARM_FIXTURE.joints), duration: 2, plan_ref: planRef });
    wire(session, { ...state(2), execution: "executing", plan: null });
    session.requestEstop();
    wire(session, { type: "manipulation_result", request_id: "execution-outcome", action: "execute", group_id: "arm", status: "accepted" });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ request_id: "execution-outcome", action: "execute", status: "accepted" });
    finishPlan(transport); session.tick();
    expect(results).toHaveLength(2);
    expect(results[1]).toMatchObject({ request_id: "accepted-action", status: "planned", plan_id: "old-plan" });
    expect(session.view().manipulation?.execution).toBe("executing");
    expect(session.view().manipulation?.plan).toBeNull();
  });
});

it("coalesces snapshot bursts before bounded frame processing", () => {
  const { session } = makeSession(false);
  session.start(); session.onTransportOpen();
  session.onTransportText(JSON.stringify(helloAt(0)) + "\n");
  for (let clients = 1; clients <= 100; clients++) {
    session.onTransportText(JSON.stringify({ ...STATE, server: { connected_clients: clients } }) + "\n");
  }
  expect(session.diagnostics().control.pending).toBe(1);
  session.tick();
  expect(session.view().state?.server.connected_clients).toBe(100);
  expect(session.diagnostics().control.coalesced).toBe(99);
});

it("retains the latest congested update while sending a lease renewal", () => {
  const { session, transport, clock } = makeSession();
  session.start(); session.onTransportOpen(); session.onTransportText(JSON.stringify(helloAt(0)) + "\n");
  for (let n = 0; n < 70; n++) {
    session.sendText(JSON.stringify({ type: "interaction_request", action: "update", sequence: n, payload: "x".repeat(1000) }) + "\n");
  }
  session.sendText('{"type":"interaction_request","action":"renew"}\n');
  expect(JSON.parse(transport.texts.at(-1)!)).toMatchObject({ action: "renew" });
  clock.nowS = 1.1; session.tick();
  expect(JSON.parse(transport.texts.at(-1)!)).toMatchObject({ action: "update", sequence: 69 });
});

it("exposes navigation facts through the canonical interaction snapshot", () => {
  const { session, transport } = makeSession();
  handshake(session, transport);
  const interaction = {
    targets: [],
    motion_busy: false,
    following_tail: null,
    type: "interaction_state", epoch: "robot", revision: 1, mode: "manual",
    authority: null, target: null, active_goal: null, preview: null };
  session.onTransportText(JSON.stringify(interaction) + "\n");
  const active = { type: "nav_goal", pose: [2, 0, 0, 0], path_poses: [[0, 0, 0, 0], [2, 0, 0, 0]], ts: 1 };
  session.onTransportText(JSON.stringify(active) + "\n");
  let view = session.view();
  expect(view.nav_goal).toBe(view.interaction!.active_goal);
  expect(session.collaboration.snapshot().activeGoal).toBe(view.nav_goal);
  const preview = { ...active, preview: true, preview_id: "canonical-preview" };
  session.onTransportText(JSON.stringify(preview) + "\n");
  view = session.view();
  expect(view.nav_preview).toBe(view.interaction!.preview);
  expect(session.collaboration.snapshot().preview).toBe(view.nav_preview);
  session.onTransportText(JSON.stringify({ ...interaction, revision: 4 }) + "\n");
  view = session.view();
  expect(view.nav_goal).toBeNull(); expect(view.nav_preview).toBeNull();
  expect(view.interaction!.active_goal).toBeNull(); expect(view.interaction!.preview).toBeNull();
});
