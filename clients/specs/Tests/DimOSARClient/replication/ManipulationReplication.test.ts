import { describe, expect, it } from "vitest";
import { CollaborationController } from "../../../Assets/Scripts/DimOSARClient/replication/CollaborationController";
import { ManipulationInteraction } from "../../../Assets/Scripts/DimOSARClient/manipulation/ManipulationInteraction";
import type { InteractionState } from "../../../Assets/Scripts/DimOSARClient/replication/CollaborationTypes";
import type { Outbound } from "../../../Assets/Scripts/DimOSARClient/websocket/protocolTypes";
const pose = (z: number) => ({ position: [0,0,z] as [number,number,number], orientation: [0,0,0,1] as [number,number,number,number] });
function fixture() {
  const sent: any[] = []; let clock = 100, listener: (m: Outbound) => void = () => {};
  const state: InteractionState = { type: "interaction_state", epoch: "robot", revision: 0, mode: "manual", authority: null, target: null, preview: null, active_goal: null };
  const collaboration = new CollaborationController({ ready: () => true, clientId: () => "a", now: () => clock, send: s => sent.push(JSON.parse(s)) }); collaboration.apply({ ...state });
  const view: any = { connection: "ready", capabilities: { manipulation: { available: true } }, manipulation: { groups: [{ id: "arm", following: true, joint_names: ["j"] }], observations: { arm: { joints: { j: 0 }, measured_at: clock, pose: pose(0), gripper: 0 } } } };
  const core = new ManipulationInteraction({ collaboration, view: () => view, sendText: s => sent.push(JSON.parse(s)), subscribeOutbound: cb => { listener = cb; return () => {}; } }, () => clock);
  core.tick();
  const native = () => sent.filter(c => c.type === "manipulation_request");
  function grant() {
    const request = sent.filter(c => c.action === "acquire" && c.type === "interaction_request").at(-1);
    state.revision++;
    state.authority = { client_id: "a", source_id: request.source_id, acquisition_id: request.acquisition_id, lease_id: "lease", kind: request.kind, group_id: request.group_id, held: true, expires_at: clock + 1, sequence: -1 };
    state.target = { ...pose(0), ...state.target, ...(request.position ? { position: request.position, orientation: request.orientation, ...(request.gripper === undefined ? {} : { gripper: request.gripper }) } : {}), domain: "manipulation", group_id: "arm", speed_scale: state.target?.speed_scale ?? request.speed_scale ?? 0.2, revision: state.target?.revision ?? 1, phase: "draft", sample_ts: clock, sequence: -1 };
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
  it("retains idle slider speed until a new shared target arrives", () => {
    const f = fixture();
    f.state.target = { ...pose(0.3), domain: "manipulation", group_id: "arm", speed_scale: 0.2, revision: 1, phase: "draft", sample_ts: 100, sequence: 1 };
    f.state.revision++;
    f.collaboration.apply({ ...f.state }); f.tick();
    expect(f.core.speedScale).toBe(0.2);
    f.core.setSpeedScale(0.8);
    f.tick(); f.tick();
    expect(f.core.speedScale).toBe(0.8);
    f.core.resetJoints();
    expect(f.sent.find(c => c.type === "interaction_request" && c.action === "acquire")).toMatchObject({ speed_scale: 0.8 });
  });
  it("adopts a remote speed change on a new shared target", () => {
    const f = fixture();
    f.state.target = { ...pose(0.3), domain: "manipulation", group_id: "arm", speed_scale: 0.2, revision: 1, phase: "draft", sample_ts: 100, sequence: 1 };
    f.state.revision++;
    f.collaboration.apply({ ...f.state }); f.tick();
    f.core.setSpeedScale(0.8); f.tick();
    f.state.authority = { client_id: "other", source_id: "hand", acquisition_id: "remote", lease_id: "remote", kind: "manipulation_planning", group_id: "arm", held: true, expires_at: 102, sequence: 1 };
    f.state.target = { ...f.state.target, speed_scale: 0.4, revision: 2 };
    f.state.revision++;
    f.collaboration.apply({ ...f.state }); f.tick();
    expect(f.core.speedScale).toBe(0.4);
  });
  it("blocks arm actions while the same client owns the robot's navigation lease", () => {
    const f = fixture(); f.collaboration.begin("live", "nav-hand", pose(0)); f.grant();
    expect(f.collaboration.snapshot("navigation").ownsAuthority).toBe(true);
    expect(f.core.snapshot().blocked).toBe(true); expect(f.core.begin()).toBe(false);
    f.core.setGripper(1); f.core.execute(); f.core.end();
    expect(f.native()).toEqual([]);
    expect(f.collaboration.snapshot("navigation").ownsAuthority).toBe(true);
  });
  it("sends gripper intent after the grant without waiting for a moving target ACK", () => {
    const f = fixture(); f.state.revision = 1;
    f.state.target = { ...pose(0.3), domain: "manipulation", group_id: "arm", speed_scale: 0.2, gripper: 0, revision: 1, phase: "draft", sample_ts: 100, sequence: 1 };
    f.collaboration.apply({ ...f.state }); f.tick(); f.core.setGripper(1);
    expect(f.native()).toEqual([]); f.grant(); f.tick();
    expect(f.native().at(-1)).toMatchObject({ action: "gripper", value: 1 });
  });
  it("keeps immediate targets while advisory planning uses acknowledged canonical samples after grant", () => {
    const f = fixture(); f.core.setSelected(true); expect(f.core.begin()).toBe(true); f.core.aim(pose(0.3)); f.tick();
    expect(f.core.target?.position[2]).toBe(0.3); expect(f.native()).toEqual([]);
    f.grant(); f.tick();
    expect(f.native().at(-1)).toMatchObject({ action: "evaluate", epoch: "robot", lease_id: "lease", target_revision: 1, position: [0,0,0] });
    f.ackTarget();
    f.reply(f.native().at(-1), { status: "feasible", joints: { j: 0.1 }, pose: pose(0), target_revision: 1 });
    expect(f.core.plan).toBeNull(); expect(f.core.target?.position[2]).toBe(0.3);
    f.tick();
    expect(f.native().at(-1)).toMatchObject({ action: "evaluate", position: [0,0,0.3], target_revision: 2 });
    f.reply(f.native().at(-1), { status: "feasible", joints: { j: 0.3 }, pose: pose(0.3) });
    expect(f.core.previewJoints).toEqual({ j: 0.3 });
    f.core.execute(); expect(f.native().some(command => command.action === "execute")).toBe(false);
  });
  it("updates live IK throughout a drag without waiting for canonical target acknowledgements", () => {
    const f = fixture(); f.view.hello = { independent_ik: true };
    f.core.setSelected(true); f.core.begin(); f.core.aim(pose(.3)); f.grant(); f.tick();
    let request = f.native().at(-1);
    expect(request).toMatchObject({ action: "evaluate", position: [0, 0, .3], target_revision: 1 });
    for (let i = 1; i <= 30; i++) {
      f.core.aim(pose(.3 + i / 100));
      f.reply(request, { status: "feasible", joints: { j: i / 100 }, sample_pose: { position: request.position, orientation: request.orientation } });
      expect(f.core.previewJoints).toEqual({ j: i / 100 });
      expect(f.core.dragging).toBe(true);
      f.tick(); request = f.native().at(-1);
      expect(request).toMatchObject({ action: "evaluate", position: [0, 0, .3 + i / 100], target_revision: 1 });
    }
    expect(f.native().filter(c => c.action === "evaluate")).toHaveLength(31);
    expect(f.native().some(c => c.action === "plan" || c.action === "execute")).toBe(false);
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


it("replicates evaluated arm joints only for the observer's canonical group and target revision", () => {
  const f = fixture();
  f.state.target = { ...pose(0.3), domain: "manipulation", group_id: "arm", revision: 1, phase: "draft", sample_ts: 100, sequence: 1 };
  f.collaboration.apply({ ...f.state, revision: 1 });
  f.view.manipulation.evaluation = { group_id: "arm", target_revision: 1, joints: { j: 0.3 }, pose: pose(0.3) };
  f.tick();
  expect(f.core.previewJoints).toEqual({ j: 0.3 });
  expect(f.core.plan).toBeNull();
  f.state.target = { ...f.state.target, ...pose(0.5), revision: 2 };
  f.collaboration.apply({ ...f.state, revision: 2 });
  f.view.manipulation.evaluation = { group_id: "arm", target_revision: 1, joints: { j: 0.9 }, pose: pose(0.9) };
  f.tick();
  expect(f.core.previewJoints).toEqual({ j: 0.3 });
  f.view.manipulation.evaluation = { group_id: "other-arm", target_revision: 2, joints: { j: 0.8 }, pose: pose(0.8) };
  f.tick();
  expect(f.core.previewJoints).toEqual({ j: 0.3 });
  f.view.manipulation.evaluation = { group_id: "arm", target_revision: 2, joints: { j: 0.5 }, pose: pose(0.5) };
  f.tick();
  expect(f.core.previewJoints).toEqual({ j: 0.5 });
  expect(f.native()).toEqual([]);
});

it("reacquires a retired native token only while the shared following lease remains owned", () => {
  const f = fixture();
  f.view.hello = { server_follow_stream: true };
  f.core.begin(); f.grant(); f.tick();
  f.reply(f.native().at(-1), { status: "acquired", token: "expired" });
  f.reply({ request_id: "shared-follow-expired-1", action: "update" }, { status: "rejected", code: "retired", sequence: 1 });
  f.tick();
  expect(f.native().at(-1)).toMatchObject({ action: "acquire" });
  expect(f.native().filter(c => c.action === "acquire")).toHaveLength(2);
  f.reply(f.native().at(-1), { status: "acquired", token: "renewed" });
  f.reply({ request_id: "shared-follow-renewed-1", action: "update" }, { status: "feasible", sequence: 1, pose: pose(.3), joints: { j: .3 } });
  expect(f.core.previewJoints).toEqual({ j: .3 });
});

function sharedFollowingFixture() {
  const f = fixture(); f.view.hello = { independent_ik: true, server_follow_stream: true };
  f.core.begin(); f.grant(); f.tick();
  f.reply(f.native().at(-1), { status: "acquired", token: "native" });
  f.core.aim(pose(.3));
  f.reply({ request_id: "shared-follow-native-1", action: "update" }, {
    status: "feasible", sequence: 1, sample_pose: pose(.3), pose: pose(.3), joints: { j: .3 },
  });
  f.core.aim(pose(100));
  return f;
}

it("keeps a failed shared following grab until manual release and then snaps its shared sphere", () => {
  const f = sharedFollowingFixture();
  f.reply({ request_id: "shared-follow-native-2", action: "update" }, {
    status: "infeasible", sequence: 2, sample_pose: pose(100), code: "ik_failed",
  });
  expect(f.core.dragging).toBe(true); expect(f.core.target).toEqual(pose(100));
  expect(f.core.rejection?.message).toBe("IK failed");
  expect(f.core.previewJoints).toEqual({ j: .3 });
  f.core.end();
  expect(f.core.target).toEqual(pose(.3)); expect(f.core.dragging).toBe(false);
  expect(f.sent.at(-1)).toMatchObject({ type: "interaction_request", action: "release", position: [0, 0, .3] });
  expect(f.native().some(c => c.action === "update")).toBe(false);
});

it("reconciles a delayed shared follow failure after manual release without a motor return command", () => {
  const f = sharedFollowingFixture(); f.core.end();
  f.reply({ request_id: "shared-follow-native-2", action: "update" }, {
    status: "infeasible", sequence: 2, sample_pose: pose(100), code: "ik_failed",
  });
  expect(f.core.target).toEqual(pose(.3)); expect(f.core.dragging).toBe(false);
  expect(f.sent.at(-1)).toMatchObject({ type: "interaction_request", action: "acquire", kind: "manipulation_planning" });
  expect(f.native().some(c => c.action === "update" || c.action === "execute")).toBe(false);
});

it("a new grab cancels a pending released-target correction", () => {
  const f = sharedFollowingFixture(); f.core.end();
  f.reply({ request_id: "shared-follow-native-2", action: "update" }, {
    status: "infeasible", sequence: 2, sample_pose: pose(100), code: "ik_failed",
  });
  expect(f.core.begin()).toBe(true);
  expect(f.sent.slice(-2).map(packet => packet.action)).toEqual(["cancel_acquire", "acquire"]);
  expect(f.sent.at(-1)).toMatchObject({ kind: "manipulation_following" });
});

it("ignores a released follow failure after another client takes ownership", () => {
  const f = sharedFollowingFixture(); f.core.end();
  f.state.authority = { ...f.state.authority!, client_id: "other", lease_id: "successor" };
  f.state.target = { ...f.state.target!, ...pose(.8), revision: 2, sequence: 20 };
  f.state.revision++; f.collaboration.apply({ ...f.state }); f.tick();
  const before = f.sent.length;
  const target = f.core.target;
  f.reply({ request_id: "shared-follow-native-2", action: "update" }, {
    status: "infeasible", sequence: 2, sample_pose: pose(100), code: "ik_failed",
  });
  expect(f.core.target).toEqual(target); expect(f.sent).toHaveLength(before);
  expect(f.core.rejection).toBeNull();
});

it.each(["successor released", "confirmed stop"])("does not restore a released follow target after %s before the next input tick", reason => {
  const f = sharedFollowingFixture(); f.core.end();
  f.state.authority = null;
  f.state.target = reason === "confirmed stop" ? null : { ...f.state.target!, ...pose(.8), revision: 3, sequence: 20 };
  if (reason === "confirmed stop") f.view.manipulation.stopped = true;
  f.state.revision++; f.collaboration.apply({ ...f.state });
  const before = f.sent.length, beforeTarget = f.core.target;
  f.reply({ request_id: "shared-follow-native-2", action: "update" }, {
    status: "infeasible", sequence: 2, sample_pose: pose(100), code: "ik_failed",
  });
  expect(f.sent).toHaveLength(before);
  expect(f.core.target).toEqual(beforeTarget);
});

it("does not restore a discarded draft from repeated server snapshots", () => {
  const f = fixture();
  f.state.target = { ...pose(.3), domain: "manipulation", group_id: "arm", speed_scale: .5, revision: 1, phase: "draft", sample_ts: 100, sequence: 1 };
  f.state.revision++; f.collaboration.apply({ ...f.state }); f.tick();
  expect(f.core.target).not.toBeNull();
  f.core.cancel(); f.tick(); f.tick();
  expect(f.core.target).toBeNull();
  expect(f.native().at(-1)).toMatchObject({ action: "cancel", epoch: "robot", lease_id: "unowned" });
  f.state.target = { ...f.state.target, ...pose(.4), revision: 2 };
  f.state.revision++; f.collaboration.apply({ ...f.state }); f.tick();
  expect(f.core.target?.position).toEqual([0, 0, .4]);
});

it("suspending an observer does not cancel another client's shared draft", () => {
  const f = fixture();
  f.state.target = { ...pose(.3), domain: "manipulation", group_id: "arm", speed_scale: .5, revision: 1, phase: "draft", sample_ts: 100, sequence: 1 };
  f.state.revision++; f.collaboration.apply({ ...f.state }); f.tick();
  f.sent.length = 0;
  f.core.invalidateTarget(); f.tick();
  expect(f.native()).toEqual([]);
  expect(f.sent.filter(c => c.action === "acquire")).toEqual([]);
  expect(f.core.target).not.toBeNull();
});

function ackRelease(f: ReturnType<typeof fixture>) {
  const release = f.sent.filter(c => c.type === "interaction_request" && c.action === "release").at(-1);
  expect(release).toBeDefined();
  f.state.authority = null;
  f.state.target = { ...f.state.target!, position: release.position, orientation: release.orientation,
    speed_scale: release.speed_scale, gripper: release.gripper,
    revision: (f.state.target?.revision ?? 0) + 1, sequence: release.sequence, sample_ts: 100 };
  f.state.revision++; f.collaboration.apply({ ...f.state });
}

it("publishes selected released gripper and speed intent and preserves both through delayed snapshots", () => {
  const f = fixture(); f.core.setSelected(true); f.core.setGripper(1); f.core.setSpeedScale(.8);
  expect(f.native()).toEqual([]);
  f.grant();
  const release = f.sent.filter(c => c.action === "release").at(-1);
  expect(release).toMatchObject({ gripper: 1, speed_scale: .8 });
  for (let i = 0; i < 4; i++) {
    f.state.revision++; f.collaboration.apply({ ...f.state }); f.tick();
    expect(f.core.desiredGripper).toBe(1); expect(f.core.speedScale).toBe(.8);
    expect(f.native().some(c => c.action === "gripper" || c.action === "execute")).toBe(false);
  }
  ackRelease(f); f.tick();
  expect(f.core.desiredGripper).toBe(1); expect(f.core.speedScale).toBe(.8);
  f.core.execute(); f.grant(); f.tick();
  expect(f.native().at(-1)).toMatchObject({ action: "gripper", value: 1 });
});

it("waits for settings settlement then reacquires for an immediate gripper Execute", () => {
  const f = fixture(); f.core.setSelected(true); f.core.setGripper(1); f.core.execute();
  f.grant(); f.tick();
  expect(f.native()).toEqual([]);
  expect(f.core.desiredGripper).toBe(1);
  ackRelease(f); f.tick(); f.grant(); f.tick();
  expect(f.native().at(-1)).toMatchObject({ action: "gripper", value: 1 });
});

it("holds Reset busy through deferred acquisition, clears local intent, and ends without republishing a pose", () => {
  const f = fixture();
  f.state.target = { ...pose(.3), domain: "manipulation", group_id: "arm", speed_scale: .5, gripper: 1, revision: 1, phase: "draft", sample_ts: 100, sequence: 1 };
  f.state.revision++; f.collaboration.apply({ ...f.state }); f.tick();
  f.core.resetJoints();
  expect(f.core.snapshot().resetting).toBe(true); expect(f.core.target).toBeNull();
  const acquisition = f.sent.at(-1); expect(acquisition).toMatchObject({ action: "acquire" });
  expect(acquisition.position).toBeUndefined();
  f.core.setGripper(1); f.core.resetJoints(); expect(f.sent.at(-1)).toEqual(acquisition);
  f.grant(); f.tick();
  const reset = f.native().at(-1); expect(reset).toMatchObject({ action: "reset_joints" });
  expect(f.core.target).toBeNull(); expect(f.core.desiredGripper).toBeNull();
  f.state.target = null; f.state.revision++; f.collaboration.apply({ ...f.state });
  f.reply(reset, { status: "completed" });
  expect(f.sent.at(-1)).toMatchObject({ type: "interaction_request", action: "cancel" });
  expect(f.sent.filter(c => c.action === "release")).toEqual([]);
  f.state.authority = null; f.state.revision++; f.collaboration.apply({ ...f.state }); f.tick();
  expect(f.core.target).toBeNull(); expect(f.core.snapshot().resetting).toBe(false);
  f.core.resetJoints(); expect(f.core.snapshot().resetting).toBe(true);
});

it.each(["epoch", "owner", "episode"])("ignores Reset completion after its %s changes", reason => {
  const f = fixture(); f.core.resetJoints(); f.grant(); f.tick();
  const reset = f.native().at(-1);
  if (reason === "epoch") f.collaboration.apply({ ...f.state, epoch: "new", revision: 0, authority: null });
  if (reason === "owner") f.collaboration.apply({ ...f.state, revision: f.state.revision + 1,
    authority: { ...f.state.authority!, client_id: "other", lease_id: "other" } });
  if (reason === "episode") f.core.discard("superseded");
  const before = f.sent.length;
  f.reply(reset, { status: "completed" });
  expect(f.sent).toHaveLength(before); expect(f.core.target).toBeNull();
});

it("retires a full plan whose editing lease expired before its result arrived", () => {
  const f = fixture(); f.core.setSelected(true);
  f.state.target = { ...pose(.3), domain: "manipulation", group_id: "arm", speed_scale: .5, revision: 1, phase: "draft", sample_ts: 100, sequence: 1 };
  f.state.revision++; f.collaboration.apply({ ...f.state }); f.tick();
  f.core.requestPlan(); f.tick(); f.grant(); f.tick();
  const plan = f.native().at(-1); expect(plan).toMatchObject({ action: "plan" });
  f.state.authority = null; f.state.revision++; f.collaboration.apply({ ...f.state });
  f.reply(plan, { status: "planned", plan_id: "expired", joint_names: ["j"],
    trajectory: [{ time: 0, positions: [0] }, { time: 1, positions: [.3] }], duration: 1 });
  expect(f.core.plan).toBeNull();
  expect(f.core.previewPlan).toBeNull();
  expect(f.native().some(c => c.action === "execute")).toBe(false);
});

it.each([false, true])("Resume retires temporary authority without republishing a target (canonical draft: %s)", hasDraft => {
  const f = fixture(); f.view.manipulation.stopped = true; f.tick();
  if (hasDraft) {
    f.state.target = { ...pose(.3), domain: "manipulation", group_id: "arm", speed_scale: .5,
      gripper: 1, revision: 1, phase: "draft", sample_ts: 100, sequence: 1 };
    f.state.revision++; f.collaboration.apply({ ...f.state });
  }
  f.core.resume(); f.grant();
  if (!hasDraft) {
    f.state.target = null; f.state.revision++; f.collaboration.apply({ ...f.state });
  }
  f.tick(); const resume = f.native().at(-1);
  expect(resume).toMatchObject({ action: "resume" });
  f.view.manipulation.stopped = false;
  f.reply(resume, { status: "resumed" });
  expect(f.sent.at(-1)).toMatchObject({ type: "interaction_request", action: "cancel" });
  expect(f.sent.some(c => c.type === "interaction_request" && c.action === "release")).toBe(false);
  expect(f.core.begin()).toBe(true);
  expect(f.sent.filter(c => c.type === "interaction_request" && c.action === "acquire").at(-1))
    .toMatchObject({ kind: "manipulation_following" });
  f.grant(); f.tick();
  expect(f.native().at(-1)).toMatchObject({ action: "acquire" });
});
