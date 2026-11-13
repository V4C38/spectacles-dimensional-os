import { immediateAuthority } from "../support/ImmediateAuthority";
import { describe, expect, it } from "vitest";
import { ManipulationInteraction } from "../../src/manipulation/ManipulationController";
import {
  decodeManipulation,
  encodeManipulation,
} from "../../src/manipulation/ManipulationProtocol";
import type { Outbound } from "../../src/ClientContracts";

function fixture() {
  const sent: any[] = [];
  const assets = new Map<string, number>();
  let now = 100;
  let listener: (message: Outbound) => void = () => {};
  let followingToken: string | null = null;
  let followSequence = 0;
  let lastFollowAt = -Infinity;
  // Native requests observed at the fixture server, including its shared-target stream.
  function streamFollowing() {
    if (!followingToken || view.connection !== "ready" || view.manipulation.stopped || !interaction.dragging || interaction.snapshot().blocked || !interaction.feedbackFresh || now - lastFollowAt < 1 / 30) return;
    const target = authority.collaboration.snapshot("manipulation", interaction.groupId ?? undefined).rawTarget;
    if (!target) return;
    sent.push({ type: "manipulation_request", request_id: `shared-follow-${followingToken}-${++followSequence}`,
      action: "update", group_id: interaction.groupId, token: followingToken, sequence: followSequence,
      position: target.position, orientation: target.orientation, speed_scale: interaction.speedScale });
    lastFollowAt = now;
  }
  const view: any = {
    connection: "ready",
    hello: { protocol_version: 2, resume_token: "fixture-resume" },
    capabilities: { manipulation: { available: true } },
    manipulation: {
      groups: [{ id: "arm", following: true, joint_names: ["joint"] }],
      observations: {
        arm: {
          joints: { joint: 0 },
          measured_at: 100,
          pose: { position: [0, 0, 0], orientation: [0, 0, 0, 1] },
          gripper: 0,
        },
      },
    },
  };
  const authority = immediateAuthority({ now: () => now, ready: () => view.connection === "ready" });
  const interaction = new ManipulationInteraction(
    {
      view: () => view,
      collaboration: authority.collaboration,
      assetTransferDeadline: (id: string) => assets.get(id) ?? null,
      sendText: (text) => { const request = JSON.parse(text); if (request.action === "release") followingToken = null; sent.push(request); },
      subscribeOutbound: (callback) => {
        listener = callback;
        return () => {};
      },
    } as never,
    () => now,
  );
  interaction.tick();
  function pump() {
    for (let frame = 0; frame < 3; frame++) { authority.tick(); interaction.tick(); }
    streamFollowing();
  }
  function reply(command: any, payload: object) {
    if (command.action === "acquire" && "token" in payload) { followingToken = String(payload.token); followSequence = 0; lastFollowAt = -Infinity; }
    if (command.action === "release" || command.action === "resume") followingToken = null;
    if (command.action === "execute") view.manipulation.plan = null;
    if (payload && "plan_id" in payload) view.manipulation.plan = {
      ...payload, target_revision: command.target_revision, group_id: command.group_id,
    };
    listener({
      type: "manipulation_result",
      request_id: command.request_id,
      action: command.action,
      group_id: command.group_id,
      status: "completed",
      target_revision: command.target_revision,
      ...(command.action === "update" ? { sample_pose: { position: command.position, orientation: command.orientation },
        ...("status" in payload && payload.status === "feasible" ? { pose: { position: command.position, orientation: command.orientation } } : {}) } : {}),
      ...payload,
    } as Outbound);
    pump();
  }
  return {
    interaction,
    sent,
    assets,
    authority,
    reply,
    view,
    tail: (position = pose, joints = { joint: 0.3 }) => {
      view.manipulation.following_tail = { generation: 1, group_id: "arm", status: "finishing", target_revision: 1, ...position, joints };
      authority.state.following_tail = view.manipulation.following_tail;
      authority.publish();
      pump();
    },
    advance: (seconds: number, fresh = true) => {
      now += seconds;
      if (fresh) view.manipulation.observations.arm.measured_at = now;
      pump();
    },
  };
}
const pose = {
  position: [0, 0, 0.3] as [number, number, number],
  orientation: [0, 0, 0, 1] as [number, number, number, number],
};

describe("manipulation intent", () => {
  it("edits selected targets without moving and executes only the returned plan identity", () => {
    const f = fixture();
    f.interaction.setSelected(true);
    expect(f.interaction.begin()).toBe(true);
    f.interaction.aim(pose);
    f.interaction.end();
    f.advance(0.2);
    const plan = f.sent.at(-1);
    expect(plan.action).toBe("plan");
    f.reply(plan, {
      status: "planned",
      plan_id: "reviewed",
      joint_names: ["joint"],
      trajectory: [
        { time: 0, positions: [0] },
        { time: 1, positions: [0.3] },
      ],
      duration: 1,
    });
    f.interaction.end();
    f.interaction.execute(); f.advance(0);
    expect(f.sent.at(-1).plan_id).toBe("reviewed");
    expect(
      f.sent.some((c) => c.action === "acquire" || c.action === "update"),
    ).toBe(false);
  });
  it("releases delayed acquisition after gesture ends rather than starting motion", () => {
    const f = fixture();
    f.interaction.begin();
    const acquire = f.sent.at(-1);
    f.interaction.aim(pose);
    f.interaction.end();
    f.reply(acquire, { status: "acquired", token: "late" });
    expect(f.authority.state.authority).toBeNull();
    expect(f.sent.some(command => command.action === "release" || command.action === "update")).toBe(false);
    f.advance(1);
    expect(f.sent.some((c) => c.action === "update")).toBe(false);
  });
  it("does not resume following after reconnect or selection change", () => {
    const f = fixture();
    f.interaction.begin();
    f.reply(f.sent.at(-1), { status: "acquired", token: "live" });
    f.interaction.aim(pose);
    f.advance(0.1);
    expect(f.sent.at(-1).action).toBe("update");
    f.interaction.setSelected(true);
    expect(f.authority.state.authority).toBeNull();
    const before = f.sent.length;
    f.view.connection = "failed";
    f.advance(1);
    f.view.connection = "ready";
    f.advance(1);
    expect(f.sent.slice(before).some(command => ["acquire", "update", "execute", "gripper", "reset_joints"].includes(command.action))).toBe(false);
  });
  it("retires obsolete planner replies", () => {
    const f = fixture();
    f.interaction.setSelected(true);
    f.interaction.begin();
    f.interaction.aim(pose);
    f.advance(0.2);
    const evaluation = f.sent.at(-1);
    f.interaction.aim({ ...pose, position: [0.1, 0, 0.3] });
    f.reply(evaluation, planned("obsolete"));
    expect(f.interaction.plan).toBeNull();
  });
});

