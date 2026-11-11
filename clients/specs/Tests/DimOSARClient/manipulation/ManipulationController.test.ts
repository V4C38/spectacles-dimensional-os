import { immediateAuthority } from "../../fixtures/ImmediateAuthority";
import { expect, it, vi } from "vitest";
import { ManipulationController } from "../../../Assets/Scripts/DimOSARClient/manipulation/ManipulationController";

function fixture() {
  const sent: any[] = [];
  let now = 0;
  let listener: (message: any) => void = () => {};
  const view: any = {
    connection: "ready", capabilities: { manipulation: { available: true } },
    manipulation: { groups: [{ id: "arm", following: true, joint_names: ["joint"] }],
      observations: { arm: { joints: { joint: 0 }, measured_at: 0, gripper: 0 } } },
  };
  const stop = vi.fn();
  const authority = immediateAuthority({ now: () => now, ready: () => view.connection === "ready" });
  const core = new ManipulationController({ view: () => view, collaboration: authority.collaboration,
    sendText: (text: string) => sent.push(JSON.parse(text)), requestEstop: stop,
    subscribeOutbound: (callback: (message: any) => void) => { listener = callback; return () => {}; },
  } as never, () => now, stop);
  core.tick();
  return { core, sent, view, stop, authority, advance: (seconds: number) => { now += seconds; view.manipulation.observations.arm.measured_at = now; }, reply(command: any, extra: object) {
    listener({ type: "manipulation_result", request_id: command.request_id,
      action: command.action, group_id: command.group_id, status: "completed", ...extra });
  } };
}

it("suspends once, discards the target, and retires a late acquisition", () => {
  const f = fixture();
  expect(f.core.interaction.begin()).toBe(true);
  const acquire = f.sent.at(-1);
  f.core.interaction.aim({ position: [0, 0, 0.3], orientation: [0, 0, 0, 1] });
  f.core.tick(false); f.core.tick(false);
  expect(f.core.interaction.target).toBeNull();
  expect(f.sent.filter(c => c.action === "cancel")).toHaveLength(1);
  f.reply(acquire, { token: "late" });
  expect(f.authority.state.authority).toBeNull();
  expect(f.sent.some(command => command.action === "release" || command.action === "update")).toBe(false);
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
  f.core.interaction.begin();
  f.core.interaction.aim({ position: [0, 0, 0.1], orientation: [0, 0, 0, 1] });
  f.core.action("gripper");
  expect(f.core.interaction.desiredGripper).toBe(1);
  expect(f.sent.some(c => c.action === "gripper")).toBe(false);
  f.core.action("estop"); expect(f.stop).toHaveBeenCalledOnce();
});

it("keeps preview playing across identical target snapshots", () => {
  const f = fixture();
  const pose = { position: [0, 0, .3], orientation: [0, 0, 0, 1] } as any;
  const publish = (position: [number, number, number]) => {
    f.authority.state.targets = [{ position, orientation: [0, 0, 0, 1], domain: "manipulation", group_id: "arm",
      phase: "draft", revision: f.authority.state.revision + 1, sequence: 0, sample_ts: 0 }];
    f.authority.publish(); f.advance(.2); f.core.tick(); f.core.tick();
  };
  publish(pose.position);
  f.core.presentation.togglePreview();
  publish([...pose.position]);
  expect(f.core.presentation.previewRequested).toBe(true);
  publish([0, 0, .4]);
  expect(f.core.presentation.previewRequested).toBe(false);
});
