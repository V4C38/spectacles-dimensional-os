import { expect, it, vi } from "vitest";
import { NavigationMarkerRenderer } from "../../Assets/Scripts/DimOSSpecsClient/navigation/NavigationMarkerRenderer";
import { circleMesh, strokeMesh2D } from "../../Assets/Scripts/DimOSSpecsClient/presentation/WorldMeshRenderer";
import { FLASH_DURATION_S, NAV_FEEDBACK_TIMING } from "../../Assets/Scripts/DimOSARClient/navigation/NavigationGoalLifecycle";
import { NAVIGATION_COLORS } from "../../Assets/Scripts/DimOSARClient/presentation/WorldVisualStyle";

function sink() { return { triangles: vi.fn(), hide: vi.fn(), object: { getTransform: () => ({ setLocalPosition: vi.fn() }) } }; }
function renderer(scale = 1) {
  const circle = sink(), outcomeRing = sink(), glyph = sink(), arrow = sink();
  const value = Object.assign(Object.create(NavigationMarkerRenderer.prototype), {
    radiusCm: 21.44, scale, opacity: 0.35, time: 0, motion: 0,
    circle, outcomeRing, glyph, arrow, stem: { hide: vi.fn(), setViewportHeight: vi.fn() },
  }) as NavigationMarkerRenderer;
  return { value, circle, outcomeRing, glyph, arrow };
}
it("traces the navigation outcome from three o'clock over the retained white floor circle", () => {
  const r = renderer();
  r.value.apply({ selected: false, dragging: false, following: false, aiming: false,
    flash: "cancelled", feedbackProgress: NAV_FEEDBACK_TIMING.traceS * 0.25 / FLASH_DURATION_S }, 0, 1000);
  expect(r.circle.triangles.mock.calls[0][1]).toHaveLength(128 * 6);
  expect(r.circle.triangles.mock.calls[0][2].slice(0, 3)).toEqual([1, 1, 1]);
  const [points, indices] = r.outcomeRing.triangles.mock.calls[0];
  expect(indices).toHaveLength(32 * 6);
  expect(points.slice(0, 3)).toEqual([21.44 - 0.8, 0, 0]);
  expect(points.at(-3)).toBeCloseTo(0);
  expect(points.at(-1)).toBeCloseTo(-21.44);
  expect(r.glyph.triangles.mock.calls[0][1]).toHaveLength(0);
});
it("scales the completed check strokes with the selected feedback circle", () => {
  const r = renderer(1.15);
  r.value.apply({ selected: true, dragging: false, following: false, aiming: false,
    flash: "succeeded", feedbackProgress: 1 }, 0, 1000);
  const [points, indices] = r.glyph.triangles.mock.calls[0];
  expect(indices.length).toBeGreaterThan(12);
  expect((points[18] + points[21]) / 2).toBeCloseTo(9 * 1.15);
  expect((points[20] + points[23]) / 2).toBeCloseTo(-7 * 1.15);
});
it("uses the setup ring's clockwise twelve-o'clock trace and draws stroke endpoints progressively", () => {
  const ring = circleMesh(9.4, 0.4, 0.25, 96);
  expect(ring.positions[0]).toBeCloseTo(0);
  expect(ring.positions[2]).toBeCloseTo(9);
  expect(ring.positions.at(-3)).toBeCloseTo(9.4);
  expect(ring.positions.at(-1)).toBeCloseTo(0);
  const line = strokeMesh2D([[-4.4, 6, -1.2, 3]], [0.5], 0.9);
  expect((line.positions[6] + line.positions[9]) / 2).toBeCloseTo(-2.8);
  expect((line.positions[7] + line.positions[10]) / 2).toBeCloseTo(4.5);
});

it.each(["succeeded", "cancelled", "failed"] as const)("passes the shared %s display color unchanged to the native shader", flash => {
  const r = renderer();
  r.value.apply({ selected: false, dragging: false, following: false, aiming: false,
    flash, feedbackProgress: 1 }, 0, 1000);
  expect(r.outcomeRing.triangles.mock.calls[0][2]).toEqual([...NAVIGATION_COLORS[flash], 1]);
  expect(r.glyph.triangles.mock.calls[0][2]).toEqual([...NAVIGATION_COLORS[flash], 1]);
});

function coversPoint(points: number[], indices: number[], x: number, y: number): boolean {
  const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const signs = [cross(points[b] - points[a], points[b + 1] - points[a + 1], x - points[a], y - points[a + 1]),
      cross(points[c] - points[b], points[c + 1] - points[b + 1], x - points[b], y - points[b + 1]),
      cross(points[a] - points[c], points[a + 1] - points[c + 1], x - points[c], y - points[c + 1])];
    if (signs.every(v => v >= -1e-8) || signs.every(v => v <= 1e-8)) return true;
  }
  return false;
}
it.each([
  [[[-4.4, 6, -1.2, 3], [-1.2, 3, 5, 9.6]], 0.9, -1.2, 3],
  [[[-7, 0, -1.5, -5.5], [-1.5, -5.5, 9, 7]], 1.2, -1.5, -5.5],
] as const)("fills the checkmark's outside elbow without introducing a dot before the next stroke", (segments, width, x, y) => {
  const elbow = y - width * 0.375;
  const pending = strokeMesh2D(segments, [1, 0], width);
  expect(coversPoint(pending.positions, pending.indices, x, elbow)).toBe(false);
  const complete = strokeMesh2D(segments, [1, 1], width);
  expect(coversPoint(complete.positions, complete.indices, x, elbow)).toBe(true);
});
