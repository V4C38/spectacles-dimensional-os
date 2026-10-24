import { expect, it, vi } from "vitest";
import { RobotSelection } from "../../Assets/Scripts/DimOSARClient/robot/RobotSelection";

it("owns eligible selection and notifies only on transitions", () => {
  const selection = new RobotSelection(), changed = vi.fn();
  const unsubscribe = selection.subscribe(changed);
  selection.toggle(); expect(selection.isSelected()).toBe(false);
  selection.setEligible(true); selection.toggle(); selection.setSelected(true);
  expect(changed.mock.calls).toEqual([[true]]);
  selection.setEligible(false); expect(selection.isSelected()).toBe(false);
  selection.setEligible(true); expect(selection.isSelected()).toBe(false);
  unsubscribe(); selection.toggle(); expect(changed.mock.calls).toEqual([[true], [false]]);
});