it("validates motion poses before encoding", () => {
  expect(() =>
    encodeManipulation("r", "update", "arm", {
      ...pose,
      token: "t",
      sequence: 1,
      ts: NaN,
    }),
  ).toThrow();
  expect(() =>
    encodeManipulation("r", "evaluate", "arm", {
      ...pose,
      orientation: [0, 0, 0, 0],
    }),
  ).toThrow();
});
it("validates source poses on successful and failed advisory results", () => {
  for (const status of ["feasible", "infeasible"]) {
    const result = { type: "manipulation_result", request_id: "r", action: "evaluate", group_id: "arm", status, sample_pose: pose };
    expect(decodeManipulation(result)).toMatchObject({ sample_pose: pose });
    expect(() => decodeManipulation({ ...result, sample_pose: { ...pose, orientation: [0, 0, 0, 0] } })).toThrow(/sample_pose/);
    expect(() => decodeManipulation({ ...result, sample_pose: { ...pose, position: [NaN, 0, 0] } })).toThrow(/sample_pose/);
  }
});
it("rejects malformed timed trajectories", () => {
  expect(() =>
    decodeManipulation({
      type: "manipulation_result",
      request_id: "r",
      group_id: "arm",
      action: "plan",
      status: "planned",
      plan_id: "p",
      joint_names: ["one"],
      trajectory: [{ time: 1, positions: [0, 1] }],
      duration: 1,
    }),
  ).toThrow();
});

it("Execute obtains a checked plan and executes exactly its ID without a Plan click", () => {
  const f = fixture();
  f.interaction.setSelected(true);
  f.interaction.begin();
  f.interaction.aim(pose);
  f.interaction.end();
  f.interaction.execute(); f.advance(0);
  f.advance(0.1);
  const request = f.sent.at(-1);
  expect(request.action).toBe("plan");
  expect(request.speed_scale).toBe(0.5);
  f.reply(request, {
    status: "planned",
    plan_id: "checked",
    joint_names: ["joint"],
    trajectory: [{ time: 0, positions: [0] }],
    duration: 0,
  });
  expect(f.sent.at(-1).action).toBe("execute");
  expect(f.sent.at(-1).plan_id).toBe("checked");
});

it("deselection and speed changes retire pending execution targets", () => {
  const f = fixture();
  f.interaction.setSelected(true);
  f.interaction.begin();
  f.interaction.aim(pose);
  f.interaction.end();
  f.interaction.execute(); f.advance(0);
  f.advance(0.1);
  const request = f.sent.at(-1);
  f.interaction.setSelected(false);
  f.interaction.setSelected(true);
  f.reply(request, {
    status: "planned",
    plan_id: "late",
    joint_names: ["joint"],
    trajectory: [{ time: 0, positions: [0] }],
    duration: 0,
  });
  // The shared draft survives reselection; obsolete local execute intent does not.
  expect(f.interaction.target).toEqual(pose);
  expect(f.sent.some((c) => c.action === "execute")).toBe(false);
  f.interaction.setSpeedScale(0.4);
  expect(f.interaction.speedScale).toBe(0.4);
});

it("Reset is a distinct joint-zero request using the selected speed", () => {
  const f = fixture();
  f.interaction.setSpeedScale(0.1);
  f.interaction.resetJoints(); f.advance(0);
  expect(f.sent.at(-1)).toMatchObject({
    action: "reset_joints",
    speed_scale: 0.1,
  });
  expect(f.interaction.busy).toBe(true);
});

it("plans on releasing a selected target without executing hardware", () => {
  const f = fixture();
  f.interaction.setSelected(true);
  f.interaction.begin();
  f.interaction.aim(pose);
  f.interaction.end();
  f.advance(0.01);
  expect(f.sent.at(-1)).toMatchObject({
    action: "plan",
    position: pose.position,
  });
  expect(
    f.sent.some((c) => c.action === "execute" || c.action === "acquire"),
  ).toBe(false);
});

function planned(id = "checked") {
  return {
    status: "planned",
    plan_id: id,
    joint_names: ["joint"],
    trajectory: [
      { time: 0, positions: [0] },
      { time: 1, positions: [0.3] },
    ],
    duration: 1,
  };
}

it("coalesces held IK at 20 Hz and checks a full plan only after release", () => {
  const f = fixture(); f.interaction.setSelected(true); f.interaction.begin();
  f.interaction.aim(pose); f.advance(.01);
  const first = f.sent.at(-1); expect(first.action).toBe("evaluate");
  f.interaction.aim({...pose, position:[.02,0,.3]}); f.advance(.02);
  f.interaction.aim({...pose, position:[.04,0,.3]}); f.advance(.02);
  expect(f.sent).toHaveLength(1);
  f.reply(first,{status:"feasible", joints:{joint:.3}});
  f.advance(.011);
  const next=f.sent.at(-1); expect(next).toMatchObject({action:"evaluate",position:[.04,0,.3]});
  expect(f.interaction.dragging).toBe(true);
  expect(f.sent.some(c=>c.action==="plan")).toBe(false);
  f.reply(next,{status:"feasible",joints:{joint:.34}});
  f.interaction.end(); f.advance(.01);
  expect(f.sent.at(-1)).toMatchObject({action:"plan",position:[.04,0,.3]});
  f.reply(f.sent.at(-1),planned("released"));
  expect(f.interaction.plan?.plan_id).toBe("released");
  expect(f.sent.some(c=>c.action==="execute")).toBe(false);
});

it("plans the exact released pose even below the live movement threshold", () => {
  const f = fixture();
  f.interaction.setSelected(true);
  f.interaction.begin();
  f.interaction.aim(pose);
  f.advance(0.01);
  const first = f.sent.at(-1);
  f.interaction.aim({ ...pose, position: [0.002, 0, 0.3] });
  f.interaction.end();
  f.advance(0.01);
  expect(f.sent.filter((c) => c.action === "plan")).toHaveLength(1);
  f.reply(first, {status:"feasible", joints:{joint:.3}});
  f.advance(0.01);
  expect(f.sent.at(-1)).toMatchObject({
    action: "plan",
    position: [0.002, 0, 0.3],
  });
});

it("uses pose hysteresis including orientation and equivalent quaternion signs", () => {
  const f = fixture();
  f.interaction.setSelected(true);
  f.interaction.begin();
  const at = (x: number) => f.interaction.aim({ ...pose, position: [x, 0, 0] });
  at(0.007);
  expect(f.interaction.snapshot().targetOffset).toBe(false);
  at(0.012);
  expect(f.interaction.snapshot().targetOffset).toBe(true);
  at(0.007);
  expect(f.interaction.snapshot().targetOffset).toBe(true);
  at(0.003);
  expect(f.interaction.snapshot().targetOffset).toBe(false);
  const angle = (4 * Math.PI) / 180;
  f.interaction.aim({
    ...pose,
    position: [0, 0, 0],
    orientation: [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)],
  });
  expect(f.interaction.snapshot().targetOffset).toBe(true);
  f.advance(0.01);
  expect(f.sent.at(-1).action).toBe("evaluate");
  f.interaction.aim({
    ...pose,
    position: [0, 0, 0],
    orientation: [0, 0, 0, -1],
  });
  expect(f.interaction.snapshot().targetOffset).toBe(false);
});

