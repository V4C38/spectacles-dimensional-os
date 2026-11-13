import { expect, it } from "vitest";
import { ManipulationPreviewPlayback } from "../../src/manipulation/ManipulationPresentation";
const plan = { plan_id: "one", joint_names: ["j"], trajectory: [{ time: 0, positions: [0] }, { time: 1, positions: [1] }], duration: 1 };
it("plays once from zero and retains the final configuration", () => {
  const p = new ManipulationPreviewPlayback();
  p.togglePreview();
  expect(p.sample(plan, 100)).toEqual({ playing: true, time: 0 });
  expect(p.sample(plan, 100.5)).toEqual({ playing: true, time: 0.5 });
  expect(p.sample(plan, 102)).toEqual({ playing: false, time: 1 });
  expect(p.previewRequested).toBe(false);
  p.togglePreview(); expect(p.sample(plan, 110).time).toBe(0);
  p.reset(); expect(p.previewRequested).toBe(false);
});


import { endEffectorAction, manipulationPathOpacity } from "../../src/manipulation/ManipulationPresentation";
it("shares near-EE gripper and motion path opacity across both clients", () => {
  const intent = { canExecute: true, canManipulate: true, stopped: false, executing: false, finishing: false } as any;
  expect(endEffectorAction(intent, 0, true)).toMatchObject({ action: "gripper", label: "Open", enabled: true, allowDuringGrab: true });
  expect(endEffectorAction({ ...intent, canManipulate: false }, 0, true).enabled).toBe(false);
  expect(manipulationPathOpacity(intent, false, false)).toBe(0.5);
  expect(manipulationPathOpacity(intent, true, false)).toBe(1);
  expect(manipulationPathOpacity({ ...intent, executing: true }, false, true)).toBe(1);
  expect(manipulationPathOpacity({ ...intent, finishing: true }, false, false)).toBe(1);
});

it("pauses Preview without consuming the feedback-loss interval",()=> {
  const p=new ManipulationPreviewPlayback(); p.togglePreview(); p.sample(plan,0);
  expect(p.sample(plan,.25).time).toBe(.25);
  p.hold(.5); p.hold(1); p.hold(2);
  expect(p.sample(plan,2).time).toBeCloseTo(.25);
  expect(p.sample(plan,2.1).time).toBeCloseTo(.35);
});

import { manipulationPreviewPlan } from "../../src/manipulation/ManipulationPresentation";
it("keeps an old reviewed endpoint out of every subsequent live drag", () => {
  expect(manipulationPreviewPlan(plan, true, false, false)).toBe(plan);
  {
    expect(manipulationPreviewPlan(plan, true, true, false)).toBeNull();
  }
  expect(manipulationPreviewPlan(plan, false, false, false)).toBeNull();
  expect(manipulationPreviewPlan(plan, true, false, true)).toBeNull();
});


import { manipulationActivePlan, manipulationObservedJoints, manipulationProposedJoints } from "../../src/manipulation/ManipulationPresentation";
it("derives the same articulated joints for live IK, rejected drafts, reviewed plans and playback", () => {
  const model: any = { joints: [], links: [] };
  const state: any = { observations: { arm: { joints: { j: .2 } }, other: { joints: { auxiliary: .7 } } }, plan };
  const group: any = { id: "arm", has_gripper: false };
  const measured = manipulationObservedJoints(model, state, group);
  expect(measured).toEqual({ j: .2, auxiliary: .7 });
  const input = { plan, playback: { playing: false, time: 0 }, selected: true, dragging: true,
    rejected: false, solution: { j: .4 }, opening: null };
  const derive = (changes: Partial<typeof input> = {}) => manipulationProposedJoints(model, group, measured, { ...input, ...changes });
  expect(derive()).toEqual({ j: .4, auxiliary: .7 });
  expect(derive({ dragging: false })).toEqual({ j: 1, auxiliary: .7 });
  expect(derive({ dragging: false, rejected: true })).toEqual({ j: .4, auxiliary: .7 });
  expect(derive({ playback: { playing: true, time: .5 } })).toEqual({ j: .5, auxiliary: .7 });
  expect(measured).toEqual({ j: .2, auxiliary: .7 });
  expect(state.observations.arm.joints).toEqual({ j: .2 });
  expect(manipulationActivePlan({ ...state, stopped: true }, plan, false)).toBeNull();
  expect(manipulationActivePlan(state, null, true)).toBe(plan);
  expect(manipulationActivePlan(state, null, false)).toBeNull();
});
