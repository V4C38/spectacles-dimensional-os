import { expect, it } from "vitest";
import { lidarHeightColor, lidarObstacleIntensity } from "../../Assets/Scripts/DimOSARClient/sensors/lidarColors";
it("clamps a stable height spectrum and computes obstacle distance from the robot pose", () => {
  expect(lidarHeightColor(-1)).toEqual(lidarHeightColor(0)); expect(lidarHeightColor(2)).toEqual(lidarHeightColor(1));
  expect(lidarHeightColor(0.5)[1]).toBeGreaterThan(lidarHeightColor(0.5)[2]);
  expect(lidarObstacleIntensity([2, 3, 0.33], [2, 3, 0.33], 0.5)).toBe(0);
  expect(lidarObstacleIntensity([2, 3, 0.8], [2, 3, 0.33], 0.5)).toBe(0);
  expect(lidarObstacleIntensity([2.3, 3.4, 0.33], [2, 3, 0.33], 0.5)).toBeCloseTo(1);
});