it("Stop retires targets and late plans and does not restart after Resume", () => {
  const f = fixture();
  f.interaction.setSelected(true);
  f.interaction.begin();
  f.interaction.aim(pose);
  f.advance(0.01);
  const plan = f.sent.at(-1);
  f.interaction.cancel();
  const stop = f.sent.at(-1);
  expect(stop.action).toBe("cancel");
  expect(f.interaction.target).toBeNull();
  expect(f.interaction.dragging).toBe(false);
  f.reply(stop, { status: "aborted" });
  f.reply(plan, planned("late"));
  f.advance(1);
  expect(f.sent.filter((c) => c.action === "evaluate")).toHaveLength(1);
  expect(f.interaction.plan).toBeNull();
  expect(f.interaction.begin()).toBe(true);
  f.interaction.end();
  f.view.manipulation.stopped = true;
  f.advance(0.01);
  expect(f.interaction.begin()).toBe(false);
  f.interaction.resume();
  f.reply(f.sent.at(-1), { status: "resumed" });
  f.view.manipulation.stopped = false;
  f.advance(0.01);
  expect(f.interaction.target).toBeNull();
});

it("requires Execute for a selected gripper at the measured pose", () => {
  const f = fixture();
  f.interaction.setSelected(true);
  f.interaction.setGripper(1);
  expect(f.sent.some(c => c.action === "gripper")).toBe(false);
  f.interaction.execute(); f.advance(0);
  expect(f.sent.at(-1)).toMatchObject({ action: "gripper", value: 1 });
  f.advance(0.01);
  expect(f.sent.filter((c) => c.action === "plan")).toHaveLength(0);
  expect(f.interaction.snapshot()).toMatchObject({
    targetOffset: false,
    canExecute: false,
    canPreview: false,
  });
});

it("does not retry timed-out execution and blocks plans with stale feedback", () => {
  const f = fixture();
  f.interaction.setSelected(true);
  f.interaction.begin();
  f.interaction.aim(pose);
  f.interaction.end();
  f.advance(0.01);
  f.reply(f.sent.at(-1), planned());
  f.interaction.execute(); f.advance(0);
  f.view.manipulation.execution = "executing";
  f.advance(6);
  expect(f.sent.filter((c) => c.action === "execute")).toHaveLength(1);
  expect(f.interaction.snapshot().canExecute).toBe(false);
  f.view.manipulation.execution = "idle";
  f.interaction.cancel();
  f.reply(f.sent.at(-1), { status: "aborted" });
  f.interaction.begin();
  f.interaction.aim(pose);
  f.advance(2.01, false);
  expect(f.interaction.dragging).toBe(false);
  expect(f.interaction.plan).toBeNull();
});

it("does not plan an idle grab and does not lose acquisition when following speed changes", () => {
  const f = fixture();
  f.interaction.setSelected(true);
  f.interaction.begin();
  f.interaction.aim({ ...pose, position: [0, 0, 0] });
  f.advance(0.01);
  f.interaction.end();
  f.advance(0.01);
  expect(f.sent).toHaveLength(0);
  f.interaction.setSelected(false);
  f.interaction.begin();
  const acquire = f.sent.at(-1);
  f.interaction.setSpeedScale(0.4);
  f.reply(acquire, { status: "acquired", token: "live" });
  f.interaction.aim(pose);
  f.advance(0.01);
  expect(f.sent.at(-1)).toMatchObject({
    action: "update",
    token: "live",
    speed_scale: 0.4,
  });
});

it("requires a new final plan after speed or gripper intent changes during planning", () => {
  const f = fixture();
  f.interaction.setSelected(true);
  f.interaction.begin();
  f.interaction.aim(pose);
  f.interaction.end();
  f.advance(0.01);
  const old = f.sent.at(-1);
  f.interaction.setSpeedScale(0.5);
  f.interaction.setGripper(1);
  f.reply(old, planned("wrong-intent"));
  f.advance(0.01);
  expect(f.interaction.plan).toBeNull();
  expect(f.sent.at(-1)).toMatchObject({
    action: "plan",
    speed_scale: 0.5,
    final_gripper: 1,
  });
  f.reply(f.sent.at(-1), planned("current-intent"));
  f.interaction.execute(); f.advance(0);
  expect(f.sent.at(-1)).toMatchObject({
    action: "execute",
    plan_id: "current-intent",
  });
});

it("retains delayed valid IK through newer edits without making it executable", () => {
  const f=fixture(); f.interaction.setSelected(true); f.interaction.begin();
  f.interaction.aim(pose); f.advance(.01); const first=f.sent.at(-1);
  for(let i=1;i<=10;i++) { f.interaction.aim({...pose,position:[i*.01,0,.3]}); f.advance(.05); }
  expect(f.sent.filter(c=>c.action==="evaluate")).toHaveLength(1);
  f.reply(first,{status:"feasible",joints:{joint:.3}});
  expect(f.interaction.previewJoints).toEqual({joint:.3}); expect(f.interaction.plan).toBeNull();
  f.advance(.01); expect(f.sent.filter(c=>c.action==="evaluate")).toHaveLength(2);
  f.interaction.aim({...pose,position:[.2,0,.3]});
  expect(f.interaction.previewJoints).toEqual({joint:.3});
  expect(f.sent.some(c=>c.action==="plan"||c.action==="execute")).toBe(false);
});

it("keeps an infeasible following target grabbed, recovers, and finishes moving after release", () => {
  const f = fixture();
  f.interaction.begin();
  f.reply(f.sent.at(-1), { status: "acquired", token: "t" });
  f.interaction.aim(pose);
  f.advance(0.04);
  const update = f.sent.at(-1);
  f.reply(update, {
    status: "infeasible",
    code: "joint_limit",
    sequence: update.sequence,
  });
  expect(f.interaction.dragging).toBe(true);
  expect(f.interaction.target).toEqual(pose);
  expect(f.interaction.snapshot().activity).toBe("Joint limit");
  expect(f.interaction.rejection).not.toBeNull();
  f.interaction.aim({ ...pose, position: [0, 0, 0.2] });
  f.advance(0.2);
  const valid = f.sent.at(-1);
  f.reply(valid, {
    status: "feasible",
    sequence: valid.sequence,
    joints: { joint: 0.2 },
  });
  expect(f.interaction.solution).toEqual({ joint: 0.2 });
  expect(f.interaction.rejection).toBeNull();
  f.interaction.end();
  expect(f.interaction.target?.position).toEqual([0, 0, 0.2]);
  f.tail({ ...pose, position: [0,0,0.2] }, { joint: 0.2 });
  expect(f.interaction.snapshot().finishing).toBe(true);
  f.interaction.interrupt();
  expect(f.authority.state.authority).toBeNull();
});

