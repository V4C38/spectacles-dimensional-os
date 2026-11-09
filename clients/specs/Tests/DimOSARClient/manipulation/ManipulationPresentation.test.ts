import { expect, it } from "vitest";
import { ManipulationPresentation } from "../../../Assets/Scripts/DimOSARClient/manipulation/ManipulationPresentation";
const plan = { plan_id: "one", joint_names: ["j"], trajectory: [{ time: 0, positions: [0] }, { time: 1, positions: [1] }], duration: 1 };
it("plays once from zero and retains the final configuration", () => {
  const p = new ManipulationPresentation();
  p.togglePreview();
  expect(p.sample(plan, 100)).toEqual({ playing: true, time: 0 });
  expect(p.sample(plan, 100.5)).toEqual({ playing: true, time: 0.5 });
  expect(p.sample(plan, 102)).toEqual({ playing: false, time: 1 });
  expect(p.previewRequested).toBe(false);
  p.togglePreview(); expect(p.sample(plan, 110).time).toBe(0);
  p.reset(); expect(p.previewRequested).toBe(false);
});


import { endEffectorAction, manipulationPathOpacity } from "../../../Assets/Scripts/DimOSARClient/manipulation/ManipulationPresentation";
it("shares near-EE gripper and motion path opacity across both clients", () => {
  const intent = { canExecute: true, canManipulate: true, stopped: false, executing: false, finishing: false } as any;
  expect(endEffectorAction(true, intent, 0, true)).toMatchObject({ action: "gripper", label: "Open", enabled: true, allowDuringGrab: true });
  expect(endEffectorAction(false, intent, 0, true)).toMatchObject({ action: "gripper", label: "Open" });
  expect(manipulationPathOpacity(intent, false, false)).toBe(0.5);
  expect(manipulationPathOpacity(intent, true, false)).toBe(1);
  expect(manipulationPathOpacity({ ...intent, executing: true }, false, true)).toBe(1);
  expect(manipulationPathOpacity({ ...intent, finishing: true }, false, false)).toBe(1);
});

it("pauses Preview without consuming the feedback-loss interval",()=> {
  const p=new ManipulationPresentation(); p.togglePreview(); p.sample(plan,0);
  expect(p.sample(plan,.25).time).toBe(.25);
  p.hold(.5); p.hold(1); p.hold(2);
  expect(p.sample(plan,2).time).toBeCloseTo(.25);
  expect(p.sample(plan,2.1).time).toBeCloseTo(.35);
});

import { manipulationPreviewPlan } from "../../../Assets/Scripts/DimOSARClient/manipulation/ManipulationPresentation";
it("keeps an old reviewed endpoint out of every subsequent live drag", () => {
  expect(manipulationPreviewPlan(plan, true, false, false)).toBe(plan);
  for (let drag = 0; drag < 100; drag++) {
    expect(manipulationPreviewPlan(plan, true, true, false)).toBeNull();
  }
  expect(manipulationPreviewPlan(plan, false, false, false)).toBeNull();
  expect(manipulationPreviewPlan(plan, true, false, true)).toBeNull();
});
