import { describe, expect, it } from "vitest";
import type { InteractionState, LocalizationContext, Vec3, WebSocketTransportHandlers } from "../../src/ClientContracts";
import { ClientTrackingOriginStore } from "../../src/localization/ClientTracking";
import { CollaborationController } from "../../src/replication/CollaborationController";
import { NavigationGoalLifecycle, NavigationPreviewCoordinator } from "../../src/navigation/NavigationInteraction";
import { ARModuleSession } from "../../src/websocket/ARModuleSession";
import { BulkTransfer } from "../../src/websocket/BulkTransfer";
import { fixtureBinaryPackets } from "../../../../tools/integration-tests/support/IntegrationBulk";
import { PairedBulk } from "../support/PairedBulk";
import { FakeClock, FakeTransport, helloAt } from "../support/SessionFixture";

const adoption: LocalizationContext = {
  type: "localization_context", shared_frame_id: "vps-map", odom_reference_id: "fixture-odom", revision: 1,
  rebase: { previous_shared_frame_id: "session-map", position: [10, 20, 0],
    orientation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] },
};
const wire = (session: ARModuleSession, message: object) => {
  session.onTransportText(JSON.stringify(message) + "\n");
  session.tick();
};

class BackpressuredTransport extends FakeTransport {
  pendingBytes = 0;
  bufferedAmount(): number { return this.pendingBytes; }
}