it("Open/Close drafts deferred gripper intent until Execute", () => {
  const f = fixture();
  f.interaction.setSelected(true);
  f.interaction.begin();
  f.interaction.aim(pose);
  f.interaction.end();
  f.interaction.setGripper(1);
  expect(f.sent.some(c => c.action === "gripper")).toBe(false);
  f.advance(0.01);
  const plan = f.sent.at(-1);
  expect(plan).toMatchObject({ action: "plan", final_gripper: 1 });
  f.reply(plan, planned("grasp"));
  expect(f.sent.some(c => c.action === "execute")).toBe(false);
  f.interaction.execute(); f.advance(0);
  expect(f.sent.at(-1)).toMatchObject({ action: "execute", plan_id: "grasp" });
  f.reply(f.sent.at(-1), { status: "accepted", operation_id: "op" });
  const count = f.sent.length;
  f.advance(0.2);
  expect(f.sent).toHaveLength(count);
  expect(f.interaction.snapshot().executing).toBe(true);
  f.view.manipulation.ts = 101;
  f.view.manipulation.execution = "completed";
  f.advance(0.01);
  expect(f.interaction.snapshot().executing).toBe(false);
});

it("returns to Idle at the measured pose even while an older evaluation is pending", () => {
  const f = fixture();
  f.interaction.setSelected(true);
  f.interaction.begin();
  f.interaction.aim(pose);
  f.advance(0.01);
  const plan = f.sent.at(-1);
  f.interaction.aim({ ...pose, position: [0, 0, 0] });
  expect(f.interaction.snapshot().activity).toBe("Idle");
  f.interaction.end();
  f.reply(plan, {status:"feasible", joints:{joint:.3}});
  f.advance(0.01);
  expect(f.interaction.plan).toBeNull();
  expect(f.interaction.snapshot().activity).toBe("Idle");
  expect(f.sent.filter((c) => c.action === "evaluate")).toHaveLength(1);
});

it("ignores late following feedback from an earlier lease", () => {
  const f = fixture();
  f.interaction.begin();
  f.reply(f.sent.at(-1), { status: "acquired", token: "old" });
  f.interaction.aim(pose);
  f.advance(0.04);
  const old = f.sent.at(-1);
  f.interaction.interrupt();
  f.reply(f.sent.at(-1), { status: "released" });
  f.interaction.begin();
  f.reply(f.sent.at(-1), { status: "acquired", token: "new" });
  f.interaction.aim(pose);
  f.advance(0.04);
  f.reply(old, { status: "infeasible", sequence: 999, code: "ik_failed" });
  expect(f.interaction.dragging).toBe(true);
  expect(f.interaction.rejection).toBeNull();
  f.advance(0.04);
  expect(f.sent.at(-1).token).toBe("new");
});

it("restores the measured starting pose when release validation rejects the first draft", () => {
  const f = fixture();
  f.interaction.setSelected(true); f.interaction.begin(); f.interaction.aim(pose);
  f.interaction.end(); f.advance(0.01);
  f.reply(f.sent.at(-1), { status: "rejected", code: "ik_failed", message: "IK failed" });
  expect(f.interaction.target).toEqual(f.view.manipulation.observations.arm.pose);
  expect(f.interaction.snapshot().hasDraft).toBe(false);
  expect(f.sent.some(c => c.action === "execute")).toBe(false);
});

it("keeps an invalid selected grab and restores its last confirmed valid target on release", () => {
  const f = fixture(); f.interaction.setSelected(true); f.interaction.begin();
  f.interaction.aim(pose); f.advance(0.01); f.reply(f.sent.at(-1), {status:"feasible", joints:{joint:.3}});
  const invalid = { ...pose, position: [10, 0, 0] as [number, number, number] };
  f.interaction.aim(invalid); f.advance(0.4);
  f.reply(f.sent.at(-1), { status: "rejected", code: "ik_failed", message: "IK failed" });
  expect(f.interaction.dragging).toBe(true); expect(f.interaction.target).toEqual(invalid);
  f.interaction.end(); expect(f.interaction.target).toEqual(pose);
  f.advance(0.01); expect(f.sent.at(-1)).toMatchObject({ action: "plan", position: pose.position });
});

it("snapshot reads are immutable and do not advance target hysteresis", () => {
  const f = fixture();
  f.interaction.setSelected(true);
  f.interaction.begin();
  f.interaction.aim({ ...pose, position: [0.012, 0, 0] });
  const before = f.sent.length;
  const first = f.interaction.snapshot();
  expect(Object.isFrozen(first)).toBe(true);
  expect(f.interaction.snapshot()).toEqual(first);
  expect(f.sent).toHaveLength(before);
  f.interaction.aim({ ...pose, position: [0.007, 0, 0] });
  expect(f.interaction.snapshot().targetOffset).toBe(true);
});

it("validates explicit shutdown receipts", () => {
  const receipt = {
    type: "manipulation_result",
    request_id: "shutdown",
    group_id: "arm",
    action: "prepare_shutdown",
    status: "rejected",
    quiescent: true,
  };
  expect(decodeManipulation(receipt)).toMatchObject({ quiescent: true });
  expect(() => decodeManipulation({ ...receipt, quiescent: "true" })).toThrow();
});

it("validates explicit visual profiles and gripper joint mappings at the wire boundary", () => {
  const state = {
    type: "manipulation_state",
    available: true,
    ts: 1,
    model: {
      revision: "model",
      root: "base",
      asset_url: "/relocated.glb",
      visual_profile: "openyam",
      links: [
        { name: "base", bounds: null },
        { name: "finger", bounds: null },
      ],
      joints: [
        {
          name: "finger_slide",
          kind: "prismatic",
          parent: "base",
          child: "finger",
          axis: [1, 0, 0],
          origin: { position: [0, 0, 0], orientation: [0, 0, 0, 1] },
          limits: { lower: -0.05, upper: 0 },
          mimic: null,
        },
      ],
      gripper_joints: { finger_slide: { closed: 0, open: -0.05 } },
    },
    groups: [],
    observations: {},
  };
  expect(decodeManipulation(state)).toMatchObject({
    model: { visual_profile: "openyam" },
  });
  expect(() =>
    decodeManipulation({
      ...state,
      model: { ...state.model, visual_profile: "" },
    }),
  ).toThrow();
  expect(() =>
    decodeManipulation({
      ...state,
      model: {
        ...state.model,
        gripper_joints: { finger_slide: { closed: 0, open: NaN } },
      },
    }),
  ).toThrow();
  expect(() =>
    decodeManipulation({
      ...state,
      model: {
        ...state.model,
        gripper_joints: { unknown: { closed: 0, open: 1 } },
      },
    }),
  ).toThrow();
});

it("retains the arm IK preview when only the selected gripper draft changes", () => {
  const f = fixture(); f.interaction.setSelected(true);
  f.interaction.begin(); f.interaction.aim(pose); f.advance(.1);
  f.reply(f.sent.at(-1), { status: "feasible", joints: { joint: .2 }, pose });
  f.interaction.setGripper(1);
  expect(f.interaction.solution).toEqual({ joint: 0.2 });
  expect(f.sent.some(c => c.action === "execute" || c.action === "gripper")).toBe(false);
});


