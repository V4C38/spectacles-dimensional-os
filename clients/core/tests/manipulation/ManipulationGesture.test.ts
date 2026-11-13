import { expect, it } from "vitest";
import { ManipulationGesture } from "../../src/manipulation/ManipulationGesture";
import type { ManipulationPose } from "../../src/manipulation/ManipulationTypes";
const pose = (x: number): ManipulationPose => ({ position: [x, 0, 0], orientation: [0, 0, 0, 1] });
it("preserves grab offset, updates immediately, and retires capture", () => {
  const gesture = new ManipulationGesture();
  gesture.begin(pose(1), pose(2), 0);
  expect(gesture.hold(pose(1), 0)).toEqual(pose(2));
  expect(gesture.hold(pose(2), 0.1)?.position[0]).toBeCloseTo(3);
  gesture.end();
  expect(gesture.hold(pose(3), 1)).toBeNull();
});
it("rotates the grab offset with the hand", () => {
  const gesture = new ManipulationGesture();
  gesture.begin(pose(0), pose(1), 0);
  const result = gesture.hold({ position: [0, 0, 0], orientation: [0, 0, 1, 0] }, 0.1)!;
  expect(result.position[0]).toBeCloseTo(-1);
  expect(Math.hypot(...result.orientation)).toBeCloseTo(1);
});

it("rebases a held target across corrections without changing its robot coordinates", () => {
  const gesture = new ManipulationGesture();
  const previous = { ...pose(0), confidence: 1, ts: 1 };
  const next = { ...pose(1), confidence: 1, ts: 2 };
  gesture.begin(pose(0), pose(2), 0);
  gesture.rebase(previous, next);
  expect(gesture.hold(pose(0), 1)?.position[0]).toBeCloseTo(1);
  expect(gesture.hold(pose(0.2), 1.1)?.position[0]).toBeCloseTo(1.2);
});
