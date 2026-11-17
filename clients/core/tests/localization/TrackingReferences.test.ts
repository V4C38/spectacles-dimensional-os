import { expect, it } from "vitest";
import { ClientPosePublisher } from "../../src/agent/AgentTransport";
import { ClientTrackingOriginStore } from "../../src/localization/ClientTracking";
import { HeadsetTravel, LocalizationTrackingReporter } from "../../src/localization/LocalizationTrackingReporter";
import { ARModuleSession } from "../../src/websocket/ARModuleSession";
import type { LocalizationContext, LocalizationObservation, LocalizationResult, Vec3 } from "../../src/ClientContracts";
import { FakeClock, FakeTransport, helloAt } from "../support/SessionFixture";

const context: LocalizationContext = { type: "localization_context", shared_frame_id: "office", odom_reference_id: "fixture-odom", revision: 0 };
const identity = [0, 0, 0, 1] as [number, number, number, number];
function alignment(overrides: Partial<LocalizationResult> = {}): LocalizationResult {
  return { type: "localization_result", shared_frame_id: context.shared_frame_id, odom_reference_id: context.odom_reference_id,
    alignment_id: "alignment", tracking_reference_id: "tracking", position: [1, 2, 3], orientation: identity, confidence: .9, ts: 101, ...overrides };
}
function alignedStore(): ClientTrackingOriginStore {
  const store = new ClientTrackingOriginStore(); store.setSharedFrameContext(context); store.beginTrackingReference("tracking");
  store.setFromLocalizationResult(alignment()); return store;
}

