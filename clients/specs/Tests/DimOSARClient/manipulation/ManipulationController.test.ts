import { expect, it, vi } from "vitest";
import { ManipulationController } from "../../../Assets/Scripts/DimOSARClient/manipulation/ManipulationController";

function fixture() {
  const sent: any[] = [];
  let listener: (message: any) => void = () => {};
  const view: any = {
    connection: "ready", capabilities: { manipulation: { available: true } },
    manipulation: { groups: [{ id: "arm", following: true, joint_names: ["joint"] }],
      observations: { arm: { joints: { joint: 0 }, measured_at: 0, gripper: 0 } } },
  };
  const stop = vi.fn();
  const core = new ManipulationController({ view: () => view,
    sendText: (text: string) => sent.push(JSON.parse(text)), requestEstop: stop,
    subscribeOutbound: (callback: (message: any) => void) => { listener = callback; return () => {}; },
  } as never, () => 0, stop);
  core.tick();
  return { core, sent, view, stop, reply(command: any, extra: object) {
    listener({ type: "manipulation_result", request_id: command.request_id,
      action: command.action, group_id: command.group_id, status: "completed", ...extra });
  } };
}

it("suspends once, discards the target, and releases a late acquisition", () => {
  const f = fixture();
  expect(f.core.interaction.begin()).toBe(true);
  const acquire = f.sent.at(-1);
  f.core.interaction.aim({ position: [0, 0, 0.3], orientation: [0, 0, 0, 1] });
  f.core.tick(false); f.core.tick(false);
  expect(f.core.interaction.target).toBeNull();
  expect(f.sent.filter(c => c.action === "cancel")).toHaveLength(1);
  f.reply(acquire, { token: "late" });
  expect(f.sent.at(-1)).toMatchObject({ action: "release", token: "late" });
});

it("never sends a release on a closed session", () => {
  const f = fixture(); f.core.interaction.begin();
  f.reply(f.sent.at(-1), { token: "held" });
  f.view.connection = "disconnected";
  const count = f.sent.length;
  expect(() => f.core.suspend()).not.toThrow();
  expect(f.sent).toHaveLength(count);
});

it("defers selected gripper intent and uses the injected stop owner", () => {
  const f = fixture(); f.core.setSelected(true);
  f.view.manipulation.observations.arm.pose = { position: [0, 0, 0], orientation: [0, 0, 0, 1] };
  f.core.interaction.target = { position: [0, 0, 0.1], orientation: [0, 0, 0, 1] };
  f.core.action("gripper");
  expect(f.core.interaction.desiredGripper).toBe(1);
  expect(f.sent.some(c => c.action === "gripper")).toBe(false);
  f.core.action("estop"); expect(f.stop).toHaveBeenCalledOnce();
});
