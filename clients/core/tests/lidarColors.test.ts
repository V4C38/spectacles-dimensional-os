import { expect, it } from "vitest";
import { lidarHeightColor } from "../src/sensors/LidarRendering";
it("clamps a stable height spectrum and computes obstacle distance from the robot pose", () => {
  expect(lidarHeightColor(-1)).toEqual(lidarHeightColor(0)); expect(lidarHeightColor(2)).toEqual(lidarHeightColor(1));
  expect(lidarHeightColor(0.5)[1]).toBeGreaterThan(lidarHeightColor(0.5)[2]);
});

it("measures body clearance in native metres regardless of map translation", async () => {
  const { lidarBodyClearance } = await import("../src/sensors/LidarRendering");
  const bounds = [0.7, 0.5, 0.55] as const;
  const local = lidarBodyClearance([0.6, 0.8, 0.7], [0, 0, 0.33], [0, 0, 0, 1], bounds);
  expect(local).toBeCloseTo(Math.hypot(0.25, 0.55));
  expect(lidarBodyClearance([4.6, -1.2, 0.7], [4, -2, 0.33], [0, 0, 0, 1], bounds)).toBeCloseTo(local);
});