it("stores one direct map alignment without a client-side native transform", () => {
  const store = alignedStore();
  expect(store.T_map_tracking).toMatchObject({ position: [1, 2, 3], shared_frame_id: "office", alignment_id: "alignment" });
  expect(store.alignmentId).toBe("alignment");
  expect(store.setSharedFrameContext({ ...context, revision: 0 })).toBe(false);
  expect(store.T_map_tracking?.position).toEqual([1, 2, 3]);
});
it("rebases an accepted alignment once and ignores repeated context revisions", () => {
  const store = alignedStore();
  const transition: LocalizationContext = { ...context, shared_frame_id: "registered", revision: 1,
    rebase: { previous_shared_frame_id: "office", position: [10, 0, 0], orientation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] } };
  expect(store.setSharedFrameContext(transition)).toBe(true);
  expect(store.T_map_tracking?.position[0]).toBeCloseTo(8); expect(store.T_map_tracking?.position[1]).toBeCloseTo(1);
  expect(store.T_map_tracking?.position[2]).toBe(3);
  const accepted = store.T_map_tracking;
  expect(store.setSharedFrameContext(transition)).toBe(false); expect(store.T_map_tracking).toBe(accepted);
});
it("restores only a matching map, odometry and tracking reference", () => {
  const store = alignedStore(), origin = store.T_map_tracking!;
  store.resetContext(); store.restore(origin); expect(store.hasTrackingOrigin).toBe(false);
  store.setSharedFrameContext(context); store.restore(origin); expect(store.hasTrackingOrigin).toBe(true);
  store.beginTrackingReference("new-tracking"); expect(store.hasTrackingOrigin).toBe(false);
  store.restore(origin); expect(store.hasTrackingOrigin).toBe(false);
  store.setSharedFrameContext({ ...context, shared_frame_id: "next", revision: 1 });
  expect(() => store.setFromLocalizationResult(alignment())).toThrow(/reference changed/);
});
it("retires an alignment when a root changes without its matching rebase", () => {
  const store = alignedStore();
  store.setSharedFrameContext({ ...context, shared_frame_id: "next", revision: 1 });
  expect(store.hasTrackingOrigin).toBe(false);
});
it("measures horizontal travel without bridging paused gaps", () => {
  const travel = new HeadsetTravel(); travel.sample([0, 0, 0], 0); travel.sample([.06, 0, 5], .2);
  expect(travel.total).toBeCloseTo(.06); travel.pause(); travel.sample([10, 0, 0], 1); travel.sample([10.06, 0, 0], 1.2);
  expect(travel.total).toBeCloseTo(.12); expect(travel.at(.5)).toBeCloseTo(.06);
  travel.sample([NaN, 0, 0], 1.4); travel.sample([20, 0, 0], 1.6); expect(travel.total).toBeCloseTo(.12);
});
it("reports episode progress using capture-time travel", () => {
  const store = new ClientTrackingOriginStore(); store.setSharedFrameContext(context);
  const clock = new FakeClock(), messages: any[] = []; let position: Vec3 = [0, 0, 0];
  const reporter = new LocalizationTrackingReporter({ view: () => ({ connection: "ready" }), sendText: (text: string) => messages.push(JSON.parse(text)) } as never,
    store, { cameraOptical: () => ({ position, orientation: identity }) }, clock);
  reporter.publish(true); clock.nowS = .2; position = [.1, 0, 0]; reporter.publish(true, true);
  clock.nowS = .4; position = [.2, 0, 0]; reporter.publish(true, true);
  reporter.progress({ type: "localization_observations_request", capture_id: "capture", episode_id: "robot", purpose: "robot", capture_policy: "any_angle", observation_count: 1, result_timeout_s: 2 }, "submitted", true, .2);
  expect(messages.at(-1)).toMatchObject({ episode_id: "robot", capture_ts: .2, travel_m: .1 });
});
function ready() {
  const clock = new FakeClock(), transport = new FakeTransport(), origins = new ClientTrackingOriginStore();
  const session = new ARModuleSession({ clock, transport, clientTrackingOriginStore: origins });
  const receive = (message: object) => session.onTransportText(JSON.stringify(message) + "\n");
  session.start(); session.onTransportOpen(); receive({ ...helloAt(0), shared_frame_id: context.shared_frame_id }); receive(context); origins.beginTrackingReference("tracking");
  function submit(episode = "headset", captureTs = 1) {
    receive({ type: "localization_observations_request", capture_id: episode, episode_id: episode, purpose: episode === "robot" ? "robot" : "headset", capture_policy: "any_angle", observation_count: 1, result_timeout_s: 5 });
    const observation: LocalizationObservation = { ts_capture: captureTs, jpeg: new Uint8Array([1]), camera_position: [0, 0, 0], camera_orientation: identity,
      intrinsics: { fx: 1, fy: 1, cx: 0, cy: 0, width: 1, height: 1, distortion_model: "none", distortion: [] } };
    session.submitLocalizationObservations([observation], 5);
  }
  return { session, origins, receive, submit, clock, transport };
}
it("accepts tag and VPS estimates through the same map result contract", () => {
  const f = ready(); f.submit("robot"); f.receive(alignment()); expect(f.origins.alignmentId).toBe("alignment");
  f.submit("headset", 2); f.receive(alignment({ ts: 102, alignment_id: "later", position: [4, 5, 6] }));
  expect(f.origins.T_map_tracking?.position).toEqual([4, 5, 6]); expect(f.origins.alignmentId).toBe("later");
});
it("correlates robot/headset statuses by both episode and capture timestamp", () => {
  const f = ready(), statuses: object[] = []; f.session.subscribeOutbound(message => { if (message.type === "localization_status") statuses.push(message); }); f.submit();
  const status = { type: "localization_status", ...context, scope: "headset", status: "failed", reason: "miss", ts: 101 };
  f.receive({ ...status, type: "localization_status", episode_id: "robot" });
  f.receive({ ...status, type: "localization_status", episode_id: "headset", ts: 100 }); expect(statuses).toEqual([]);
  f.receive({ ...status, type: "localization_status", episode_id: "headset" }); expect(statuses).toHaveLength(1);
});
it("invalidates reconnect restoration when hello names a different map", () => {
  const f = ready(); f.submit(); f.receive(alignment()); expect(f.origins.hasTrackingOrigin).toBe(true);
  f.session.onTransportClose(); f.clock.nowS = .1; f.session.tick(); f.session.onTransportOpen();
  f.receive({ ...helloAt(.1), shared_frame_id: "different-map" }); expect(f.origins.hasTrackingOrigin).toBe(false);
});
it("publishes metric map camera poses at the shared cadence", () => {
  const origins = alignedStore(), clock = new FakeClock(), sent: any[] = [];
  const publisher = new ClientPosePublisher({ view: () => ({ connection: "ready", capabilities: { agent: { available: true } } }), sendText: (text: string) => sent.push(JSON.parse(text)) } as never,
    origins, { cameraOptical: () => ({ position: [.5, 0, 0], orientation: identity }) }, clock);
  publisher.tick(); expect(sent[0]).toMatchObject({ type: "client_pose", position: [1.5, 2, 3] });
  clock.nowS = .05; publisher.tick(); expect(sent).toHaveLength(1);
});
it("accepts telemetry notices only for the current frame and native source", () => {
  const f = ready(), status = { type: "localization_status", ...context, scope: "robot", status: "deferred", reason: "robot_pose_unavailable" };
  f.receive({ ...status, type: "localization_status", odom_reference_id: "old" }); expect(f.session.view().localizationNotice).toBeNull();
  f.receive({ ...status, type: "localization_status" }); expect(f.session.view().localizationNotice).toContain("telemetry unavailable");
});

it("preserves connected frame context and same-tracking baseline through a UI clear", () => {
  const store = alignedStore(), baseline = store.T_map_tracking!;
  store.clear(); expect(store.hasTrackingOrigin).toBe(false); expect(store.acceptsContext(context)).toBe(true);
  store.restore(baseline); expect(store.T_map_tracking).toEqual(baseline);
  store.resetContext(); expect(store.sharedFrameContext).toBeNull();
});
