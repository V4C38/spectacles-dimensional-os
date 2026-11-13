import { ClientPosePublisher } from "../../src/agent/AgentTransport";
import { expect, it } from "vitest";
import { ClientTrackingOriginStore } from "../../src/localization/ClientTracking";
import { HeadsetTravel, LocalizationTrackingReporter } from "../../src/localization/LocalizationTrackingReporter";

import { ARModuleSession } from "../../src/websocket/ARModuleSession";
import type { LocalizationObservation, LocalizationResult, LocalizationMapTransform, Vec3 } from "../../src/ClientContracts";
import { FakeClock, FakeTransport, helloAt } from "../support/SessionFixture";

const context = { map_code: "office", odom_reference_id: "fixture-odom" };
const identity = [0, 0, 0, 1] as [number, number, number, number];
function transform(revision: number): LocalizationMapTransform {
  return { ...context, type: "localization_map_transform", revision,
    position: [10, 0, 0], orientation: [0, 0, Math.SQRT1_2, Math.SQRT1_2], confidence: .8, ts: 100 };
}
function alignment(): LocalizationResult {
  return { type: "localization_result", position: [0, 0, 0], orientation: identity, confidence: .9, ts: 101,
    map_alignment: { ...context, id: "alignment", tracking_reference_id: "tracking", travel_m: 0,
      position: [1, 0, 0], orientation: identity, confidence: .9, ts: 101 }, map_transform: transform(1) };
}

it("composes rotated map alignment with the newest robot transform and ignores stale revisions", () => {
  const store = new ClientTrackingOriginStore(); store.setMapContext(context); store.beginTrackingReference("tracking");
  store.applyMapTransform(transform(2));
  const origin = store.setFromLocalizationResult(alignment());
  expect(origin.position[0]).toBeCloseTo(10); expect(origin.position[1]).toBeCloseTo(1);
  expect(origin.confidence).toBe(.8); expect(origin.mapTransform?.revision).toBe(2);
  store.applyMapTransform({ ...transform(1), position: [99, 0, 0] }); expect(store.T_odom_client).toBe(origin);
  store.applyMapTransform({ ...transform(3), map_code: "wrong" }); expect(store.T_odom_client).toBe(origin);
});

it("retains the same tracking reference on reconnect and retires map or tracking replacements", () => {
  const store = new ClientTrackingOriginStore(); store.setMapContext(context); store.beginTrackingReference("tracking");
  const origin = store.setFromLocalizationResult(alignment()); store.clear(); store.restore(origin);
  expect(store.hasTrackingOrigin).toBe(true); expect(store.acceptsContext(context)).toBe(true);
  store.beginTrackingReference("new-tracking");
  expect(store.hasTrackingOrigin).toBe(false); expect(store.acceptsContext(context)).toBe(true);
  store.restore(origin); expect(store.hasTrackingOrigin).toBe(false);
  store.setMapContext({ ...context, map_code: "next" }); expect(store.acceptsContext(context)).toBe(false);
  expect(() => store.setFromLocalizationResult(alignment())).toThrow(/reference changed/);
});

it("measures horizontal physical travel while excluding paused gaps and retaining capture-time history", () => {
  const travel = new HeadsetTravel(); travel.sample([0, 0, 0], 0); travel.sample([.06, 0, 5], .2);
  expect(travel.total).toBeCloseTo(.06); travel.pause();
  travel.sample([10, 0, 0], 1); travel.sample([10.06, 0, 0], 1.2);
  expect(travel.total).toBeCloseTo(.12); expect(travel.at(.5)).toBeCloseTo(.06);
  travel.sample([NaN, 0, 0], 1.4); travel.sample([20, 0, 0], 1.6);
  expect(travel.total).toBeCloseTo(.12); travel.reset(); expect(travel.total).toBe(0);
});

it("reports episode progress using capture-time travel without inventing inactive motion", () => {
  const store = new ClientTrackingOriginStore(); store.setMapContext(context);
  const clock = new FakeClock(), messages: any[] = []; let position: Vec3 = [0, 0, 0];
  const reporter = new LocalizationTrackingReporter({ view: () => ({ connection: "ready" }),
    sendText: (text: string) => messages.push(JSON.parse(text)) } as never, store,
    { cameraOptical: () => ({ position, orientation: identity }) }, clock);
  reporter.publish(true); clock.nowS = .2; position = [.1, 0, 0]; reporter.publish(true, true);
  clock.nowS = .4; position = [.2, 0, 0]; reporter.publish(true, true);
  reporter.progress({ type: "localization_observations_request", capture_id: "capture", episode_id: "robot",
    purpose: "robot", capture_policy: "any_angle", observation_count: 1, result_timeout_s: 2 }, "submitted", true, .2);
  expect(messages.at(-1)).toMatchObject({ episode_id: "robot", capture_ts: .2, travel_m: .1 });
  reporter.publish(false, true); clock.nowS = 1; position = [10, 0, 0]; reporter.publish(true, true);
  expect(messages.at(-1).travel_m).toBeCloseTo(.2); expect(messages.at(-2).active).toBe(false);
});

