import { describe, expect, it } from "vitest";
import { ManipulationInteraction } from "../../../Assets/Scripts/DimOSARClient/manipulation/ManipulationInteraction";
import {
  decodeManipulation,
  encodeManipulation,
} from "../../../Assets/Scripts/DimOSARClient/manipulation/ManipulationProtocol";
import type { Outbound } from "../../../Assets/Scripts/DimOSARClient/websocket/protocolTypes";

function fixture() {
  const sent: any[] = [];
  const assets = new Map<string, number>();
  let now = 100;
  let listener: (message: Outbound) => void = () => {};
  const view: any = {
    connection: "ready",
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
  const interaction = new ManipulationInteraction(
    {
      view: () => view,
      assetTransferDeadline: (id: string) => assets.get(id) ?? null,
      sendText: (text) => sent.push(JSON.parse(text)),
      subscribeOutbound: (callback) => {
        listener = callback;
        return () => {};
      },
    } as never,
    () => now,
  );
  interaction.tick();
  function reply(command: any, payload: object) {
    listener({
      type: "manipulation_result",
      request_id: command.request_id,
      action: command.action,
      group_id: command.group_id,
      status: "completed",
      ...payload,
    } as Outbound);
  }
  return {
    interaction,
    sent,
    assets,
    reply,
    view,
    tail: (position = pose, joints = { joint: 0.3 }) => {
      view.manipulation.following_tail = { generation: 1, group_id: "arm", status: "finishing", target_revision: 1, ...position, joints };
      interaction.tick();
    },
    advance: (seconds: number, fresh = true) => {
      now += seconds;
      if (fresh) view.manipulation.observations.arm.measured_at = now;
      interaction.tick();
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
    f.interaction.execute();
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
    expect(f.sent.at(-1)).toMatchObject({ action: "release", token: "late" });
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
    expect(f.sent.at(-1).action).toBe("release");
    const before = f.sent.length;
    f.view.connection = "failed";
    f.advance(1);
    f.view.connection = "ready";
    f.advance(1);
    expect(f.sent.length).toBe(before);
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
  f.interaction.execute();
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
  f.interaction.execute();
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
  expect(f.interaction.target).toBeNull();
  expect(f.sent.some((c) => c.action === "execute")).toBe(false);
  f.interaction.setSpeedScale(0.4);
  expect(f.interaction.speedScale).toBe(0.4);
});

it("Reset is a distinct joint-zero request using the selected speed", () => {
  const f = fixture();
  f.interaction.setSpeedScale(0.1);
  f.interaction.resetJoints();
  expect(f.sent.at(-1)).toMatchObject({
    action: "reset_joints",
    speed_scale: 0.1,
  });
  expect(f.interaction.busy).toBe(true);
});

it("selected gripper intent is attached to the plan without moving the gripper", () => {
  const f = fixture();
  f.interaction.setSelected(true);
  f.interaction.begin();
  f.interaction.aim(pose);
  f.interaction.end();
  f.interaction.setGripper(1);
  expect(f.sent.some((c) => c.action === "gripper")).toBe(false);
  f.interaction.execute();
  f.advance(0.1);
  expect(f.sent.at(-1)).toMatchObject({ action: "plan", final_gripper: 1 });
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

it("coalesces live plans at 350 ms and keeps dragging while a planner is pending", () => {
  const f = fixture();
  f.interaction.setSelected(true);
  f.interaction.begin();
  f.interaction.aim(pose);
  f.advance(0.01);
  const first = f.sent.at(-1);
  expect(first.action).toBe("plan");
  f.interaction.aim({ ...pose, position: [0.02, 0, 0.3] });
  f.advance(0.1);
  expect(f.sent.filter((c) => c.action === "plan")).toHaveLength(1);
  f.interaction.aim({ ...pose, position: [0.04, 0, 0.3] });
  f.reply(first, planned("old"));
  expect(f.interaction.plan).toBeNull();
  f.advance(0.1);
  expect(f.sent.filter((c) => c.action === "plan")).toHaveLength(1);
  f.advance(0.16);
  const latest = f.sent.at(-1);
  expect(latest).toMatchObject({ action: "plan", position: [0.04, 0, 0.3] });
  expect(f.interaction.dragging).toBe(true);
  f.reply(latest, planned());
  f.interaction.end();
  f.advance(0.01);
  expect(f.sent.filter((c) => c.action === "plan")).toHaveLength(2);
  expect(f.sent.some((c) => c.action === "execute")).toBe(false);
  expect(f.interaction.begin()).toBe(true);
  f.interaction.aim({ ...pose, position: [0.05, 0, 0.3] });
  expect(f.interaction.plan).toBeNull();
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
  f.reply(first, planned("old"));
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
  expect(f.sent.at(-1).action).toBe("plan");
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
  expect(f.sent.filter((c) => c.action === "plan")).toHaveLength(1);
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
  f.interaction.execute();
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
  f.interaction.execute();
  f.view.manipulation.execution = "executing";
  f.advance(6);
  expect(f.sent.filter((c) => c.action === "execute")).toHaveLength(1);
  expect(f.interaction.snapshot().canExecute).toBe(false);
  f.view.manipulation.execution = "idle";
  f.interaction.cancel();
  f.reply(f.sent.at(-1), { status: "aborted" });
  f.interaction.begin();
  f.interaction.aim(pose);
  f.advance(1, false);
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
  f.interaction.execute();
  expect(f.sent.at(-1)).toMatchObject({
    action: "execute",
    plan_id: "current-intent",
  });
});

it("retains a delayed valid preview through more edits without making it executable", () => {
  const f = fixture();
  f.interaction.setSelected(true);
  f.interaction.begin();
  f.interaction.aim(pose);
  f.advance(0.01);
  const first = f.sent.at(-1);
  for (let i = 1; i <= 10; i++) {
    f.interaction.aim({ ...pose, position: [i * 0.01, 0, 0.3] });
    f.advance(0.05);
  }
  expect(f.sent.filter((c) => c.action === "plan")).toHaveLength(1);
  f.reply(first, planned("last-valid"));
  expect(f.interaction.previewPlan?.plan_id).toBe("last-valid");
  expect(f.interaction.plan).toBeNull();
  f.advance(0.01);
  expect(f.sent.filter((c) => c.action === "plan")).toHaveLength(2);
  f.interaction.aim({ ...pose, position: [0.2, 0, 0.3] });
  expect(f.interaction.previewPlan?.plan_id).toBe("last-valid");
  expect(f.interaction.snapshot().activity).toBe("Planning");
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
  expect(f.sent.at(-1).action).toBe("release");
});

it("Open/Close drafts deferred gripper intent until Execute", () => {
  const f = fixture();
  f.interaction.setSelected(true);
  f.interaction.begin();
  f.interaction.aim(pose);
  f.interaction.end();
  f.interaction.setGripper(1);
  f.advance(0.01);
  const plan = f.sent.at(-1);
  expect(plan).toMatchObject({ action: "plan", final_gripper: 1 });
  f.reply(plan, planned("grasp"));
  expect(f.sent.some(c => c.action === "execute")).toBe(false);
  f.interaction.execute();
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

it("returns to Idle at the measured pose even while an older plan is pending", () => {
  const f = fixture();
  f.interaction.setSelected(true);
  f.interaction.begin();
  f.interaction.aim(pose);
  f.advance(0.01);
  const plan = f.sent.at(-1);
  f.interaction.aim({ ...pose, position: [0, 0, 0] });
  expect(f.interaction.snapshot().activity).toBe("Idle");
  f.interaction.end();
  f.reply(plan, planned("old-offset"));
  f.advance(0.01);
  expect(f.interaction.plan).toBeNull();
  expect(f.interaction.previewPlan).toBeNull();
  expect(f.interaction.snapshot().activity).toBe("Idle");
  expect(f.sent.filter((c) => c.action === "plan")).toHaveLength(1);
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
  f.interaction.aim(pose); f.advance(0.01); f.reply(f.sent.at(-1), planned("valid"));
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
  f.interaction.solution = { joint: 0.2 };
  f.interaction.setGripper(1);
  expect(f.interaction.solution).toEqual({ joint: 0.2 });
  expect(f.sent.some(c => c.action === "execute" || c.action === "gripper")).toBe(false);
});


it("buffers validated joints and target together and restores them on invalid follow release", () => {
  const f = fixture(); f.interaction.begin(); f.reply(f.sent.at(-1), { status: "acquired", token: "t" });
  f.interaction.aim(pose); f.advance(0.04); const valid = f.sent.at(-1);
  f.reply(valid, { status: "feasible", sequence: valid.sequence, joints: { joint: 0.3 } });
  f.interaction.aim({ ...pose, position: [10, 0, 0] }); f.advance(0.2); const invalid = f.sent.at(-1);
  f.reply(invalid, { status: "infeasible", code: "joint_limit", sequence: invalid.sequence, failed_joints: ["joint"] });
  expect(f.interaction.dragging).toBe(true);
  expect(f.interaction.target?.position).toEqual([10, 0, 0]);
  expect(f.interaction.previewJoints).toEqual({ joint: 0.3 });
  expect(f.interaction.rejection?.failedJoints).toEqual(["joint"]);
  f.interaction.end(); f.tail();
  expect(f.interaction.dragging).toBe(false);
  expect(f.interaction.target).toEqual(pose);
  expect(f.interaction.previewJoints).toEqual({ joint: 0.3 });
  const count = f.sent.length; f.advance(0.5);
  expect(f.sent).toHaveLength(count); // The server owns continuation, not client updates.
  f.view.manipulation.following_tail = null; f.advance(0.1);
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
  f.tail(f.view.manipulation.observations.arm.pose, { joint: 0 });
  expect(f.interaction.target).toEqual(f.view.manipulation.observations.arm.pose);
  expect(f.interaction.snapshot().finishing).toBe(true);
});

it("regrabs server-owned finishing through a new native acquisition", () => {
  const f = fixture(); f.interaction.begin(); f.reply(f.sent.at(-1), { status: "acquired", token: "t" });
  f.interaction.aim(pose); f.advance(0.04); const update = f.sent.at(-1);
  f.reply(update, { status: "feasible", sequence: update.sequence, joints: { joint: 0.3 } });
  f.interaction.end(); f.tail();
  const count = f.sent.length; f.advance(1); expect(f.sent).toHaveLength(count);
  expect(f.interaction.begin()).toBe(true);
  expect(f.sent.filter(c => c.action === "acquire")).toHaveLength(2);
  f.view.manipulation.following_tail = null;
  f.interaction.interrupt(); expect(f.interaction.dragging).toBe(false);
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
  expect(f.sent.at(-1).action).toBe("plan");
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

it("pauses commands across an unavailable poll without dropping a fresh grab", () => {
  const f = fixture();
  f.interaction.begin();
  f.reply(f.sent.at(-1), { status: "acquired", token: "retained" });
  f.interaction.aim(pose);
  f.view.manipulation.available = false;
  const count = f.sent.length;
  f.advance(0.1, false);
  expect(f.interaction.dragging).toBe(true);
  expect(f.interaction.target).toEqual(pose);
  expect(f.sent).toHaveLength(count);
  f.view.manipulation.available = true;
  f.advance(0.1);
  expect(f.sent.at(-1)).toMatchObject({ action: "update", token: "retained" });
  f.view.manipulation.available = false;
  f.advance(0.6, false);
  expect(f.interaction.dragging).toBe(false);
  expect(f.sent.some(c => c.action === "cancel")).toBe(true);
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
  expect(f.sent.at(-1).action).toBe("release");
  expect(f.interaction.snapshot().activity).toBe("Idle");
});

it("retires an executed selected draft only after completed state and measured arrival", () => {
  const f = fixture();
  f.interaction.setSelected(true); f.interaction.begin();
  f.interaction.aim(pose); f.advance(0.4);
  f.reply(f.sent.at(-1), planned("arrival"));
  f.interaction.end(); f.interaction.execute();
  f.reply(f.sent.at(-1), { status: "accepted", operation_id: "execution" });
  f.view.manipulation.ts = 101;
  f.view.manipulation.execution = "completed";
  f.view.manipulation.operation_id = "execution";
  f.advance(0.1);
  expect(f.interaction.target).toEqual(pose);
  f.view.manipulation.observations.arm.joints.joint = 0.3;
  f.advance(0.1);
  expect(f.interaction.selected).toBe(true);
  expect(f.interaction.target).toBeNull();
  expect(f.interaction.snapshot().activity).toBe("Idle");
});


it("keeps a checked-plan request alive while its bounded trajectory asset is still transferring", () => {
  const f = fixture(); f.interaction.setSelected(true); f.interaction.begin();
  f.interaction.aim(pose); f.advance(0.4); const request = f.sent.at(-1);
  f.assets.set(request.request_id, 140);
  f.advance(20.1);
  expect(f.interaction.rejection).toBeNull();
  expect(f.interaction.dragging).toBe(true);
  f.reply(request, planned("slow-trajectory"));
  expect(f.interaction.previewPlan?.plan_id).toBe("slow-trajectory");
});

it("bounds a stalled checked-plan asset and ignores its completion after the asset deadline", () => {
  const f = fixture(); f.interaction.setSelected(true); f.interaction.begin();
  f.interaction.aim(pose); f.advance(0.4); const request = f.sent.at(-1);
  f.assets.set(request.request_id, 140); f.advance(40);
  expect(f.interaction.rejection?.message).toBe("Request timed out");
  f.reply(request, planned("expired-trajectory"));
  expect(f.interaction.plan).toBeNull();
});
