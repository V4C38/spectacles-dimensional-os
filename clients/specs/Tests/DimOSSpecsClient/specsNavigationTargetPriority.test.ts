import { expect, it, vi } from "vitest";
import { SpecsNavigationTargetPriority } from "../../Assets/Scripts/DimOSSpecsClient/navigation/SpecsNavigationTargetPriority";

const robot = {} as SceneObject, marker = {} as SceneObject, cancel = {} as SceneObject;
const ui = {} as SceneObject, other = {} as SceneObject;
function hit(object: SceneObject, distance: number) {
  return { interactable: { getSceneObject: () => object }, hit: { distance } };
}
function fixture() {
  const original = vi.fn((hits: ReturnType<typeof hit>[]) => [...hits].sort((a, b) => a.hit.distance - b.hit.distance)[0] ?? null);
  const selector = { getNearestDeeplyNestedInteractable: original as (hits: ReturnType<typeof hit>[]) => ReturnType<typeof hit> | null };
  const priority = new SpecsNavigationTargetPriority(selector, object => object === robot,
    object => object === marker || object === cancel);
  return { selector, original, priority };
}

it("lets the native marker hit win through the nearer robot box in unselected mode", () => {
  const h = fixture(), body = hit(robot, 10), goal = hit(marker, 30);
  expect(h.selector.getNearestDeeplyNestedInteractable([body, goal])).toBe(goal);
  expect(h.selector.getNearestDeeplyNestedInteractable([goal, body])).toBe(goal);
  expect(h.selector.getNearestDeeplyNestedInteractable([body])).toBe(body);
});

it("also exposes the marker Cancel control through the robot box", () => {
  const h = fixture(), stop = hit(cancel, 20);
  expect(h.selector.getNearestDeeplyNestedInteractable([hit(robot, 10), stop])).toBe(stop);
});

it("preserves UI and other occluders rather than giving the marker global priority", () => {
  const h = fixture(), body = hit(robot, 10), panel = hit(ui, 5), goal = hit(marker, 30);
  expect(h.selector.getNearestDeeplyNestedInteractable([body, goal, panel])).toBe(panel);
  expect(h.selector.getNearestDeeplyNestedInteractable([body, hit(ui, 20), goal])).toBe(body);
  expect(h.selector.getNearestDeeplyNestedInteractable([body, hit(other, 20), goal])).toBe(body);
});

it("leaves all non-robot targeting with SIK and does not change hit data", () => {
  const h = fixture(), a = hit(other, 10), goal = hit(marker, 30);
  expect(h.selector.getNearestDeeplyNestedInteractable([a, goal])).toBe(a);
  expect(h.original).toHaveBeenCalledTimes(1);
  expect(h.selector.getNearestDeeplyNestedInteractable([])).toBeNull();
});

it("restores the native chooser on teardown and does not overwrite a later hook", () => {
  const h = fixture(); h.priority.dispose(); h.priority.dispose();
  expect(h.selector.getNearestDeeplyNestedInteractable).toBe(h.original);
  const second = fixture(), later = vi.fn(() => null);
  second.selector.getNearestDeeplyNestedInteractable = later; second.priority.dispose();
  expect(second.selector.getNearestDeeplyNestedInteractable).toBe(later);
});
