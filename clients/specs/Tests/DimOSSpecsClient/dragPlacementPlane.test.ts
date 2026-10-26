import { expect, it } from "vitest";
import { DragPlacementPlane } from "../../Assets/Scripts/DimOSSpecsClient/navigation/GroundPlacement";

const from = new vec3(0, 100, 0), ray = new vec3(0, -1, -1);
const floor = (height: number, normal = new vec3(0, 1, 0)) =>
  [{ position: new vec3(0, height, height - 100), normal }];

it("uses the gesture plane despite small scan noise, gaps and non-floor surfaces", () => {
  const plane = new DragPlacementPlane(vec3.zero());
  for (const hits of [floor(9), floor(-10), floor(10), [], floor(40, new vec3(0, 0, 1))]) {
    expect(plane.solve(from, ray, hits, 1 / 60)).toEqual(new vec3(0, 0, -100));
  }
  expect(plane.solve(from, new vec3(1, -1, -1), [], 1 / 60)).toEqual(new vec3(100, 0, -100));
});

it.each([20, -20])("adheres immediately to a mesh step at %s cm while the plane adjusts slowly", height => {
  const plane = new DragPlacementPlane(vec3.zero());
  expect(plane.solve(from, ray, floor(height), 1 / 60)).toEqual(floor(height)[0].position);
  const duringGap = plane.solve(from, ray, [], 1 / 60)!;
  expect(Math.abs(duringGap.y)).toBeGreaterThan(0);
  expect(Math.abs(duringGap.y)).toBeLessThan(Math.abs(height));
  for (let i = 0; i < 300; i++) plane.solve(from, ray, floor(height), 1 / 60);
  expect(plane.solve(from, ray, [], 1 / 60)!.y).toBeCloseTo(height, 1);
});

it("keeps the plane flat after adapting height to a sloped mesh", () => {
  const plane = new DragPlacementPlane(vec3.zero());
  const normal = new vec3(0.3, 1, 0);
  for (let i = 0; i < 300; i++) plane.solve(from, ray, floor(20, normal), 1 / 60);
  for (const x of [-2, -1, 0, 1, 2]) {
    expect(plane.solve(from, new vec3(x, -1, -1), [], 0)!.y).toBeCloseTo(20, 1);
  }
});

it("starts each gesture at its own marker height and rejects backward or parallel rays", () => {
  const plane = new DragPlacementPlane(new vec3(0, 30, 0));
  expect(plane.solve(from, ray, [], 0)!.y).toBe(30);
  expect(plane.solve(from, new vec3(0, 1, 0), [], 0)).toBeNull();
  expect(plane.solve(from, new vec3(1, 0, 0), [], 0)).toBeNull();
});
