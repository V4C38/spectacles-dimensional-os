import { beforeEach, expect, it, vi } from "vitest";
import { setMockInteractors } from "../mocks/InteractionManager";
import { SpecsManipulationInput } from "../../Assets/Scripts/DimOSSpecsClient/manipulation/SpecsManipulationInput";
beforeEach(() => { (global as any).deviceInfoSystem = { isEditor: () => false }; });
it("captures a full pose through target departure and releases only the owner", () => {
  const target = {} as SceneObject;
  const port = { begin: vi.fn(() => true), hold: vi.fn(), end: vi.fn(), ownsHandle: (o: SceneObject) => o === target };
  const right: any = { inputType: 2, isActive: () => true, startPoint: new vec3(10, 20, 30),
    orientation: new quat(1, 0, 0, 0), isTriggering: true, currentInteractable: { getSceneObject: () => target } };
  const left = { ...right, inputType: 1, isTriggering: false, currentInteractable: null };
  setMockInteractors([right, left]);
  const input = new SpecsManipulationInput(port); input.tick(true);
  expect(port.begin).toHaveBeenCalledOnce(); expect(input.capture.owner).toBe("2");
  right.currentInteractable = null; input.tick(true);
  expect(port.hold).toHaveBeenCalledTimes(2); expect(port.end).not.toHaveBeenCalled();
  right.isTriggering = false; input.tick(true); expect(port.end).toHaveBeenCalledOnce();
  expect(input.capture.owner).toBeNull();
});
it("ends a lost source without re-acquiring its held pinch", () => {
  const target = {} as SceneObject;
  const port = { begin: vi.fn(() => true), hold: vi.fn(), end: vi.fn(), ownsHandle: () => true };
  const hand: any = { inputType: 2, isActive: () => true, startPoint: new vec3(0, 0, 0),
    orientation: new quat(1, 0, 0, 0), isTriggering: true, currentInteractable: { getSceneObject: () => target } };
  setMockInteractors([hand]); const input = new SpecsManipulationInput(port); input.tick(true);
  hand.isActive = () => false; input.tick(true); expect(input.capture.owner).toBeNull();
  hand.isActive = () => true; input.tick(true); expect(port.begin).toHaveBeenCalledOnce();
});
