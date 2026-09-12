import { describe, expect, it } from "vitest";
import { filletPathCorners, rangePathY } from "../../Assets/Scripts/DimosARClient/navigation/NavGoalPresenter";

function vec(x: number, y: number, z: number): vec3 {
  return new vec3(x, y, z);
}

describe("filletPathCorners", () => {
  it("leaves a 2-point path unchanged", () => {
    const points = [vec(0, 0, 0), vec(10, 0, 0)];
    const filleted = filletPathCorners(points);
    expect(filleted).toHaveLength(2);
    expect(filleted[0].x).toBe(0);
    expect(filleted[0].z).toBe(0);
    expect(filleted[1].x).toBe(10);
    expect(filleted[1].z).toBe(0);
  });

  it("adds fillet points at a sharp 90 degree corner", () => {
    const points = [vec(0, 0, 0), vec(10, 0, 0), vec(10, 0, 10)];
    const filleted = filletPathCorners(points);
    expect(filleted.length).toBeGreaterThan(points.length);
    expect(filleted[0].x).toBe(0);
    expect(filleted[0].z).toBe(0);
    expect(filleted[filleted.length - 1].x).toBe(10);
    expect(filleted[filleted.length - 1].z).toBe(10);
  });
});

describe("rangePathY", () => {
  it("keeps points unchanged when floorY or goalY is missing", () => {
    const points = [vec(0, 5, 0), vec(10, 5, 0)];
    expect(rangePathY(points, null, 20)).toBe(points);
    expect(rangePathY(points, 0, null)).toBe(points);
  });

  it("uses arc length so clustered points do not bunch Y", () => {
    const points = [vec(0, 0, 0), vec(1, 0, 0), vec(2, 0, 0), vec(100, 0, 0)];
    const ranged = rangePathY(points, 0, 100);
    expect(ranged[0].y).toBeCloseTo(0);
    expect(ranged[2].y).toBeCloseTo(2);
    expect(ranged[3].y).toBeCloseTo(100);
  });
});