it("snaps an invalid following sphere to the valid pose without commanding a return", () => {
  const f = fixture(); f.interaction.begin(); f.reply(f.sent.at(-1), { status: "acquired", token: "t" });
  f.interaction.aim(pose); f.advance(0.04); const valid = f.sent.at(-1);
  f.reply(valid, { status: "feasible", sequence: valid.sequence, joints: { joint: 0.3 } });
  f.interaction.aim({ ...pose, position: [10, 0, 0] }); f.advance(0.2); const invalid = f.sent.at(-1);
  f.reply(invalid, { status: "infeasible", code: "joint_limit", sequence: invalid.sequence, failed_joints: ["joint"] });
  expect(f.interaction.dragging).toBe(true);
  expect(f.interaction.target?.position).toEqual([10, 0, 0]);
  expect(f.interaction.previewJoints).toEqual({ joint: 0.3 });
  expect(f.interaction.rejection?.failedJoints).toEqual(["joint"]);
  f.interaction.end();
  expect(f.interaction.dragging).toBe(false);
  expect(f.interaction.target?.position).toEqual(pose.position);
  expect(f.interaction.previewJoints).toEqual({ joint: 0.3 });
  expect(f.authority.state.authority).toBeNull();
  const count = f.sent.length;
  f.advance(0.1);
  expect(f.sent).toHaveLength(count);
  expect(f.interaction.snapshot().finishing).toBe(false);
});

it("does not apply late follow errors to newer input and validates a pending released target", () => {
  const f = fixture(); f.interaction.begin(); f.reply(f.sent.at(-1), { status: "acquired", token: "t" });
  f.interaction.aim(pose); f.advance(0.04); const old = f.sent.at(-1);
  const next = { ...pose, position: [0.1, 0, 0.3] as [number, number, number] };
  f.interaction.aim(next); f.advance(0.2); const current = f.sent.at(-1);
  f.reply(old, { status: "infeasible", sequence: old.sequence, code: "ik_failed" });
  expect(f.interaction.rejection).toBeNull();
  f.interaction.end();
  f.reply(current, { status: "infeasible", sequence: current.sequence, code: "ik_failed" });
  expect(f.interaction.target).toEqual(f.view.manipulation.observations.arm.pose);
  expect(f.authority.state.authority).toBeNull();
  expect(f.interaction.snapshot().finishing).toBe(false);
});

it("regrabs a released follow goal with a fresh lease and interrupts on feedback loss", () => {
  const f = fixture(); f.interaction.begin();
  f.reply(f.sent.at(-1), { status: "acquired", token: "first" });
  const firstLease = f.authority.state.authority!.lease_id;
  f.interaction.aim(pose); f.advance(0.04);
  const update = f.sent.at(-1);
  f.reply(update, { status: "feasible", sequence: update.sequence, joints: { joint: 0.3 } });
  f.interaction.end();
  f.tail();
  expect(f.interaction.snapshot().finishing).toBe(true);
  expect(f.interaction.begin()).toBe(true);
  expect(f.authority.state.authority!.lease_id).not.toBe(firstLease);
  expect(f.sent.filter(c => c.action === "acquire")).toHaveLength(2);
  f.reply(f.sent.at(-1), { status: "acquired", token: "second" });
  f.advance(2.01, false);
  expect(f.interaction.dragging).toBe(false);
  expect(f.authority.state.authority).toBeNull();
  f.view.manipulation.following_tail = null;
  f.authority.state.following_tail = null; f.authority.publish(); f.advance(0);
  expect(f.interaction.following).toBe(false);
});

it.each(["ik_failed", "joint_limit", "collision"])("decodes %s wire results without ending either gesture", code => {
  for (const selected of [false, true]) {
    const f = fixture(); f.interaction.setSelected(selected); f.interaction.begin();
    if (!selected) f.reply(f.sent.at(-1), { status: "acquired", token: "wire" });
    f.interaction.aim(pose); f.advance(0.4); const command = f.sent.at(-1);
    const result = decodeManipulation(JSON.parse(JSON.stringify({
      type: "manipulation_result", request_id: command.request_id, action: command.action,
      group_id: command.group_id, status: "infeasible", code, failed_joints: ["joint"],
      ...(selected ? {} : { sequence: command.sequence }),
    }))) as any;
    f.reply(command, result);
    expect(f.interaction.dragging).toBe(true);
    expect(f.interaction.target).toEqual(pose);
    expect(f.interaction.rejection?.failedJoints).toEqual(["joint"]);
    expect(f.sent.some(c => c.action === "release" || c.action === "cancel")).toBe(false);
  }
});


it("keeps a selected grab through an advisory RPC timeout and ignores its late result", () => {
  const f = fixture(); f.interaction.setSelected(true); f.interaction.begin();
  f.interaction.aim(pose); f.advance(0.4); const plan = f.sent.at(-1);
  f.advance(20.1);
  expect(f.interaction.dragging).toBe(true); expect(f.interaction.target).toEqual(pose);
  expect(f.interaction.rejection?.message).toBe("Request timed out");
  f.reply(plan, planned("late")); expect(f.interaction.plan).toBeNull();
  expect(f.sent.some(c => c.action === "cancel")).toBe(false);
  f.interaction.aim({ ...pose, position: [0.1, 0, 0.3] }); f.advance(0.4);
  expect(f.sent.at(-1).action).toBe("evaluate");
});


it("clears a failed plan warning when a smaller target correction succeeds through evaluation", () => {
  const f = fixture(); f.interaction.setSelected(true); f.interaction.begin();
  f.interaction.aim(pose); f.advance(0.4); f.reply(f.sent.at(-1), planned("valid"));
  f.interaction.aim({ ...pose, position: [0, 0, 0.32] }); f.advance(0.4);
  f.reply(f.sent.at(-1), { status: "infeasible", code: "ik_failed" });
  expect(f.interaction.rejection).not.toBeNull();
  f.interaction.aim({ ...pose, position: [0, 0, 0.315] }); f.advance(0.2);
  const evaluation = f.sent.at(-1); expect(evaluation.action).toBe("evaluate");
  f.reply(evaluation, { status: "feasible", joints: { joint: 0.315 } });
  expect(f.interaction.rejection).toBeNull(); expect(f.interaction.dragging).toBe(true);
  expect(f.interaction.previewJoints).toEqual({ joint: 0.315 });
});

it("validates a new released follow goal rather than restoring an older rejected goal", () => {
  const f = fixture(); f.interaction.begin(); f.reply(f.sent.at(-1), { status: "acquired", token: "t" });
  f.interaction.aim(pose); f.advance(0.04); const invalid = f.sent.at(-1);
  f.reply(invalid, { status: "infeasible", code: "ik_failed", sequence: invalid.sequence });
  const corrected = { ...pose, position: [0.1, 0, 0.3] as [number, number, number] };
  f.interaction.aim(corrected); f.advance(0.2); const pending = f.sent.at(-1);
  f.interaction.end(); expect(f.interaction.target).toEqual(corrected);
  f.reply(pending, { status: "feasible", sequence: pending.sequence, joints: { joint: 0.4 } });
  f.tail(corrected, { joint: 0.4 });
  expect(f.interaction.rejection).toBeNull(); expect(f.interaction.target).toEqual(corrected);
  expect(f.interaction.snapshot().finishing).toBe(true);
  const count = f.sent.length; f.advance(0.1); expect(f.sent).toHaveLength(count);
});

