import { describe, expect, it } from "vitest";
import { CollaborationController } from "../../../Assets/Scripts/DimOSARClient/replication/CollaborationController";
import type { InteractionState, InteractionPose } from "../../../Assets/Scripts/DimOSARClient/replication/CollaborationTypes";
import { decodeOutbound } from "../../../Assets/Scripts/DimOSARClient/websocket/protocol";
const pose = (x: number): InteractionPose => ({ position: [x, 0, 0], orientation: [0, 0, 0, 1] });
function state(revision = 0): InteractionState { return { type: "interaction_state", epoch: "robot", revision, mode: "manual", authority: null, target: null, preview: null, active_goal: null }; }
function fixture() {
  const clock = { now: 0 }, messages: any[] = [];
  const core = new CollaborationController({ ready: () => true, clientId: () => "a", now: () => clock.now,
    send: text => messages.push(JSON.parse(text)) });
  core.apply(state());
  const grant = (kind: "live" | "navigation_planning" | "joystick" = "live") => {
    expect(core.begin(kind, "hand", pose(0))).toBe(true);
    const request = messages[messages.length - 1];
    const next = state(1);
    next.authority = { client_id: "a", source_id: "hand", acquisition_id: request.acquisition_id,
      lease_id: "lease", kind, held: true, sequence: -1, expires_at: 5 };
    core.apply(next);
    core.accept({ type: "interaction_result", request_id: request.request_id, epoch: "robot", revision: 1,
      status: "accepted", code: "acquired", lease_id: "lease" });
  };
  return { core, clock, messages, grant };
}
describe("robot replication", () => {
  it("predicts immediately while acquisition is pending without a motion credential", () => {
    const { core, messages } = fixture();
    core.begin("live", "hand", pose(0)); core.update(pose(2));
    expect(core.snapshot().target?.position[0]).toBe(2);
    expect(core.credentials()).toBeNull();
    expect(messages.map(m => m.action)).toEqual(["acquire"]);
  });
  it("limits target publication to 20 Hz without throttling local prediction", () => {
    const { core, clock, messages, grant } = fixture(); grant();
    core.update(pose(1)); clock.now = 0.01; core.update(pose(2));
    expect(core.snapshot().target?.position[0]).toBe(2);
    expect(messages.filter(m => m.action === "update")).toHaveLength(1);
    clock.now = 0.06; core.tick();
    expect(messages.filter(m => m.action === "update")).toHaveLength(2);
    core.update(pose(2)); clock.now = 0.2; core.tick();
    expect(messages.filter(m => m.action === "update")).toHaveLength(2);
  });
  it("cancels a live release before grant and retires a late successful grant", () => {
    const { core, messages } = fixture(); core.begin("live", "hand");
    const request = messages[0]; core.release(pose(3));
    expect(messages[1].action).toBe("cancel_acquire");
    core.accept({ type: "interaction_result", request_id: request.request_id, epoch: "robot", revision: 1,
      status: "accepted", code: "acquired", lease_id: "late" });
    expect(messages[messages.length - 1]).toMatchObject({ action: "cancel", lease_id: "late" });
    expect(core.snapshot().pending).toBe(false);
  });
  it("retains selected navigation authority after release and continues renewal", () => {
    const { core, clock, messages, grant } = fixture(); grant("navigation_planning");
    core.release(pose(2)); clock.now = 0.2; core.tick();
    expect(core.snapshot().ownsAuthority).toBe(true);
    expect(messages.some(m => m.action === "renew")).toBe(true);
    core.confirm(pose(3));
    expect(messages[messages.length - 1]).toMatchObject({ action: "confirm", position: [3, 0, 0] });
  });
  it("handles a grant reply before its snapshot, including deferred planning release", () => {
    const { core, messages } = fixture(); core.begin("navigation_planning", "hand", pose(0));
    const request = messages[0]; core.release(pose(2));
    core.accept({ type: "interaction_result", request_id: request.request_id, epoch: "robot", revision: 1,
      status: "accepted", code: "acquired", lease_id: "lease" });
    expect(messages[messages.length - 1]).toMatchObject({ action: "release", lease_id: "lease", position: [2, 0, 0] });
  });
  it("interpolates canonical poses using server time deltas despite receiver jitter", () => {
    const { core, clock } = fixture();
    const a = state(1); a.target = { ...pose(0), revision: 1, phase: "live", sample_ts: 100, sequence: 1 };
    core.apply(a); clock.now = 0.07;
    core.apply({ ...a, revision: 2, target: { ...a.target!, ...pose(1), revision: 2, sample_ts: 100.05 } });
    clock.now = 0.125; expect(core.snapshot().target!.position[0]).toBeCloseTo(0.5);
    clock.now = 0.3; expect(core.snapshot().target!.position[0]).toBe(1);
    expect(core.snapshot().stale).toBe(false);
  });
  it("does not mark stationary held targets stale while authority heartbeats arrive", () => {
    const { core, clock } = fixture();
    const a = state(1); a.authority = { client_id: "b", source_id: "hand", acquisition_id: "remote", lease_id: "other", kind: "live", held: true, sequence: 1, expires_at: 10 };
    a.target = { ...pose(2), revision: 1, phase: "live", sample_ts: 1, sequence: 1 };
    core.apply(a); clock.now = 0.4; core.apply({ ...a, revision: 2 });
    expect(core.snapshot().stale).toBe(false); expect(core.snapshot().blocked).toBe(true);
    clock.now = 0.7; expect(core.snapshot().stale).toBe(true);
  });
  it("settles promptly when a late join's parked target starts moving again", () => {
    const { core, clock } = fixture();
    const parked = state(1);
    parked.target = { ...pose(0), revision: 1, phase: "committed", sample_ts: 1, sequence: 1 };
    core.apply(parked);
    clock.now = 0.05;
    core.apply({ ...parked, revision: 2, target: { ...parked.target!, ...pose(4), revision: 2, sample_ts: 3601 } });
    clock.now = 0.16;
    expect(core.snapshot().target!.position[0]).toBe(4);
  });
  it("rejects older snapshots and resets interpolation on epoch changes", () => {
    const { core } = fixture(); const a = state(2);
    a.target = { ...pose(4), revision: 1, phase: "committed", sample_ts: 100, sequence: 1 };
    core.apply(a); expect(core.apply(state(1))).toBe(false);
    core.apply({ ...state(), epoch: "new" }); expect(core.snapshot().target).toBeNull();
  });
  it("decodes signed initial sequence sentinels and rejects malformed target facts", () => {
    const a = state(); a.target = { ...pose(0), revision: 1, phase: "draft", sample_ts: 100, sequence: -1 };
    expect(decodeOutbound(JSON.stringify(a))).toEqual(a);
    expect(() => decodeOutbound(JSON.stringify({ ...a, target: { ...a.target, sequence: -2 } }))).toThrow();
    expect(() => decodeOutbound(JSON.stringify({ ...a, target: { ...a.target, position: [null, 0, 0] } }))).toThrow();
  });
  it("decodes the exact accepted endpoint while its native route is pending", () => {
    const pending = { ...state(1), active_goal: { type: "nav_goal", pose: [4, 2, 0, 0], path_poses: [], ts: 1 } };
    expect(decodeOutbound(JSON.stringify(pending))).toEqual(pending);
    const routed = { ...pending, revision: 2, active_goal: { ...pending.active_goal, path_poses: [[0,0,0,0], [4,2,0,0]] } };
    expect(decodeOutbound(JSON.stringify(routed))).toEqual(routed);
    expect(() => decodeOutbound(JSON.stringify(pending.active_goal))).toThrow("pose must be omitted");
  });
  it("blocks new gestures while the robot owns an accepted native operation", () => {
    const { core } = fixture(); core.apply({ ...state(1), motion_busy: true });
    expect(core.snapshot().blocked).toBe(true); expect(core.begin("live", "hand", pose(1))).toBe(false);
  });
  it("retires its own input before requesting a robot-wide mode change", () => {
    const { core, messages, grant } = fixture(); grant("joystick");
    core.setMode("agent");
    expect(messages.slice(-2).map(packet => packet.action)).toEqual(["cancel", "mode"]);
    expect(core.snapshot().ownsAuthority).toBe(false);
  });
  it("retires final prediction when an unchanged canonical target acknowledges release", () => {
    const { core, clock, grant } = fixture(); grant();
    const authority = core.raw()!.authority!;
    const target = { ...pose(2), revision: 1, phase: "live" as const, sample_ts: 1, sequence: 1 };
    core.apply({ ...state(2), authority, target });
    core.release(pose(2));
    core.apply({ ...state(3), target: { ...target, phase: "committed" } });
    core.apply({ ...state(4), target: { ...target, ...pose(3), revision: 2, phase: "committed", sample_ts: 1.1 } });
    clock.now = 0.3;
    expect(core.snapshot().target?.position[0]).toBe(3);
  });
  it("clears final prediction when the server explicitly clears its target", () => {
    const { core, grant } = fixture(); grant(); core.release(pose(2));
    expect(core.snapshot().target?.position[0]).toBe(2);
    core.apply(state(2));
    expect(core.snapshot().target).toBeNull();
  });
  it("scopes local pending and granted authority to the requested arm group", () => {
    const { core, messages } = fixture();
    expect(core.begin("manipulation_planning", "arm", pose(1), { group_id: "left" })).toBe(true);
    expect(core.snapshot("manipulation", "left").pending).toBe(true);
    expect(core.snapshot("manipulation", "right").blocked).toBe(true);
    expect(core.snapshot("navigation").blocked).toBe(true);
    expect(core.begin("manipulation_planning", "other", pose(1), { group_id: "right" })).toBe(false);
    const request = messages[0];
    core.apply({ ...state(1), authority: { client_id: "a", source_id: "arm", acquisition_id: request.acquisition_id,
      lease_id: "arm", kind: "manipulation_planning", group_id: "left", held: true, sequence: -1, expires_at: 1 } });
    core.accept({ type: "interaction_result", request_id: request.request_id, epoch: "robot", revision: 1, status: "accepted", code: "acquired", lease_id: "arm" });
    expect(core.snapshot("manipulation", "left").ownsAuthority).toBe(true);
    expect(core.snapshot("manipulation", "right").ownsAuthority).toBe(false);
    expect(core.snapshot("navigation").ownsAuthority).toBe(false);
    core.cancel(["live", "navigation_planning"]);
    expect(core.snapshot("manipulation", "left").ownsAuthority).toBe(true);
  });
  it("rolls a rejected final release back to canonical state after lease expiry", () => {
    const { core, clock, messages, grant } = fixture(); grant();
    const target = { ...pose(1), revision: 1, phase: "committed" as const, sample_ts: 1, sequence: 0 };
    core.release(pose(2)); const final = messages.at(-1);
    core.apply({ ...state(2), target });
    expect(core.snapshot().target?.position[0]).toBe(2);
    core.accept({ type: "interaction_result", request_id: final.request_id, epoch: "robot", revision: 2, status: "stale", code: "lease_retired" });
    clock.now = 0.3;
    expect(core.snapshot().target?.position[0]).toBe(1);
  });
  it("ignores an old final rejection after a newer final prediction", () => {
    const { core, messages, grant } = fixture(); grant();
    core.release(pose(2)); const old = messages.at(-1);
    core.apply({ ...state(2), target: { ...pose(1), revision: 1, phase: "committed", sample_ts: 1, sequence: 0 } });
    core.begin("live", "hand", pose(3)); const acquire = messages.at(-1);
    core.apply({ ...core.raw()!, revision: 3, authority: { client_id: "a", source_id: "hand", acquisition_id: acquire.acquisition_id,
      lease_id: "new", kind: "live", held: true, expires_at: 5, sequence: -1 } });
    core.accept({ type: "interaction_result", request_id: acquire.request_id, epoch: "robot", revision: 3, status: "accepted", code: "acquired", lease_id: "new" });
    core.release(pose(4));
    core.accept({ type: "interaction_result", request_id: old.request_id, epoch: "robot", revision: 2, status: "stale", code: "lease_retired" });
    expect(core.snapshot().target?.position[0]).toBe(4);
  });
});
