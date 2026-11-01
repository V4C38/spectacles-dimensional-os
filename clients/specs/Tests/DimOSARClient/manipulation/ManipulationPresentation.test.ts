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