it("retains a grab during unavailable feedback, reacquires safely, and expires after one second", () => {
  const f=fixture(); f.interaction.begin();
  f.reply(f.sent.at(-1),{status:"acquired",token:"old"}); f.interaction.aim(pose); f.advance(.04);
  f.view.manipulation.available=false;
  const count=f.sent.length; f.advance(.1,false);
  f.interaction.aim({...pose,position:[.1,0,.3]}); f.advance(.9,false);
  expect(f.interaction.dragging).toBe(true); expect(f.sent).toHaveLength(count + 1);
  expect(f.sent.at(-1).action).toBe("release");
  f.reply(f.sent.at(-1), { status: "released" });
  f.view.manipulation.available=true; f.advance(.01);
  expect(f.sent.at(-1).action).toBe("acquire");
  f.reply(f.sent.at(-1),{status:"acquired",token:"new"}); f.advance(.04);
  expect(f.sent.at(-1)).toMatchObject({action:"update",token:"new",position:[.1,0,.3]});
  f.view.manipulation.available=false; f.advance(.01,false); f.advance(1.001,false);
  expect(f.interaction.dragging).toBe(false);
  expect(f.sent.some(c=>c.action==="cancel")).toBe(true);
});

it("finishes at the validated solver endpoint despite repeated normal release calls", () => {
  const f = fixture();
  f.interaction.begin();
  f.reply(f.sent.at(-1), { status: "acquired", token: "arrival" });
  f.interaction.aim(pose); f.advance(0.04);
  const update = f.sent.at(-1);
  const solved = { ...pose, position: [0, 0, 0.288] };
  f.reply(update, { status: "feasible", sequence: update.sequence, pose: solved, joints: { joint: 0.3 } });
  f.interaction.end();
  f.view.manipulation.observations.arm.pose = solved;
  f.advance(0.1);
  f.interaction.end(); f.advance(0.3);
  f.interaction.end(); f.advance(0.21);
  expect(f.interaction.snapshot().finishing).toBe(false);
  expect(f.authority.state.authority).toBeNull();
  expect(f.interaction.snapshot().activity).toBe("Idle");
});

it("retires an executed selected draft after authoritative completed state", () => {
  const f = fixture();
  f.interaction.setSelected(true); f.interaction.begin();
  f.interaction.aim(pose); f.interaction.end(); f.advance(0.4);
  f.reply(f.sent.at(-1), planned("arrival"));
  f.interaction.end(); f.interaction.execute(); f.advance(0);
  f.reply(f.sent.at(-1), { status: "accepted", operation_id: "execution" });
  f.view.manipulation.ts = 101;
  f.view.manipulation.execution = "completed";
  f.view.manipulation.operation_id = "execution";
  f.advance(0.1);
  expect(f.interaction.target).toBeNull();
  f.view.manipulation.observations.arm.joints.joint = 0.3;
  f.advance(0.1);
  expect(f.interaction.selected).toBe(true);
  expect(f.interaction.target).toBeNull();
  expect(f.interaction.snapshot().activity).toBe("Idle");
});

it("shows recorded observations while refusing all arm control actions", () => {
  const f = fixture();
  f.view.manipulation.read_only = true;
  f.view.hello = { source: {kind: "recording", read_only: true, name: "arm.db"} };
  expect(f.interaction.snapshot().canManipulate).toBe(false);
  expect(f.interaction.snapshot().activity).toBe("Recording");
  f.interaction.begin(); f.interaction.setSelected(true); f.interaction.execute(); f.advance(0); f.interaction.cancel();
  expect(f.sent).toEqual([]);
});

it("records why a held capture ended without treating spatial failure as an ending", () => {
  const f = fixture(); f.interaction.begin();
  f.reply(f.sent.at(-1), {status: "acquired", token: "lease"});
  f.interaction.aim(pose); f.advance(0.04);
  const sample = f.sent.at(-1);
  f.reply(sample, {status: "infeasible", code: "ik_failed", sequence: sample.sequence});
  expect(f.interaction.captureEvents).toEqual([]);
  f.advance(2.01, false);
  expect(f.interaction.captureEvents.at(-1)?.reason).toBe("feedback stale");
});

it("keeps Resume disabled for motor faults and until a protective pause recovers", () => {
  const f = fixture();
  f.advance(0.1);
  Object.assign(f.view.manipulation, {stopped: true, stop_confirmed: true,
    protection: {state: "fault", effective_speed_scale: 0, resumable: false}});
  expect(f.interaction.snapshot().canResume).toBe(false);
  Object.assign(f.view.manipulation, {protection: {state: "paused", effective_speed_scale: 0, resumable: false}});
  expect(f.interaction.snapshot().canResume).toBe(false);
  Object.assign(f.view.manipulation, {protection: {state: "paused", effective_speed_scale: 0, resumable: true}});
  expect(f.interaction.snapshot().canResume).toBe(true);
});


it("uses fresh correlated following arrival without releasing a held grab", () => {
  const f = fixture();
  f.interaction.begin();
  f.reply(f.sent.at(-1), { status: "acquired", token: "t" });
  f.interaction.aim(pose);
  f.advance(0.04);
  f.view.manipulation.following = true;
  f.view.manipulation.following_at_target = true;
  f.view.manipulation.following_goal = pose;
  expect(f.interaction.snapshot().activity).toBe("Idle");
  expect(f.interaction.dragging).toBe(true);
  expect(f.sent.some(c => c.action === "release")).toBe(false);
  f.view.manipulation.following_goal = { ...pose, position: [1, 0, 0] };
  expect(f.interaction.snapshot().activity).toBe("Moving");
  f.view.manipulation.following_goal = pose;
  f.advance(1, false);
  expect(f.interaction.snapshot().activity).not.toBe("Idle");
});

it("retains a failed execution target and replans rather than reusing its cancelled plan", () => {
  const f = fixture();
  f.interaction.setSelected(true); f.interaction.begin();
  f.interaction.aim(pose); f.interaction.end(); f.advance(.4);
  f.reply(f.sent.at(-1), planned("retry"));
  f.interaction.end(); f.interaction.execute(); f.advance(0);
  f.reply(f.sent.at(-1), {status:"accepted",operation_id:"failed-execution"});
  f.view.manipulation.ts = 101;
  f.view.manipulation.execution = "aborted";
  f.view.manipulation.operation_id = "failed-execution";
  f.view.manipulation.message = "Target not reached";
  f.advance(.1);
  expect(f.interaction.target).toEqual(pose);
  expect(f.interaction.plan).toBeNull();
  expect(f.interaction.snapshot().executing).toBe(false);
  const before = f.sent.length;
  f.interaction.execute(); f.advance(0); f.advance(.4);
  expect(f.sent.slice(before).some(c=>c.action === "execute")).toBe(false);
  expect(f.sent.slice(before).some(c=>c.action === "plan")).toBe(true);
});

