import { describe, expect, it } from "vitest";
import { ClientTrackingOriginStore } from "../../src/localization/ClientTracking";
import { ARModuleSession } from "../../src/websocket/ARModuleSession";
import { FakeClock, FakeTransport, helloAt, stateFrame } from "../support/SessionFixture";
import type { InteractionState, NavGoal } from "../../src/ClientContracts";

function fixture() {
  const transport = new FakeTransport(), clock = new FakeClock();
  const session = new ARModuleSession({ transport, clock, clientTrackingOriginStore: new ClientTrackingOriginStore() });
  session.start(); session.onTransportOpen();
  session.onTransportText(JSON.stringify(helloAt(0)) + "\n" + JSON.stringify(stateFrame()) + "\n"); session.tick();
  const base: InteractionState = { type: "interaction_state", epoch: "robot", revision: 0, mode: "manual",
    authority: null, targets: [], following_tail: null, motion_busy: false, preview: null, active_goal: null };
  const send = (value: object) => { session.onTransportText(JSON.stringify(value) + "\n"); session.tick(); };
  const ref = (id: string) => ({ epoch: "fixture-epoch", id, revision: id });
  const goal = (x: number): NavGoal => ({ type: "nav_goal", ts: x, pose: [x, 0, 0, 0], path_poses: [[0,0,0,0], [x,0,0,0]] });
  const pending = (x: number) => ({ type: "nav_goal", ts: x, pose: [x,0,0,0], route_ref: ref(String(x)) });
  const finish = (x: number) => {
    transport.bulk.receive({ type: "bulk_record", ...ref(String(x)), kind: "route", part: 0, parts: 2,
      data: { metadata: { ts: x, pose: [x,0,0,0] } } });
    transport.bulk.receive({ type: "bulk_record", ...ref(String(x)), kind: "route", part: 1, parts: 2,
      data: { points: [[0,0,0,0], [x,0,0,0]] } });
    session.tick();
  };
  return { session, base, send, goal, pending, finish };
}

describe("atomic navigation asset promotion", () => {
  it("keeps the complete path and endpoint through unrelated revisions until the latest asset completes", () => {
    const f = fixture(); f.send({ ...f.base, revision: 1, active_goal: f.goal(1) });
    const first = f.session.view().nav_goal;
    f.send({ ...f.base, revision: 2, active_goal: f.pending(2) });
    expect(f.session.view().nav_goal).toBe(first);
    f.send({ ...f.base, revision: 3, motion_busy: true, active_goal: f.pending(2) });
    expect(f.session.view().interaction?.motion_busy).toBe(true);
    expect(f.session.view().nav_goal).toBe(first);
    f.finish(2);
    expect(f.session.view().nav_goal).toMatchObject({ pose: [2,0,0,0], path_poses: [[0,0,0,0], [2,0,0,0]] });
    expect(f.session.view().interaction?.revision).toBe(3);
    f.session.stop();
  });

  it("fences superseded assets, explicit cancellation and source replacement", () => {
    const f = fixture(); f.send({ ...f.base, revision: 1, active_goal: f.goal(1) });
    f.send({ ...f.base, revision: 2, active_goal: f.pending(2) });
    f.send({ ...f.base, revision: 3, active_goal: f.pending(3) });
    f.finish(2); expect(f.session.view().nav_goal?.pose?.[0]).toBe(1);
    f.finish(3); expect(f.session.view().nav_goal?.pose?.[0]).toBe(3);
    f.send({ ...f.base, revision: 4, active_goal: f.pending(4) });
    f.send({ ...f.base, revision: 5, active_goal: null });
    f.finish(4); expect(f.session.view().nav_goal).toBeNull();
    f.send({ ...f.base, revision: 6, active_goal: f.goal(6) });
    f.send({ ...f.base, epoch: "new-source", revision: 0, active_goal: f.pending(7) });
    expect(f.session.view().nav_goal?.path_poses ?? []).toHaveLength(0);
    f.session.stop();
  });

  it("retains advisory routes only within their lease and never treats an explicit failed route as pending", () => {
    const f = fixture();
    const authority = { client_id: "other", source_id: "hand", acquisition_id: "grab", lease_id: "lease",
      kind: "navigation_planning", held: true, expires_at: 5, sequence: 1 };
    f.send({ ...f.base, revision: 1, authority, preview: { ...f.goal(1), preview: true } });
    const first = f.session.view().nav_preview;
    f.send({ ...f.base, revision: 2, authority, preview: { ...f.pending(2), preview: true } });
    expect(f.session.view().nav_preview).toBe(first);
    f.send({ ...f.base, revision: 3, authority: { ...authority, lease_id: "successor" }, preview: { ...f.pending(3), preview: true } });
    expect(f.session.view().nav_preview).toBeNull();
    f.finish(2); expect(f.session.view().nav_preview).toBeNull();
    f.finish(3); expect(f.session.view().nav_preview?.pose?.[0]).toBe(3);
    f.send({ ...f.base, revision: 4, authority, preview: { type: "nav_goal", preview: true, ts: 4, path_poses: [] } });
    expect(f.session.view().nav_preview?.path_poses).toHaveLength(0);
    f.session.stop();
  });
});
