import { beforeEach, expect, it, vi } from "vitest";
import { setMockInteractors } from "../mocks/InteractionManager";
import { SpecsNavigationInput } from "../../Assets/Scripts/DimOSSpecsClient/navigation/SpecsNavigationInput";

const body = {} as SceneObject, marker = {} as SceneObject, cancel = {} as SceneObject;
function harness(target: SceneObject) {
  const navigation = { ownsMarkerTarget: (o: SceneObject) => o === marker, ownsDraft: vi.fn(() => false),
    setHovered: vi.fn(), clearAim: vi.fn(), aim: vi.fn(), hold: vi.fn(), release: vi.fn(), cancelSource: vi.fn(), cancelDrag: vi.fn() };
  const robot = { ownsTarget: (o: SceneObject) => o === body, setHovered: vi.fn() };
  const hand = { inputType: 1, startPoint: new vec3(), direction: new vec3(0, 0, -1),
    isActive: () => true, isTriggering: false, currentInteractable: { getSceneObject: () => target } };
  setMockInteractors([hand]);
  return { adapter: new SpecsNavigationInput(navigation, robot), navigation, robot, hand };
}
beforeEach(() => { (globalThis as any).deviceInfoSystem = { isEditor: () => false }; setMockInteractors([]); });
it("hovers the robot only while an active hand targets its body", () => {
  const h = harness(body); h.adapter.tick();
  expect(h.robot.setHovered).toHaveBeenLastCalledWith(true);
  expect(h.navigation.setHovered).toHaveBeenLastCalledWith(false);
});
it("keeps marker hover separate from robot bounds", () => {
  const h = harness(marker); h.adapter.tick();
  expect(h.robot.setHovered).toHaveBeenLastCalledWith(false);
  expect(h.navigation.setHovered).toHaveBeenLastCalledWith(true);
});
it("excludes Cancel and clears hover when hands are lost", () => {
  const h = harness(body); h.adapter.tick();
  h.hand.currentInteractable.getSceneObject = () => cancel; h.adapter.tick();
  expect(h.robot.setHovered).toHaveBeenLastCalledWith(false);
  setMockInteractors([]); h.adapter.tick();
  expect(h.navigation.setHovered).toHaveBeenLastCalledWith(false);
});
it("keeps robot hover available in Agent mode while navigation is disabled", () => {
  const h = harness(body); h.adapter.tick(false, true);
  expect(h.robot.setHovered).toHaveBeenLastCalledWith(true);
  expect(h.navigation.aim).not.toHaveBeenCalled();
});
it("does not hover the robot through the draft owner's gesture", () => {
  const h = harness(body); h.navigation.ownsDraft.mockReturnValue(true); h.adapter.tick();
  expect(h.robot.setHovered).toHaveBeenLastCalledWith(false);
});
it("retains hover while either active hand still targets the robot", () => {
  const h = harness(body);
  setMockInteractors([h.hand, { ...h.hand, inputType: 2, currentInteractable: { getSceneObject: () => cancel } }]);
  h.adapter.tick(); expect(h.robot.setHovered).toHaveBeenLastCalledWith(true);
  h.adapter.reset(); expect(h.robot.setHovered).toHaveBeenLastCalledWith(false);
});

it("continues the draft owner's floor gesture through the robot collider", () => {
  const h = harness(body);
  h.navigation.ownsDraft.mockReturnValue(true);
  h.adapter.tick();
  expect(h.navigation.aim).toHaveBeenCalled();
  h.hand.isTriggering = true;
  h.adapter.tick();
  expect(h.navigation.hold).toHaveBeenCalled();
  h.hand.isTriggering = false;
  h.adapter.tick();
  expect(h.navigation.release).toHaveBeenCalled();
});

it("clears a probe on UI occlusion and waits for release after an interrupted hold", () => {
  const h = harness(marker);
  h.adapter.tick(); h.hand.isTriggering = true; h.adapter.tick();
  h.hand.currentInteractable.getSceneObject = () => cancel;
  h.adapter.tick();
  expect(h.navigation.cancelSource).toHaveBeenCalledWith("1");
  expect(h.navigation.clearAim).toHaveBeenCalledWith("1");
  const holds = h.navigation.hold.mock.calls.length;
  h.hand.currentInteractable.getSceneObject = () => marker;
  h.adapter.tick(); expect(h.navigation.hold).toHaveBeenCalledTimes(holds);
  h.hand.isTriggering = false; h.adapter.tick();
  h.hand.isTriggering = true; h.adapter.tick();
  expect(h.navigation.hold).toHaveBeenCalledTimes(holds + 1);
});

it("retires a lost hand without cancelling the other hand's probe", () => {
  const h = harness(marker);
  const other = { ...h.hand, inputType: 2 };
  setMockInteractors([h.hand, other]); h.adapter.tick();
  h.hand.isTriggering = true; h.adapter.tick();
  setMockInteractors([other]); h.adapter.tick();
  expect(h.navigation.cancelSource).toHaveBeenLastCalledWith("1");
  expect(h.navigation.cancelDrag).not.toHaveBeenCalled();
  expect(h.navigation.aim).toHaveBeenLastCalledWith("2", other.startPoint, other.direction);
  const holds = h.navigation.hold.mock.calls.length;
  setMockInteractors([h.hand, other]); h.adapter.tick();
  expect(h.navigation.hold).toHaveBeenCalledTimes(holds);
});

it("requires release after navigation is disabled during a hold", () => {
  const h = harness(marker);
  h.hand.isTriggering = true; h.adapter.tick();
  h.adapter.tick(false);
  const holds = h.navigation.hold.mock.calls.length;
  h.adapter.tick(true);
  expect(h.navigation.hold).toHaveBeenCalledTimes(holds);
  expect(h.navigation.setHovered).toHaveBeenLastCalledWith(false);
  h.hand.isTriggering = false; h.adapter.tick();
  h.hand.isTriggering = true; h.adapter.tick();
  expect(h.navigation.hold).toHaveBeenCalledTimes(holds + 1);
});

it("does not hover a robot through a gesture captured by another object", () => {
  const h = harness(cancel);
  h.hand.isTriggering = true; h.adapter.tick();
  h.hand.currentInteractable.getSceneObject = () => body;
  h.adapter.tick();
  expect(h.robot.setHovered).toHaveBeenLastCalledWith(false);
  h.hand.isTriggering = false; h.adapter.tick();
  expect(h.robot.setHovered).toHaveBeenLastCalledWith(true);
});
