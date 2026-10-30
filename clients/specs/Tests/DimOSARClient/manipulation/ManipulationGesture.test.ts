import { expect, it } from "vitest";
import { ManipulationGesture } from "../../../Assets/Scripts/DimOSARClient/manipulation/ManipulationGesture";
import type { ManipulationPose } from "../../../Assets/Scripts/DimOSARClient/manipulation/ManipulationTypes";
const pose = (x: number): ManipulationPose => ({ position: [x, 0, 0], orientation: [0, 0, 0, 1] });
it("preserves grab offset, smooths motion, and retires capture", () => {
  const gesture = new ManipulationGesture();
  gesture.begin(pose(1), pose(2), 0);
  expect(gesture.hold(pose(1), 0)).toEqual(pose(2));
  expect(gesture.hold(pose(2), 0.1)?.position[0]).toBeCloseTo(3 - Math.exp(-1.4));
  gesture.end();
  expect(gesture.hold(pose(3), 1)).toBeNull();
});
it("rotates the grab offset with the hand", () => {
  const gesture = new ManipulationGesture();
  gesture.begin(pose(0), pose(1), 0);
  const result = gesture.hold({ position: [0, 0, 0], orientation: [0, 0, 1, 0] }, 0.1)!;
  expect(result.position[0]).toBeCloseTo(1 - 2 * (1 - Math.exp(-1.4)));
  expect(Math.hypot(...result.orientation)).toBeCloseTo(1);
});
