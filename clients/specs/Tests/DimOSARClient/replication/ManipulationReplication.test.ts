import { describe, expect, it } from "vitest";
import { CollaborationController } from "../../../Assets/Scripts/DimOSARClient/replication/CollaborationController";
import { ManipulationInteraction } from "../../../Assets/Scripts/DimOSARClient/manipulation/ManipulationInteraction";
import type { InteractionState } from "../../../Assets/Scripts/DimOSARClient/replication/CollaborationTypes";
import type { Outbound } from "../../../Assets/Scripts/DimOSARClient/websocket/protocolTypes";
const pose = (z: number) => ({ position: [0,0,z] as [number,number,number], orientation: [0,0,0,1] as [number,number,number,number] });
function fixture() {
  const sent: any[] = []; let clock = 100, listener: (m: Outbound) => void = () => {};
  const state: InteractionState = { type: "interaction_state", epoch: "robot", revision: 0, mode: "manual", authority: null, target: null, preview: null, active_goal: null };
  const collaboration = new CollaborationController({ ready: () => true, clientId: () => "a", now: () => clock, send: s => sent.push(JSON.parse(s)) }); collaboration.apply(state);
  const view: any = { connection: "ready", capabilities: { manipulation: { available: true } }, manipulation: { groups: [{ id: "arm", following: true, joint_names: ["j"] }], observations: { arm: { joints: { j: 0 }, measured_at: clock, pose: pose(0), gripper: 0 } } } };
  const core = new ManipulationInteraction({ collaboration, view: () => view, sendText: s => sent.push(JSON.parse(s)), subscribeOutbound: cb => { listener = cb; return () => {}; } }, () => clock);
  core.tick();
  const native = () => sent.filter(c => c.type === "manipulation_request");
  function grant() {
    const request = sent.find(c => c.action === "acquire" && c.type === "interaction_request");
    state.revision++;
    state.authority = { client_id: "a", source_id: request.source_id, acquisition_id: request.acquisition_id, lease_id: "lease", kind: request.kind, group_id: request.group_id, held: true, expires_at: clock + 1, sequence: -1 };
    state.target = { ...pose(0), ...state.target, ...(request.position ? { position: request.position, orientation: request.orientation, ...(request.gripper === undefined ? {} : { gripper: request.gripper }) } : {}), domain: "manipulation", group_id: "arm", speed_scale: 0.2, revision: state.target?.revision ?? 1, phase: "draft", sample_ts: clock, sequence: -1 };
    collaboration.apply({ ...state });
    collaboration.accept({ type: "interaction_result", request_id: request.request_id, epoch: "robot", revision: state.revision, status: "accepted", code: "acquired", lease_id: "lease" });
  }
  function ackTarget() {
    const update = sent.filter(c => c.action === "update" && c.type === "interaction_request").at(-1);
    if (!update) throw new Error("Target update not sent");
    state.revision++; state.target = { ...state.target!, position: update.position, orientation: update.orientation, speed_scale: update.speed_scale, ...(update.gripper === undefined ? {} : { gripper: update.gripper }), revision: state.target!.revision + 1, sequence: update.sequence, sample_ts: clock };
    collaboration.apply({ ...state });
  }
  return { core, collaboration, state, sent, native, grant, ackTarget, view, tick: () => { clock += 0.1; view.manipulation.observations.arm.measured_at = clock; collaboration.tick(); core.tick(); }, reply: (command: any, payload: object) => listener({ type: "manipulation_result", request_id: command.request_id, action: command.action, group_id: "arm", status: "completed", ...payload } as Outbound) };
}
describe("manipulation shared authority", () => {
  it("blocks arm actions while the same client owns the robot's navigation lease", () => {
    const f = fixture(); f.collaboration.begin("live", "nav-hand", pose(0)); f.grant();
    expect(f.collaboration.snapshot("navigation").ownsAuthority).toBe(true);
    expect(f.core.snapshot().blocked).toBe(true); expect(f.core.begin()).toBe(false);
    f.core.setGripper(1); f.core.execute(); f.core.end();
    expect(f.native()).toEqual([]);
    expect(f.collaboration.snapshot("navigation").ownsAuthority).toBe(true);
  });
  it("replicates discrete gripper intent before sending a native command", () => {
    const f = fixture(); f.state.revision = 1;
    f.state.target = { ...pose(0.3), domain: "manipulation", group_id: "arm", speed_scale: 0.2, gripper: 0, revision: 1, phase: "draft", sample_ts: 100, sequence: 1 };
    f.collaboration.apply({ ...f.state }); f.tick(); f.core.setGripper(1);
    expect(f.native()).toEqual([]); f.grant(); f.tick();
    expect(f.native()).toEqual([]);
    expect(f.sent.filter(c => c.type === "interaction_request" && c.action === "update").at(-1)).toMatchObject({ gripper: 1, position: [0,0,0.3] });
    f.ackTarget(); f.tick();
    expect(f.native().at(-1)).toMatchObject({ action: "gripper", value: 1, target_revision: 2 });
  });
  it("keeps immediate targets while advisory planning uses acknowledged canonical samples after grant", () => {
    const f = fixture(); f.core.setSelected(true); expect(f.core.begin()).toBe(true); f.core.aim(pose(0.3)); f.tick();
    expect(f.core.target?.position[2]).toBe(0.3); expect(f.native()).toEqual([]);
    f.grant(); f.tick();
    expect(f.native().at(-1)).toMatchObject({ action: "evaluate", epoch: "robot", lease_id: "lease", target_revision: 1, position: [0,0,0] });
    f.ackTarget();
    f.reply(f.native().at(-1), { status: "feasible", joints: { j: 0.1 }, pose: pose(0), target_revision: 1 });
    expect(f.core.plan).toBeNull(); expect(f.core.target?.position[2]).toBe(0.3);
    f.core.execute(); expect(f.native().some(command => command.action === "execute")).toBe(false);
  });
  it("defers native following acquisition until the robot-wide lease is granted", () => {
    const f = fixture(); expect(f.core.begin()).toBe(true); expect(f.native()).toEqual([]);
    f.grant(); f.tick(); expect(f.native().at(-1)).toMatchObject({ action: "acquire", lease_id: "lease" });
  });
  it("cannot resurrect following when the gesture ended before acquisition", () => {
    const f = fixture(); f.core.begin(); f.core.end();
    expect(f.sent.some(c => c.action === "cancel_acquire")).toBe(true); expect(f.native()).toEqual([]);
  });
  it("shares group targets and blocks conflicting clients", () => {
    const f = fixture();
    f.state.authority = { client_id: "other", source_id: "hand", acquisition_id: "other", lease_id: "other", kind: "manipulation_planning", held: true, expires_at: 101, sequence: 1 };
    f.state.target = { ...pose(0.4), domain: "manipulation", group_id: "arm", speed_scale: 0.5, gripper: 1, revision: 1, phase: "draft", sample_ts: 100, sequence: 1 };
    f.collaboration.apply({ ...f.state, revision: 1 }); f.tick();
    expect(f.core.target?.position[2]).toBe(0.4); expect(f.core.speedScale).toBe(0.5);
    expect(f.core.snapshot().blocked).toBe(true); expect(f.core.begin()).toBe(false);
    f.core.execute(); expect(f.native()).toEqual([]);
  });
  it("uses canonical shared poses for Preview while observer rendering still lags", () => {
    const f = fixture(); f.core.setSelected(true);
    f.state.target = { ...pose(0.2), domain: "manipulation", group_id: "arm", speed_scale: 0.2, revision: 1, phase: "draft", sample_ts: 100, sequence: 1 };
    f.collaboration.apply({ ...f.state, revision: 1 }); f.tick();
    f.state.target = { ...f.state.target, ...pose(0.8), revision: 2, sample_ts: 100.2 };
    f.collaboration.apply({ ...f.state, revision: 2 }); f.core.tick();
    expect(f.core.target!.position[2]).toBeLessThan(0.8);
    f.core.requestPlan(); f.core.tick();
    const acquire = f.sent.find(c => c.type === "interaction_request" && c.action === "acquire");
    expect(acquire.position).toBeUndefined();
    f.state.authority = { client_id: "a", source_id: acquire.source_id, acquisition_id: acquire.acquisition_id, lease_id: "lease", kind: "manipulation_planning", group_id: "arm", held: true, expires_at: 102, sequence: -1 };
    f.collaboration.apply({ ...f.state, revision: 3 });
    f.collaboration.accept({ type: "interaction_result", request_id: acquire.request_id, epoch: "robot", revision: 3, status: "accepted", code: "acquired", lease_id: "lease" });
    f.core.tick();
    expect(f.native().at(-1)).toMatchObject({ position: [0,0,0.8], target_revision: 2 });
    expect(f.sent.some(c => c.type === "interaction_request" && c.action === "update")).toBe(false);
  });
});

