import { expect, it } from "vitest";
import { ArmPresentationSampler } from "../../src/manipulation/ArmPresentation";
import type { ManipulationModel, ManipulationState } from "../../src/manipulation/ManipulationTypes";
const origin = { position: [0,0,0] as [number,number,number], orientation: [0,0,0,1] as [number,number,number,number], confidence: 1, ts: 0 };
const model: ManipulationModel = { revision: "one", root: "base", links: [{ name: "base", bounds: null }, { name: "tool", bounds: null }], asset_url: null,
  joints: [{ name: "slide", kind: "prismatic", parent: "base", child: "tool", axis: [1,0,0], origin, mimic: null }], gripper_joints: {} };
const group = { id: "arm", joint_names: ["slide"], base_frame: "base", tip_frame: "tool", has_gripper: false, following: false };
const state: ManipulationState = { type: "manipulation_state", available: true, model, groups: [group], observations: { arm: { joints: { slide: 0 }, measured_at: 0, pose: origin, gripper: null } } };
it("samples measured and proposed poses without mutating observations and resets only when the coordinate context changes", () => {
  const sampler = new ArmPresentationSampler();
  const input = { model, state, group, origin, now: 0, selected: true, dragging: false, rejected: false, solution: { slide: .5 }, opening: null, plan: null, playback: { playing: false, time: 0 } };
  const initial = sampler.sample(input);
  expect(initial.contextChanged).toBe(true);
  expect(initial.measured.tool.position[0]).toBe(0);
  expect(initial.proposed.tool.position[0]).toBe(.5);
  expect(state.observations!.arm.joints).toEqual({ slide: 0 });
  expect(sampler.sample({ ...input, origin: { ...origin, ts: 1 }, now: .1 }).contextChanged).toBe(false);
  expect(sampler.sample({ ...input, origin: { ...origin, position: [1,0,0] }, now: .2 }).contextChanged).toBe(true);
});
it("pauses both interpolation clocks across feedback retention", () => {
  const sampler = new ArmPresentationSampler();
  const input = { model, state, group, origin, now: 0, selected: true, dragging: false, rejected: false, solution: { slide: 0 }, opening: null, plan: null, playback: { playing: false, time: 0 } };
  sampler.sample(input);
  const next = { ...input, state: { ...state, observations: { arm: { joints: { slide: .4 }, measured_at: .1, pose: origin, gripper: null } } }, solution: { slide: .6 }, now: .1 };
  sampler.sample(next);
  const before = sampler.sample({ ...next, now: .12 });
  sampler.hold(2.12);
  const after = sampler.sample({ ...next, now: 2.12 });
  expect(after.measured.tool.position[0]).toBeCloseTo(before.measured.tool.position[0], 12);
  expect(after.proposed.tool.position[0]).toBeCloseTo(before.proposed.tool.position[0], 12);
});