it.each(["planning", "following"])("preserves %s capture and last valid model for exactly one second of socket loss", mode => {
  const f=fixture(); f.interaction.setSelected(mode === "planning"); f.interaction.begin();
  if(mode === "following") f.reply(f.sent.at(-1),{status:"acquired",token:"old"});
  f.interaction.aim(pose); f.advance(.05); const old=f.sent.at(-1);
  f.reply(old,{status:"feasible",joints:{joint:.3},...(mode === "following" ? {sequence:old.sequence}: {})});
  const valid=f.interaction.previewJoints;
  f.view.connection="disconnected"; f.advance(0,false);
  const count=f.sent.length;
  f.interaction.aim({...pose,position:[.2,0,.3]}); f.advance(.999,false);
  expect(f.interaction.dragging).toBe(true);
  expect(f.interaction.previewJoints).toEqual(valid);
  expect(f.interaction.target?.position).toEqual([.2,0,.3]);
  expect(f.sent).toHaveLength(count);
  f.advance(.001,false); expect(f.interaction.dragging).toBe(true);
  f.advance(.001,false); expect(f.interaction.dragging).toBe(false);
  expect(f.interaction.target).toBeNull(); expect(f.interaction.previewJoints).toBeNull();
});

it("keeps capture after reconnect while requiring explicit motor Resume",()=> {
  const f=fixture(); f.interaction.begin();
  f.reply(f.sent.at(-1),{status:"acquired",token:"old"}); f.interaction.aim(pose); f.advance(.04);
  f.view.connection="disconnected"; f.advance(.1,false);
  f.view.connection="ready"; f.view.manipulation.stopped=true; f.view.manipulation.stop_confirmed=true;
  const count=f.sent.length; f.advance(.5);
  expect(f.interaction.dragging).toBe(true); expect(f.sent).toHaveLength(count);
  expect(f.interaction.snapshot().canResume).toBe(true);
  f.interaction.resume(); expect(f.sent.at(-1).action).toBe("resume");
  f.reply(f.sent.at(-1),{status:"resumed"}); f.view.manipulation.stopped=false; f.advance(.01);
  expect(f.sent.at(-1).action).toBe("acquire");
});

it("rejects old advisory replies during loss and preserves immediate Stop",()=> {
  const f=fixture(); f.interaction.setSelected(true); f.interaction.begin(); f.interaction.aim(pose);
  f.advance(.05); const old=f.sent.at(-1);
  f.view.manipulation.available=false; f.advance(.1,false);
  f.reply(old,{status:"feasible",joints:{joint:99}});
  expect(f.interaction.previewJoints).not.toEqual({joint:99});
  f.interaction.cancel(); expect(f.interaction.dragging).toBe(false); expect(f.interaction.target).toBeNull();
});

it("does not leave stale execution or gripper drafts across 100 selected operations",()=> {
  const f=fixture(); f.interaction.setSelected(true);
  for(let i=0;i<100;i++) {
    expect(f.interaction.begin()).toBe(true);
    f.interaction.aim({...pose,position:[.01*i,0,.3]}); f.interaction.setGripper(i%2);
    f.interaction.end(); f.advance(.05); const plan=f.sent.at(-1);
    expect(plan).toMatchObject({action:"plan",final_gripper:i%2});
    f.reply(plan,planned(`p${i}`)); f.interaction.execute(); f.advance(0); const execution=f.sent.at(-1);
    expect(execution).toMatchObject({action:"execute",plan_id:`p${i}`});
    f.reply(execution,{status:"accepted",operation_id:`op${i}`});
    Object.assign(f.view.manipulation,{ts:1000+i,execution:"completed",execution_phase:"gripper",operation_id:`op${i}`});
    Object.assign(f.view.manipulation.observations.arm,{gripper_target:i%2,gripper:i%2===0?.35:1});
    f.advance(.05);
    expect(f.interaction.target).toBeNull(); expect(f.interaction.desiredGripper).toBeNull();
    expect(f.interaction.snapshot().executing).toBe(false);
  }
  expect(f.sent.filter(c=>c.action==="execute")).toHaveLength(100);
  expect(f.sent.filter(c=>c.action==="gripper")).toHaveLength(0);
});

it("validates optional accepted gripper targets, velocities, and execution phases",()=> {
  const message:any={type:"manipulation_state",available:true,ts:1,
    model:{ gripper_joints: {}, revision:"v",root:"base",asset_url:null,links:[{name:"base",bounds:null}],joints:[]},
    groups:[],observations:{arm:{joints:{},measured_at:1,gripper:.35,gripper_target:0,joint_velocities:{j:.2}}},
    execution_phase:"gripper"};
  expect(decodeManipulation(message)).toMatchObject({execution_phase:"gripper"});
  for(const value of [-.1,1.1,NaN]) expect(()=>decodeManipulation({...message,observations:{arm:{gripper_target:value}}})).toThrow();
  expect(()=>decodeManipulation({...message,observations:{arm:{joint_velocities:{j:Infinity}}}})).toThrow();
  expect(()=>decodeManipulation({...message,execution_phase:"done"})).toThrow();
});

it("waits for release acknowledgement before recovering a short feedback gap", () => {
  const f = fixture(); f.interaction.begin();
  f.reply(f.sent.at(-1), { status: "acquired", token: "old" });
  f.interaction.aim(pose); f.advance(.04);
  f.view.manipulation.available = false; f.advance(.05, false);
  const release = f.sent.at(-1);
  expect(release).toMatchObject({ action: "release", token: "old" });
  f.view.manipulation.available = true; f.advance(.05);
  expect(f.sent.at(-1)).toBe(release);
  const count = f.sent.length;
  for (let i = 0; i < 100; i++) f.interaction.snapshot();
  expect(f.sent).toHaveLength(count);
  f.reply(release, { status: "released" }); f.advance(.05);
  expect(f.sent.at(-1).action).toBe("acquire");

});

it("keeps a checked-plan request alive while its bounded trajectory asset is still transferring", () => {
  const f = fixture(); f.interaction.setSelected(true); f.interaction.begin();
  f.interaction.aim(pose); f.interaction.end(); f.advance(0.4); const request = f.sent.at(-1);
  f.assets.set(request.request_id, 140);
  f.advance(20.1);
  expect(f.interaction.rejection).toBeNull();
  expect(f.interaction.dragging).toBe(false);
  f.reply(request, planned("slow-trajectory"));
  expect(f.interaction.plan?.plan_id).toBe("slow-trajectory");
});

it("bounds a stalled checked-plan asset and ignores its completion after the asset deadline", () => {
  const f = fixture(); f.interaction.setSelected(true); f.interaction.begin();
  f.interaction.aim(pose); f.interaction.end(); f.advance(0.4); const request = f.sent.at(-1);
  f.assets.set(request.request_id, 140); f.advance(40);
  expect(f.interaction.rejection?.message).toBe("Request timed out");
  f.reply(request, planned("expired-trajectory"));
  expect(f.interaction.plan).toBeNull();
});

it("keeps advisory IK progressing after held speed edits without queueing full plans", () => {
  const f = fixture(); f.interaction.setSelected(true); f.interaction.begin();
  f.interaction.aim(pose); f.advance(.1);
  const first = f.sent.at(-1);
  f.interaction.setSpeedScale(.8);
  f.reply(first, { status: "feasible", joints: { joint: .3 } });
  f.advance(.1);
  expect(f.sent.at(-1)).toMatchObject({ action: "evaluate" });
  expect(f.sent.some(c => c.action === "plan")).toBe(false);
  expect(f.interaction.dragging).toBe(true);
});

