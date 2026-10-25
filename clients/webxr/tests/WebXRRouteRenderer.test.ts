import { expect, it } from "vitest";
import { WebXRRouteRenderer } from "../src/navigation/WebXRRouteRenderer";

it("updates the entire route as its segment count grows and shrinks", () => {
  const route = new WebXRRouteRenderer();
  const origin = { position: [0, 0, 0] as [number, number, number], orientation: [0, 0, 0, 1] as [number, number, number, number], confidence: 1, ts: 0 };
  route.apply([[0, 0, 0, 0], [0.1, 0, 0, 0]], origin, true, 0, 0);
  const shortGeometry = route.object.geometry;
  route.apply([[0, 0, 0, 0], [0.1, 0, 0, 0], [1, 0, 0, 0], [5, 0, 0, 0]], origin, true, 0, 0);
  expect(route.object.geometry).not.toBe(shortGeometry);
  const geometry = route.object.geometry;
  const ends = geometry.getAttribute("instanceEnd");
  expect(ends.getZ(ends.count - 1)).toBeCloseTo(-5);
  expect(geometry.instanceCount).toBe(ends.count);
  route.apply([[0, 0, 0, 0], [0.1, 0, 0, 0], [1, 0, 0, 0], [6, 0, 0, 0]], origin, true, 0, 0);
  expect(route.object.geometry).toBe(geometry);
  expect(ends.getZ(ends.count - 1)).toBeCloseTo(-6);
  route.apply([[0, 0, 0, 0], [0.1, 0, 0, 0]], origin, true, 0, 0);
  expect(route.object.geometry.instanceCount).toBe(1);
  route.dispose();
});


it("renders thin dotted previews and active paths at circle edges, including scaled aiming circles", () => {
  const route = new WebXRRouteRenderer();
  const origin = { position: [0, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: 0 } as import("@dimos-ar-client/localization/clientTrackingOrigin").ClientTrackingOrigin;
  const style = { preview: true, startCircle: { center: [0, 0.001, 0] as [number, number, number], radius: 0.06 }, endCircle: { center: [0, 0.015, -2] as [number, number, number], radius: 0.268 } };
  route.apply([[0, 0, 0, 0], [2, 0, 0, 0]], origin, true, 0, 0, style);
  const geometry = route.object.geometry, start = geometry.getAttribute("instanceStart"), end = geometry.getAttribute("instanceEnd");
  expect(start.getZ(0)).toBeCloseTo(-0.06); expect(start.getY(0)).toBeCloseTo(0.001);
  expect(end.getZ(end.count - 1)).toBeCloseTo(-1.732); expect(end.getY(end.count - 1)).toBeCloseTo(0.015);
  expect(route.object.material.opacity).toBe(0.6); expect(route.object.material.dashed).toBe(true); expect(route.object.material.linewidth).toBe(0.01);
  route.apply([[0, 0, 0, 0], [2, 0, 0, 0]], origin, true, 0, 0, { ...style, preview: false, endCircle: { ...style.endCircle, radius: 0.134 } });
  expect(route.object.material.opacity).toBe(0.85); expect(end.getZ(end.count - 1)).toBeCloseTo(-1.866);
  route.dispose();
});

it("draws executing routes as solid strokes with round caps outside circles and keeps previews dotted", () => {
  const route = new WebXRRouteRenderer();
  const origin = { position: [0, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: 0 } as import("@dimos-ar-client/localization/clientTrackingOrigin").ClientTrackingOrigin;
  const path: [number, number, number, number][] = [[0, 0, 0, 0], [2, 0, 0, 0]];
  const style = { executing: true, startCircle: { center: [0, 0, 0] as [number, number, number], radius: 0.06 }, endCircle: { center: [0, 0, -2] as [number, number, number], radius: 0.3 } };
  route.apply(path, origin, true, 0, 0, style);
  expect(route.object.material.dashed).toBe(false); expect(route.object.material.opacity).toBe(0.85);
  expect(route.object.geometry.getAttribute("instanceStart").getZ(0)).toBeCloseTo(-0.065);
  expect(route.object.geometry.getAttribute("instanceEnd").getZ(0)).toBeCloseTo(-1.695);
  route.apply(path, origin, true, 0, 0, { ...style, preview: true });
  expect(route.object.material.dashed).toBe(true); expect(route.object.material.opacity).toBe(0.6);
  route.apply(path, origin, true, 0, 0, { ...style, executing: false });
  expect(route.object.material.dashed).toBe(true); expect(route.object.material.opacity).toBe(0.85);
  route.dispose();
});
