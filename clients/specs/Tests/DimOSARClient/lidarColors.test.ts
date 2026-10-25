import { expect, it } from "vitest";
import { lidarHeightColor, lidarObstacleIntensity } from "../../Assets/Scripts/DimOSARClient/sensors/lidarColors";
it("clamps a stable height spectrum and computes obstacle distance from the robot pose", () => {
  expect(lidarHeightColor(-1)).toEqual(lidarHeightColor(0)); expect(lidarHeightColor(2)).toEqual(lidarHeightColor(1));
  expect(lidarHeightColor(0.5)[1]).toBeGreaterThan(lidarHeightColor(0.5)[2]);
  expect(lidarObstacleIntensity([2, 3, 0.33], [2, 3, 0.33], 0.5)).toBe(0);
  expect(lidarObstacleIntensity([2, 3, 0.8], [2, 3, 0.33], 0.5)).toBe(0);
  expect(lidarObstacleIntensity([2.3, 3.4, 0.33], [2, 3, 0.33], 0.5)).toBeCloseTo(1);
});

it("preserves native sensor distances after a fixed wire XY heuristic", async () => {
  const { lidarBodyClearance } = await import("../../Assets/Scripts/DimOSARClient/sensors/lidarColors");
  const robot = [5, -2.5, 0.33] as [number, number, number];
  const point = [5.75, -1.5, 0.7] as [number, number, number];
  expect(lidarObstacleIntensity(point, robot, 1, 1.25)).toBeCloseTo(1);
  const native = lidarBodyClearance([4.6, -1.2, 0.7], [4, -2, 0.33], [0, 0, 0, 1], [0.7, 0.5, 0.55]);
  expect(lidarBodyClearance(point, robot, [0, 0, 0, 1], [0.7, 0.5, 0.55], 1.25)).toBeCloseTo(native);
  expect(() => lidarBodyClearance(point, robot, [0, 0, 0, 1], [1, 1, 1], 0)).toThrow();
});