it("supersedes queued release planning on immediate regrab and checks a repeated target", () => {
  const f = fixture(); f.interaction.setSelected(true); f.interaction.begin();
  f.interaction.aim(pose); f.interaction.end();
  expect(f.interaction.begin()).toBe(true);
  f.advance(.1);
  expect(f.sent.at(-1)).toMatchObject({ action: "evaluate", position: pose.position });
  expect(f.sent.some(c => c.action === "plan")).toBe(false);
});

it("runs advisory IK while an obsolete full plan remains in flight and retires its late reply", () => {
  const f = fixture(); f.interaction.setSelected(true); f.interaction.begin();
  f.interaction.aim(pose); f.interaction.end(); f.advance(.1);
  const oldPlan = f.sent.at(-1); expect(oldPlan.action).toBe("plan");
  expect(f.interaction.begin()).toBe(true);
  f.interaction.aim({ ...pose, position: [.2, 0, .3] }); f.advance(.1);
  const advisory = f.sent.at(-1); expect(advisory.action).toBe("evaluate");
  f.reply(advisory, { status: "feasible", joints: { joint: .5 } });
  f.reply(oldPlan, planned("obsolete"));
  expect(f.interaction.plan).toBeNull();
  expect(f.interaction.previewJoints).toEqual({ joint: .5 });
  f.interaction.aim({ ...pose, position: [.25, 0, .3] }); f.advance(.1);
  expect(f.sent.at(-1)).toMatchObject({ action: "evaluate", position: [.25, 0, .3] });
  expect(f.sent.some(c => c.action === "execute")).toBe(false);
});

it("reports bounded advisory durations, failures, pending age and timeouts", () => {
  const f = fixture(); f.interaction.setSelected(true); f.interaction.begin();
  f.interaction.aim(pose); f.advance(.1); const first = f.sent.at(-1);
  f.advance(.2); expect(f.interaction.diagnostics().pendingAgeS).toBeCloseTo(.2);
  f.reply(first, { status: "infeasible", code: "ik_failed" });
  f.interaction.aim({ ...pose, position: [.2, 0, .3] }); f.advance(.1);
  f.advance(5.1);
  expect(f.interaction.diagnostics()).toMatchObject({ requests: 2, completions: 1, failures: 1, timeouts: 1, pendingAgeS: 0 });
  expect(f.interaction.diagnostics().maximumDurationS).toBeCloseTo(5.1);
  expect(f.interaction.dragging).toBe(true);
});

it("retains the latest release demand while an obsolete plan retires", () => {
  const f = fixture(); f.interaction.setSelected(true); f.interaction.begin();
  f.interaction.aim(pose); f.interaction.end(); f.advance(.1); const oldPlan = f.sent.at(-1);
  f.interaction.begin(); f.interaction.aim({ ...pose, position: [.2, 0, .3] });
  f.interaction.end(); f.advance(.1);
  expect(f.sent.filter(c => c.action === "plan")).toHaveLength(1);
  f.reply(oldPlan, planned("obsolete")); f.advance(.1);
  expect(f.sent.at(-1)).toMatchObject({ action: "plan", position: [.2, 0, .3] });
});


it("requires shared authority and never sends a client-native follow stream", () => {
  const f = fixture();
  f.interaction.begin();
  expect(f.authority.commands.some(command => command.action === "acquire")).toBe(true);
  f.reply(f.sent.at(-1), { status: "acquired", token: "following" });
  f.interaction.aim(pose); f.advance(.1);
  expect(f.sent.filter(command => command.action === "update").every(command => command.request_id.startsWith("shared-follow-"))).toBe(true);
});

it("fails before subscribing when the required authority port is absent", () => {
  let subscribed = false;
  expect(() => new ManipulationInteraction({
    view: () => ({}), sendText: () => {},
    subscribeOutbound: () => { subscribed = true; return () => {}; },
  } as never, () => 0)).toThrow("Manipulation requires interaction authority");
  expect(subscribed).toBe(false);
});

it("retains recorded EOF observations without refreshing measurement age or acquiring control", () => {
  const f = fixture();
  f.view.manipulation.read_only = true;
  f.view.hello = { source: { kind: "recording", read_only: true, name: "arm.db" } };
  const observed = f.view.manipulation.observations.arm;
  f.advance(10, false);
  expect(f.interaction.available).toBe(true);
  expect(f.interaction.feedbackFresh).toBe(false);
  expect(f.view.manipulation.observations.arm).toBe(observed);
  expect(observed.measured_at).toBe(100);
  expect(f.interaction.snapshot()).toMatchObject({ activity: "Recording", fresh: false,
    canExecute: false, canManipulate: false, canReset: false, canResume: false });
  expect(f.interaction.begin()).toBe(false);
  f.interaction.setSpeedScale(.7); f.interaction.setGripper(1); f.interaction.execute();
  expect(f.sent).toEqual([]); expect(f.authority.commands).toEqual([]);
});

it("retires rejection and old replies on reset before a fresh grab of the same pose", () => {
  const f = fixture(); f.interaction.setSelected(true); expect(f.interaction.begin()).toBe(true);
  f.interaction.aim(pose); f.advance(.1);
  const old = f.sent.findLast(command => command.action === "evaluate");
  f.reply(old, { status: "infeasible", code: "ik_failed" });
  expect(f.interaction.rejection).not.toBeNull();
  f.interaction.reset(); f.advance(0);
  expect(f.interaction.begin()).toBe(true); f.interaction.aim(pose);
  expect(f.interaction.target).toEqual(pose); expect(f.interaction.rejection).toBeNull();
  f.reply(old, { status: "infeasible", code: "ik_failed" });
  expect(f.interaction.target).toEqual(pose); expect(f.interaction.rejection).toBeNull();
});

it("keeps a checked plan independent of an overlapping advisory request", () => {
  const f = fixture();
  f.interaction.setSelected(true);
  expect(f.interaction.begin()).toBe(true);
  f.interaction.aim(pose);
  f.advance(.01);
  const advisory = f.sent.find(request => request.action === "evaluate");
  expect(advisory).toBeDefined();
  f.interaction.end();
  f.advance(.01);
  const plan = f.sent.find(request => request.action === "plan");
  expect(plan).toBeDefined();
  f.reply(plan, planned("independent-artifact"));
  expect(f.interaction.plan?.plan_id).toBe("independent-artifact");
  expect(f.interaction.snapshot().planning).toBe(true);
  f.reply(advisory, { status: "feasible", joints: { joint: .3 } });
  expect(f.interaction.plan?.plan_id).toBe("independent-artifact");
  expect(f.interaction.snapshot().planning).toBe(false);
  f.interaction.execute();
  f.advance(0);
  expect(f.sent.at(-1)).toMatchObject({ action: "execute", plan_id: "independent-artifact" });
});
