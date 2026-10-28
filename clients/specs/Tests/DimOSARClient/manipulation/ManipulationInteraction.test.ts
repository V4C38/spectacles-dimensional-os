import { describe, expect, it } from "vitest";
import { ManipulationInteraction } from "../../../Assets/Scripts/DimOSARClient/manipulation/ManipulationInteraction";
import {
  decodeManipulation,
  encodeManipulation,
} from "../../../Assets/Scripts/DimOSARClient/manipulation/ManipulationProtocol";
import type { Outbound } from "../../../Assets/Scripts/DimOSARClient/websocket/protocolTypes";

function fixture() {
  const sent: any[] = [];
  let now = 100;
  let listener: (message: Outbound) => void = () => {};
  const view: any = {
    connection: "ready",
    capabilities: { manipulation: { available: true } },
    manipulation: {
      groups: [{ id: "arm", following: true, joint_names: ["joint"] }],
      observations: { arm: { joints: { joint: 0 }, measured_at: 100 } },
    },
  };
  const interaction = new ManipulationInteraction(
    {
      view: () => view,
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
    reply,
    view,
    advance: (seconds: number) => {
      now += seconds;
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
    const evaluation = f.sent.at(-1);
    expect(evaluation.action).toBe("evaluate");
    f.reply(evaluation, { status: "feasible", joints: { joint: 0.3 } });
    f.interaction.requestPlan();
    f.advance(0.1);
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
  it("retires obsolete IK replies and never retries timed-out execution", () => {
    const f = fixture();
    f.interaction.setSelected(true);
    f.interaction.begin();
    f.interaction.aim(pose);
    f.advance(0.2);
    const evaluation = f.sent.at(-1);
    f.interaction.aim({ ...pose, position: [0.1, 0, 0.3] });
    f.reply(evaluation, { status: "feasible", joints: { old: 1 } });
    expect(f.interaction.solution).toBeNull();
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