function fixture() {
  const transport = new BackpressuredTransport(), clock = new FakeClock();
  const store = new ClientTrackingOriginStore();
  const session = new ARModuleSession({ transport, clock, clientTrackingOriginStore: store });
  session.start(); session.onTransportOpen();
  wire(session, { ...helloAt(0), shared_frame_id: "session-map" });
  store.beginTrackingReference("headset-tracking");
  store.setFromLocalizationResult({ type: "localization_result", alignment_id: "alignment",
    shared_frame_id: "session-map", odom_reference_id: "fixture-odom", tracking_reference_id: "headset-tracking",
    position: [2, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: 100 });
  return { session, transport, clock, store };
}

describe("shared frame adoption", () => {
  it.each([false, true])("discards delayed old-frame LiDAR without disrupting the new transfer (header delayed: %s)", delayedHeader => {
    const port = new PairedBulk(), failures: string[] = [], samples: Uint8Array[] = [];
    let handlers!: WebSocketTransportHandlers;
    const bind = port.bind.bind(port);
    port.bind = value => { handlers = value; bind(value); };
    const bulk = new BulkTransfer({ now: () => 0 }, () => {}, value => samples.push(value), value => failures.push(value));
    bulk.connect(port, { client_id: "client", bulk_token: "token", bulk_epoch: "fixture-epoch", shared_frame_id: "session-map" });
    bulk.tick();
    const begin = (id: number, frame: string) => port.receive({ type: "bulk_binary_begin", kind: "lidar",
      epoch: "fixture-epoch", id, total_bytes: 16, shared_frame_id: frame });
    if (!delayedHeader) { begin(1, "session-map"); bulk.tick(); }
    bulk.setSharedFrame("vps-map");
    if (delayedHeader) { begin(1, "session-map"); bulk.tick(); }
    begin(2, "vps-map"); bulk.tick();
    handlers.onTransportBinary(fixtureBinaryPackets(new Uint8Array(16).fill(1), 1)[0]!);
    const current = new Uint8Array(16).fill(2);
    handlers.onTransportBinary(fixtureBinaryPackets(current, 2)[0]!);
    bulk.tick();
    expect(samples).toEqual([current]);
    expect(failures).toEqual([]);
  });

  it.each(["session-map", "vps-map"])("restores a disconnected headset only in its retained frame (%s)", sharedFrame => {
    const { session, clock, store } = fixture();
    session.onTransportClose();
    clock.nowS = 0.1; session.tick(); session.onTransportOpen();
    wire(session, { ...helloAt(clock.nowS), shared_frame_id: sharedFrame });
    expect(session.view().connection).toBe("ready");
    expect(store.hasTrackingOrigin).toBe(sharedFrame === "session-map");
    expect(session.view().alignmentRequired === true).toBe(sharedFrame !== "session-map");
  });

  it("rebases an accepted origin once and discards queued serialized old-frame input", () => {
    const { session, transport, clock, store } = fixture();
    transport.pendingBytes = 30_000;
    session.sendText(JSON.stringify({ type: "client_pose", shared_frame_id: "session-map",
      position: [2, 0, 0], orientation: [0, 0, 0, 1], ts: 100 }) + "\n");
    expect(transport.texts.map(text => JSON.parse(text).type)).not.toContain("client_pose");
    wire(session, adoption);
    wire(session, adoption);
    expect(store.T_map_tracking?.position[0]).toBeCloseTo(10);
    expect(store.T_map_tracking?.position[1]).toBeCloseTo(22);
    transport.pendingBytes = 0; clock.nowS = 1; session.tick();
    expect(transport.texts.map(text => JSON.parse(text).type)).not.toContain("client_pose");
    expect(session.view().hasTrackingOrigin).toBe(true);
  });

  it("delivers a native joint-space plan result whose asset completes after adoption", () => {
    const { session, transport } = fixture();
    const results: object[] = [];
    session.subscribeOutbound(message => { if (message.type === "manipulation_result") results.push(message); });
    const ref = { epoch: "fixture-epoch", id: "native-plan", revision: "1" };
    const metadata = { plan_id: "native-plan", group_id: "arm", target_revision: 1, joint_names: ["joint"], duration: 2,
      shared_frame_id: "session-map" };
    wire(session, { type: "manipulation_result", request_id: "pending-plan", action: "plan", status: "planned",
      ...metadata, plan_ref: ref });
    transport.bulk.receive({ type: "bulk_record", ...ref, kind: "trajectory", part: 0, parts: 2,
      data: { metadata } });
    session.tick();
    expect(results).toHaveLength(0);
    wire(session, adoption);
    transport.bulk.receive({ type: "bulk_record", ...ref, kind: "trajectory", part: 1, parts: 2,
      data: { points: [{ time: 0, positions: [0] }, { time: 2, positions: [1] }] } });
    session.tick();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ request_id: "pending-plan", status: "planned", plan_id: "native-plan" });
    expect(session.view().connection).toBe("ready");
  });

  it("does not reinstate an old-frame route when its bulk asset finishes late", () => {
    const { session, transport } = fixture();
    const ref = { epoch: "fixture-epoch", id: "old-route", revision: "1" };
    wire(session, { ...interactionState(), shared_frame_id: "session-map",
      active_goal: { type: "nav_goal", pose: [2, 0, 0, 0], ts: 100, route_ref: ref } });
    wire(session, adoption);
    transport.bulk.receive({ type: "bulk_record", ...ref, kind: "route", part: 0, parts: 1,
      data: { metadata: { shared_frame_id: "session-map", pose: [2, 0, 0, 0], ts: 100 },
        points: [[0, 0, 0, 0], [2, 0, 0, 0]] } });
    session.tick();
    expect(session.view().nav_goal).toBeNull();
    expect(session.view().connection).toBe("ready");
  });

  it("discards remaining parts of a route interrupted by adoption", () => {
    const { session, transport } = fixture();
    const ref = { epoch: "fixture-epoch", id: "partial-route", revision: "1" };
    transport.bulk.receive({ type: "bulk_record", ...ref, kind: "route", part: 0, parts: 2,
      data: { metadata: { shared_frame_id: "session-map", pose: [2, 0, 0, 0], ts: 100 },
        points: [[0, 0, 0, 0]] } });
    session.tick();
    wire(session, adoption);
    transport.bulk.receive({ type: "bulk_record", ...ref, kind: "route", part: 1, parts: 2,
      data: { points: [[2, 0, 0, 0]] } });
    session.tick();
    expect(session.view().nav_goal).toBeNull();
    expect(session.view().connection).toBe("ready");
    expect(session.view().lastError).toBeNull();
  });

  it("transforms a deferred planning release while preserving the acquisition and lease", () => {
    const messages: Record<string, unknown>[] = [];
    const controller = new CollaborationController({ ready: () => true, clientId: () => "client",
      now: () => 0, send: text => messages.push(JSON.parse(text)) });
    controller.apply(interactionState());
    const pose = { position: [2, 0, 0] as Vec3, orientation: [0, 0, 0, 1] as const };
    expect(controller.begin("navigation_planning", "hand", pose)).toBe(true);
    const request = messages[0]!;
    controller.release(pose);
    controller.rebase(adoption.rebase!);
    controller.accept({ type: "interaction_result", request_id: String(request.request_id),
      epoch: "authority", revision: 2, status: "accepted", code: "acquired", lease_id: "lease" });
    const release = messages.find(message => message.action === "release")!;
    expect(release).toMatchObject({ epoch: "authority", lease_id: "lease" });
    expect((release.position as number[])[0]).toBeCloseTo(10);
    expect((release.position as number[])[1]).toBeCloseTo(22);
    expect(messages.filter(message => message.action === "acquire")).toHaveLength(1);
    expect(messages.some(message => message.action === "cancel")).toBe(false);
  });

  it("retires cached execution and preview paths when the shared frame changes", () => {
    const { session, store } = fixture();
    const path: [number, number, number, number][] = [[0, 0, 0, 0], [2, 0, 0, 0]];
    wire(session, { ...interactionState(), shared_frame_id: "session-map",
      authority: { client_id: "other", source_id: "hand", acquisition_id: "acquisition", lease_id: "lease",
        kind: "navigation_planning", held: false, expires_at: 200, sequence: 0 },
      preview: { type: "nav_goal", pose: [2, 0, 0, 0], path_poses: path, ts: 100 },
      active_goal: { type: "nav_goal", pose: [2, 0, 0, 0], path_poses: path, ts: 100 } });
    const goals = new NavigationGoalLifecycle({ sendGoal: () => {}, cancel: () => {} });
    const previews = new NavigationPreviewCoordinator(session);
    goals.apply(session.view(), store.T_map_tracking, null);
    previews.apply(store.T_map_tracking);
    expect(goals.snapshot().path).toEqual(path);
    expect(previews.displayPath()).toEqual(path);
    wire(session, adoption);
    goals.apply(session.view(), store.T_map_tracking, null);
    previews.apply(store.T_map_tracking);
    expect(goals.snapshot().path).toBeNull();
    expect(previews.displayPath()).toBeNull();
  });
});

function interactionState(): InteractionState {
  return { type: "interaction_state", epoch: "authority", revision: 1, mode: "manual",
    authority: null, targets: [], motion_busy: false, following_tail: null, preview: null, active_goal: null };
}
