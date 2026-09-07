import { describe, it, expect } from "vitest";
import { yawRotationFromPlanarDirection } from "../../Assets/Scripts/App/Utilities/Utilities";

describe("yawRotationFromPlanarDirection cross-language convention", () => {
  for (const [x, z] of [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0.5, -0.5],
    [-0.3, 0.7],
  ] as const) {
    it(`matches closed form for (${x},${z})`, () => {
      const q = yawRotationFromPlanarDirection(x, z);
      const yaw = Math.atan2(-z, x);
      expect(q.w).toBeCloseTo(Math.cos(yaw / 2), 9);
      expect(q.x).toBeCloseTo(0, 9);
      expect(q.y).toBeCloseTo(Math.sin(yaw / 2), 9);
      expect(q.z).toBeCloseTo(0, 9);
    });
  }
});