it("correlates native following feedback independently of robot authority message sequences", () => {
  const f = fixture();
  expect(f.core.begin()).toBe(true);
  f.grant(); f.tick();
  f.reply(f.native().at(-1), { status: "acquired", token: "native-follow" });
  f.core.aim(pose(0.3)); f.tick();
  const blocked = f.native().at(-1);
  expect(blocked.action).toBe("update");
  f.reply(blocked, { status: "infeasible", code: "ik_failed", sequence: blocked.sequence });
  expect(f.core.dragging).toBe(true);
  expect(f.core.target).toEqual(pose(0.3));
  expect(f.core.rejection?.message).toBe("IK failed");
  f.core.aim(pose(0.4)); f.tick();
  const recovered = f.native().at(-1);
  f.reply(recovered, { status: "feasible", sequence: recovered.sequence, joints: { j: 0.25 }, pose: pose(0.4) });
  expect(f.core.rejection).toBeNull();
  expect(f.core.previewJoints).toEqual({ j: 0.25 });
});

it("retains reconnect input while requiring explicit Resume and a fresh lease", () => {
  const f = fixture(); f.core.begin(); f.grant(); f.tick();
  f.reply(f.native().at(-1), { status: "acquired", token: "old-native" });
  f.core.aim(pose(0.3)); f.tick();
  f.view.connection = "failed"; f.collaboration.reset(); f.core.tick();
  expect(f.core.dragging).toBe(true);
  f.sent.length = 0;
  f.state.authority = null;
  f.state.revision++; f.collaboration.apply({ ...f.state });
  f.view.connection = "ready"; f.view.manipulation.stopped = true;
  f.tick(); f.tick();
  expect(f.core.dragging).toBe(true);
  expect(f.sent).toEqual([]);
  f.core.resume();
  expect(f.native()).toEqual([]);
  expect(f.sent.at(-1)).toMatchObject({ type: "interaction_request", action: "acquire" });
  f.grant(); f.tick();
  expect(f.native().at(-1)).toMatchObject({ action: "resume", lease_id: "lease" });
});

it("keeps editing authority when a feedback gap releases only the native token", () => {
  const f = fixture(); f.core.begin(); f.grant(); f.tick();
  f.reply(f.native().at(-1), { status: "acquired", token: "old-native" });
  f.core.aim(pose(0.3)); f.tick();
  f.view.manipulation.available = false; f.tick();
  expect(f.native().at(-1)).toMatchObject({ action: "release", token: "old-native" });
  f.reply(f.native().at(-1), { status: "released" });
  expect(f.collaboration.snapshot("manipulation", "arm").ownsAuthority).toBe(true);
  expect(f.core.dragging).toBe(true);
  f.view.manipulation.available = true; f.tick();
  expect(f.core.dragging).toBe(true);
  expect(f.native().at(-1)).toMatchObject({ action: "acquire", lease_id: "lease" });
});
