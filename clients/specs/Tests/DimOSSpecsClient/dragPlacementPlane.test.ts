import { expect, it } from "vitest";
import { DragPlacementPlane, SpecsFloorReference, SpecsDragPosition } from "../../Assets/Scripts/DimOSSpecsClient/navigation/GroundPlacement";

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

it.each([20, -20])("smoothly approaches a mesh step at %s cm without snapping", height => {
  const plane = new DragPlacementPlane(vec3.zero());
  const first = plane.solve(from, ray, floor(height), 1 / 60)!;
  expect(Math.abs(first.y)).toBeGreaterThan(0);
  expect(Math.abs(first.y)).toBeLessThan(Math.abs(height) / 4);
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

it("requires a sustained floor consensus and ignores isolated mesh outliers", () => {
  const reference = new SpecsFloorReference(); reference.reset(0);
  [2, 2.2, 12, 1.8].forEach((y, i) => reference.observe(floor(y)[0], i * 0.1));
  expect(reference.heightCm).toBe(0);
  reference.observe(floor(2.1)[0], 0.4); expect(reference.heightCm).toBe(0);
  for (let i = 0; i < 60; i++) reference.advance(1 / 60);
  expect(reference.heightCm).toBe(2.1);
  reference.observe(floor(40)[0], 0.5); expect(reference.heightCm).toBe(2.1);
});
it("smooths position without frame-rate-dependent lag or an initial jump", () => {
  const sample = (fps: number) => {
    const filter = new SpecsDragPosition(vec3.zero());
    for (let i = 0; i < fps; i++) filter.update(new vec3(100, 20, -50), 1 / fps);
    return filter.position();
  };
  expect(sample(30).distance(sample(90))).toBeLessThan(0.001);
  const filter = new SpecsDragPosition(new vec3(5, 0, 0));
  expect(filter.update(new vec3(100, 0, 0), 0).x).toBe(5);
  const next = filter.update(new vec3(100, 0, 0), 1 / 60);
  expect(next.x).toBeGreaterThan(5); expect(next.x).toBeLessThan(25);
});
