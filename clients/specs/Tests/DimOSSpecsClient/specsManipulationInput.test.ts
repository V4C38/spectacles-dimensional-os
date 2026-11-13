import { beforeEach, expect, it, vi } from "vitest";
vi.mock("SpectaclesUIKit.lspkg/Scripts/Components/Slider/Slider", () => ({ Slider: class {} }));
import { clearMockCursors, setMockCursor } from "../mocks/CursorControllerProvider";
import { setMockInteractors } from "../mocks/InteractionManager";
import { SpecsManipulationInput } from "../../Assets/Scripts/DimOSSpecsClient/manipulation/SpecsManipulationController";
beforeEach(() => { clearMockCursors(); (global as any).deviceInfoSystem = { isEditor: () => false }; });
it("captures a full pose through target departure and releases only the owner", () => {
  const target = {} as SceneObject;
  const port = { begin: vi.fn(() => true), hold: vi.fn(), end: vi.fn(), interrupt: vi.fn(), pressTarget: vi.fn(() => false), ownsHandle: (o: SceneObject) => o === target };
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
  const port = { begin: vi.fn(() => true), hold: vi.fn(), end: vi.fn(), interrupt: vi.fn(), pressTarget: vi.fn(() => false), ownsHandle: () => true };
  const hand: any = { inputType: 2, isActive: () => true, startPoint: new vec3(0, 0, 0),
    orientation: new quat(1, 0, 0, 0), isTriggering: true, currentInteractable: { getSceneObject: () => target } };
  setMockInteractors([hand]); const input = new SpecsManipulationInput(port); input.tick(true);
  hand.isActive = () => false; input.tick(true); expect(input.capture.owner).toBeNull();
  expect(port.interrupt).toHaveBeenCalledOnce(); expect(port.end).not.toHaveBeenCalled();
  hand.isActive = () => true; input.tick(true); expect(port.begin).toHaveBeenCalledOnce();
});

it("pins the native cursor to the grabbed local point and clears the override on release", () => {
  let offset = new vec3(0, 0, 0);
  const target = { getTransform: () => ({ getWorldTransform: () => ({
    inverse: () => ({ multiplyPoint: (point: vec3) => point.sub(offset) }),
    multiplyPoint: (point: vec3) => point.add(offset),
  }) }) } as unknown as SceneObject;
  const port = { begin: vi.fn(() => true), hold: vi.fn(), end: vi.fn(), interrupt: vi.fn(), pressTarget: vi.fn(() => false), ownsHandle: () => true };
  const source: any = { inputType: 2, isActive: () => true, startPoint: new vec3(0, 0, 0),
    orientation: new quat(1, 0, 0, 0), isTriggering: true, targetHitPosition: new vec3(1, 2, 3),
    currentInteractable: { getSceneObject: () => target } };
  const cursor = { cursorPosition: null as vec3 | null };
  setMockInteractors([source]); setMockCursor(source, cursor);
  const input = new SpecsManipulationInput(port); input.tick(true);
  offset = new vec3(10, 20, 30); input.updateCursor();
  expect(cursor.cursorPosition).toEqual(new vec3(11, 22, 33));
  source.isTriggering = false; input.tick(true);
  expect(cursor.cursorPosition).toBeNull();
});
it("requires an observed release after a captured source disappears", () => {
  const target = {} as SceneObject;
  const port = { begin: vi.fn(() => true), hold: vi.fn(), end: vi.fn(), interrupt: vi.fn(), pressTarget: vi.fn(() => false), ownsHandle: () => true };
  const source: any = { inputType: 2, isActive: () => true, startPoint: new vec3(0, 0, 0),
    orientation: new quat(1, 0, 0, 0), isTriggering: true, currentInteractable: { getSceneObject: () => target } };
  const input = new SpecsManipulationInput(port); setMockInteractors([source]); input.tick(true);
  setMockInteractors([]); input.tick(true); setMockInteractors([source]); input.tick(true);
  expect(port.begin).toHaveBeenCalledOnce();
  source.isTriggering = false; input.tick(true); source.isTriggering = true; input.tick(true);
  expect(port.begin).toHaveBeenCalledTimes(2);
});

it("does not toggle selection when a held pinch enters another mesh", () => {
  const mesh = {} as SceneObject;
  const port = { begin: vi.fn(() => false), hold: vi.fn(), end: vi.fn(), interrupt: vi.fn(),
    pressTarget: vi.fn(() => true), ownsHandle: () => false };
  const source: any = { inputType: 2, isActive: () => true, startPoint: new vec3(0, 0, 0),
    orientation: new quat(1, 0, 0, 0), isTriggering: false, currentInteractable: null };
  const input = new SpecsManipulationInput(port); setMockInteractors([source]); input.tick(true);
  source.isTriggering = true; input.tick(true);
  source.currentInteractable = { getSceneObject: () => mesh }; input.tick(true);
  expect(port.pressTarget).not.toHaveBeenCalled();
  source.isTriggering = false; input.tick(true);
  source.isTriggering = true; input.tick(true); input.tick(true);
  expect(port.pressTarget).toHaveBeenCalledOnce();
  expect(port.pressTarget).toHaveBeenCalledWith(mesh, "2");
});