function ready() {
  const clock = new FakeClock(), transport = new FakeTransport(), origins = new ClientTrackingOriginStore();
  const session = new ARModuleSession({ clock, transport, clientTrackingOriginStore: origins });
  const receive = (message: object) => session.onTransportText(JSON.stringify(message) + "\n");
  session.start(); session.onTransportOpen(); receive(helloAt(0)); receive({ type: "localization_context", ...context });
  function submit(episode = "headset", captureTs = 1) {
    receive({ type: "localization_observations_request", capture_id: episode, episode_id: episode,
      purpose: episode === "robot" ? "robot" : "headset", capture_policy: "any_angle", observation_count: 1, result_timeout_s: 5 });
    const observation: LocalizationObservation = { ts_capture: captureTs, jpeg: new Uint8Array([1]),
      camera_position: [0, 0, 0], camera_orientation: identity,
      intrinsics: { fx: 1, fy: 1, cx: 0, cy: 0, width: 1, height: 1, distortion_model: "none", distortion: [] } };
    session.submitLocalizationObservations([observation], 5);
  }
  return { session, origins, receive, submit, clock, transport };
}

it("accepts an unanchored tag fallback through the session without fabricating VPS registration", () => {
  const f = ready(); f.submit("robot");
  f.receive({ type: "localization_result", position: [1, 2, 3], orientation: identity, confidence: .9, ts: 101 });
  expect(f.session.view().hasTrackingOrigin).toBe(true); expect(f.origins.T_odom_client).toMatchObject({ position: [1, 2, 3] });
  expect(f.origins.mapAlignment).toBeNull(); expect(f.origins.T_odom_client?.mapTransform).toBeUndefined();
  f.receive({ type: "localization_status", ...context, scope: "robot", status: "failed", reason: "miss" });
  expect(f.origins.T_odom_client?.position).toEqual([1, 2, 3]);
});

it("correlates robot/headset statuses by both episode and capture timestamp", () => {
  const f = ready(), statuses: object[] = [];
  f.session.subscribeOutbound(message => { if (message.type === "localization_status") statuses.push(message); });
  f.submit();
  const status = { type: "localization_status", ...context, scope: "headset", status: "failed", reason: "miss", ts: 101 };
  f.receive({ ...status, episode_id: "robot" });
  f.receive({ ...status, episode_id: "headset", ts: 100 }); expect(statuses).toEqual([]);
  f.receive({ ...status, episode_id: "headset" }); expect(statuses).toHaveLength(1);
  f.receive({ ...status, episode_id: "headset" }); expect(statuses).toHaveLength(1);
});

it("accepts a later independent VPS registration after a relative tag fallback", () => {
  const f = ready(); f.submit("robot");
  f.receive({ type: "localization_result", position: [1, 2, 3], orientation: identity, confidence: .9, ts: 101 });
  f.origins.beginTrackingReference("tracking"); f.submit("headset", 2);
  f.receive({ ...alignment(), ts: 102 });
  expect(f.origins.mapAlignment?.id).toBe("alignment");
  expect(f.origins.T_odom_client?.position[0]).toBeCloseTo(10);
  expect(f.origins.T_odom_client?.position[1]).toBeCloseTo(1);
});

it("restores map alignment only across a reconnect to the same odometry reference", () => {
  const f = ready(); f.origins.beginTrackingReference("tracking"); f.submit(); f.receive(alignment());
  expect(f.origins.hasTrackingOrigin).toBe(true);
  f.session.onTransportClose(); f.clock.nowS = .1; f.session.tick(); f.session.onTransportOpen(); f.receive(helloAt(.1));
  expect(f.origins.mapAlignment?.id).toBe("alignment");
  f.session.onTransportClose(); f.clock.nowS = .2; f.session.tick(); f.session.onTransportOpen();
  f.receive({ ...helloAt(.2), odom_reference_id: "different-odom" });
  expect(f.origins.hasTrackingOrigin).toBe(false);
});

it("publishes corrected agent camera poses at the shared cadence only while tracking is available", () => {
  const origins = new ClientTrackingOriginStore(), clock = new FakeClock(), sent: any[] = [];
  origins.setFromLocalizationResult({ type: "localization_result", position: [1, 2, 3], orientation: identity, confidence: 1, ts: 0 });
  let ready = true, available = true, fails = false;
  const publisher = new ClientPosePublisher({ view: () => ({ connection: ready ? "ready" : "failed",
    capabilities: { agent: { available } } }), sendText: (text: string) => sent.push(JSON.parse(text)) } as never,
    origins, { cameraOptical: () => { if (fails) throw new Error("lost tracking"); return { position: [.5, 0, 0], orientation: identity }; } }, clock);
  publisher.tick(); expect(sent).toHaveLength(1); expect(sent[0]).toMatchObject({ type: "client_pose", position: [1.5, 2, 3], ts: 0 });
  clock.nowS = .05; publisher.tick(); expect(sent).toHaveLength(1);
  clock.nowS = .2; fails = true; publisher.tick(); expect(sent).toHaveLength(1);
  fails = false; available = false; publisher.tick(); ready = false; available = true; publisher.tick();
  ready = true; origins.clear(); publisher.tick(); expect(sent).toHaveLength(1);
});
