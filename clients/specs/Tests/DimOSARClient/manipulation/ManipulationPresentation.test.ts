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
it("shares near-EE Execute and motion path opacity across both clients", () => {
  const intent = { canExecute: true, canManipulate: true, stopped: false, executing: false, finishing: false } as any;
  expect(endEffectorAction(true, intent, 0, true)).toMatchObject({ action: "execute", label: "Execute", enabled: true, allowDuringGrab: false });
  expect(endEffectorAction(false, intent, 0, true)).toMatchObject({ action: "gripper", label: "Open" });
  expect(manipulationPathOpacity(intent, false, false)).toBe(0.5);
  expect(manipulationPathOpacity(intent, true, false)).toBe(1);
  expect(manipulationPathOpacity({ ...intent, executing: true }, false, true)).toBe(1);
  expect(manipulationPathOpacity({ ...intent, finishing: true }, false, false)).toBe(1);
});
