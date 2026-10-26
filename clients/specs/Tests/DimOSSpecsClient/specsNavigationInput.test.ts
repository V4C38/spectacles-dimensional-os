import { beforeEach, expect, it, vi } from "vitest";
import { setMockInteractors } from "../mocks/InteractionManager";
import { SpecsNavigationInput } from "../../Assets/Scripts/DimOSSpecsClient/navigation/SpecsNavigationInput";

const body = {} as SceneObject, marker = {} as SceneObject, cancel = {} as SceneObject;
function harness(target: SceneObject) {
  const navigation = { ownsMarkerTarget: (o: SceneObject) => o === marker, ownsDraft: vi.fn(() => false),
    isMarkerAttachedToRobot: vi.fn(() => true),
    setHovered: vi.fn(), clearAim: vi.fn(), aim: vi.fn(), hold: vi.fn(), release: vi.fn(), cancelSource: vi.fn(), cancelDrag: vi.fn() };
  const robot = { ownsTarget: (o: SceneObject) => o === body, setHovered: vi.fn() };
  const hand = { inputType: 1, startPoint: new vec3(), direction: new vec3(0, 0, -1),
    isActive: () => true, isTriggering: false, currentInteractable: { getSceneObject: () => target } };
  setMockInteractors([hand]);
  return { adapter: new SpecsNavigationInput(navigation, robot), navigation, robot, hand };
}
beforeEach(() => { (globalThis as any).deviceInfoSystem = { isEditor: () => false }; setMockInteractors([]); });
it("links attached marker hover to an active hand targeting the robot body", () => {
  const h = harness(body); h.adapter.tick();
  expect(h.robot.setHovered).toHaveBeenLastCalledWith(true);
  expect(h.navigation.setHovered).toHaveBeenLastCalledWith(true);
});
it("highlights the robot alongside its attached hovered marker", () => {
  const h = harness(marker); h.adapter.tick();
  expect(h.robot.setHovered).toHaveBeenLastCalledWith(true);
  expect(h.navigation.setHovered).toHaveBeenLastCalledWith(true);
});

it("keeps detached marker hover independent of the robot bounds", () => {
  const h = harness(marker); h.navigation.isMarkerAttachedToRobot.mockReturnValue(false); h.adapter.tick();
  expect(h.robot.setHovered).toHaveBeenLastCalledWith(false);
  expect(h.navigation.setHovered).toHaveBeenLastCalledWith(true);
  h.hand.currentInteractable.getSceneObject = () => body; h.adapter.tick();
  expect(h.robot.setHovered).toHaveBeenLastCalledWith(true);
  expect(h.navigation.setHovered).toHaveBeenLastCalledWith(false);
});

it("breaks the hover link on detachment without requiring a new hover event", () => {
  const h = harness(marker); h.adapter.tick();
  expect(h.robot.setHovered).toHaveBeenLastCalledWith(true);
  h.navigation.isMarkerAttachedToRobot.mockReturnValue(false); h.adapter.tick();
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

it("keeps a captured marker drag responsive as the ray crosses the robot box", () => {
  const h = harness(marker);
  h.hand.isTriggering = true; h.adapter.tick();
  h.hand.currentInteractable.getSceneObject = () => body;
  for (let i = 0; i < 12; i++) h.adapter.tick();
  expect(h.navigation.hold).toHaveBeenCalledTimes(13);
  expect(h.navigation.hold).toHaveBeenLastCalledWith("1", h.hand.startPoint, h.hand.direction, true);
  expect(h.navigation.cancelSource).not.toHaveBeenCalled();
  expect(h.navigation.clearAim).not.toHaveBeenCalled();
  h.hand.isTriggering = false; h.adapter.tick();
  expect(h.navigation.release).toHaveBeenCalledOnce();
  expect(h.navigation.aim).not.toHaveBeenCalled();
});

it("preserves robot hover throughout a selection press and release", () => {
  const h = harness(body);
  h.adapter.tick(); h.hand.isTriggering = true;
  for (let i = 0; i < 20; i++) {
    h.adapter.tick();
    expect(h.robot.setHovered).toHaveBeenLastCalledWith(true);
  }
  h.hand.isTriggering = false; h.adapter.tick();
  expect(h.robot.setHovered.mock.calls.every(([value]) => value === true)).toBe(true);
  expect(h.navigation.hold).not.toHaveBeenCalled();
  expect(h.navigation.release).not.toHaveBeenCalled();
});

it("does not preserve robot hover after its captured press moves onto UI", () => {
  const h = harness(body);
  h.hand.isTriggering = true; h.adapter.tick();
  h.hand.currentInteractable.getSceneObject = () => cancel; h.adapter.tick();
  expect(h.robot.setHovered).toHaveBeenLastCalledWith(false);
});

it("releases a marker gesture before resuming idle aim", () => {
  const h = harness(marker);
  h.hand.isTriggering = true; h.adapter.tick();
  h.hand.isTriggering = false; h.adapter.tick();
  expect(h.navigation.release).toHaveBeenCalledOnce();
  expect(h.navigation.aim).not.toHaveBeenCalled();
  h.adapter.tick(); expect(h.navigation.aim).toHaveBeenCalledOnce();
});
