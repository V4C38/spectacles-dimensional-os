import { describe, expect, it } from "vitest";
import {
  intersectRayPlanes,
  isGroundNormal,
  planeNormalFromPose,
  solveMeshPlacement,
} from "../src/navigation/WebXRGroundPlacement";

describe("WebXRGroundPlacement", () => {
  it("accepts floor-normal hits and rejects walls and empty hits", () => {
    expect(isGroundNormal([0, 1, 0])).toBe(true);
    expect(isGroundNormal([1, 0, 0])).toBe(false);
    const floor = solveMeshPlacement({
      rayFrom: [0, 1.5, 0],
      rayTo: [0, 0, -2],
      hits: [{ position: [0, 0, -1], normal: [0, 1, 0] }],
      deadzone: null,
      wasInsideDeadzone: false,
      fallbackY: 0,
    });
    expect(floor.status).toBe("ok");
    const wall = solveMeshPlacement({
      rayFrom: [0, 1.5, 0],
      rayTo: [0, 1.5, -2],
      hits: [{ position: [0, 1.5, -1], normal: [0, 0, 1] }],
      deadzone: null,
      wasInsideDeadzone: false,
      fallbackY: 0,
    });
    expect(wall.status).toBe("blocked");
    expect(wall.blockReason).toBe("wall");
    const empty = solveMeshPlacement({
      rayFrom: [0, 1.5, 0],
      rayTo: [0, 0, -2],
      hits: [],
      deadzone: null,
      wasInsideDeadzone: false,
      fallbackY: 0,
    });
    expect(empty.blockReason).toBe("unscanned");
  });

  it("intersects a ray with the pointed floor plane, not the plane origin", () => {
    const hit = intersectRayPlanes([0, 1.5, 0], [0, -1, -1], [{ position: [10, 0, 10], normal: [0, 1, 0] }]);
    expect(hit).not.toBeNull();
    expect(hit!.position[1]).toBeCloseTo(0);
    expect(hit!.position[0]).toBeCloseTo(0);
    expect(hit!.position[2]).toBeCloseTo(-1.5);
    expect(intersectRayPlanes([0, 1.5, 0], [0, 1, 0], [{ position: [0, 0, 0], normal: [0, 1, 0] }])).toBeNull();
  });

  it("derives a floor normal from an XRPlane Y-up pose", () => {
    const normal = planeNormalFromPose([0, 0, 0, 1]);
    expect(isGroundNormal(normal)).toBe(true);
  });
});
