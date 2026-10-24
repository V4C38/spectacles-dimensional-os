import { describe, expect, it } from "vitest";
import {
  intersectRayPlanes,
  navigationSurfaceHits,
  type FloorPlane,
  isGroundNormal,
  planeNormalFromPose,
  solveMeshPlacement,
} from "../src/navigation/WebXRGroundPlacement";

describe("WebXRGroundPlacement", () => {
  it("accepts floor-normal hits, rejects walls and falls back when no floor exists", () => {
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
    expect(empty.status).toBe("ok");
    expect(empty.goalPosition).toEqual([0, 0, -2]);
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


it("uses finite floor polygons, accepts unlabelled floors near the robot and rejects elevated surfaces", () => {
  const from: [number, number, number] = [0, 1.5, 0];
  const direction: [number, number, number] = [0, -1, -1];
  const floor: FloorPlane = { position: [0, 0, 0], normal: [0, 1, 0], label: "floor",
    polygon: [[-1, 0, -2], [1, 0, -2], [1, 0, -1], [-1, 0, -1]] };
  expect(navigationSurfaceHits(from, direction, [floor], 0)[0].position).toEqual([0, 0, -1.5]);
  const outside = navigationSurfaceHits([3, 1.5, 0], direction, [floor], 0);
  expect(outside[0].label).toBe("unscanned");
  for (const label of ["table", "ceiling", undefined]) {
    const hits = navigationSurfaceHits(from, direction, [{ position: [0, 0.8, 0], normal: [0, 1, 0], label }], 0);
    expect(solveMeshPlacement({ rayFrom: from, rayTo: [0, -10, -10], hits, deadzone: null, wasInsideDeadzone: false, fallbackY: 0 }).status).toBe("blocked");
  }
  const hits = navigationSurfaceHits(from, direction, [{ position: [0, 0.05, 0], normal: [0, 1, 0] }], 0);
  expect(solveMeshPlacement({ rayFrom: from, rayTo: [0, -10, -10], hits, deadzone: null, wasInsideDeadzone: false, fallbackY: 0 }).status).toBe("ok");
});

it("honors a wall before detected floors and before the flat-floor fallback, even near the robot", () => {
  const wall: FloorPlane = { position: [0, 0, -0.5], normal: [0, 0, 1], label: "wall" };
  for (const planes of [[wall], [wall, { position: [0, 0, 0], normal: [0, 1, 0], label: "floor" } as FloorPlane]]) {
    const hits = navigationSurfaceHits([0, 1.5, 0], [0, -1, -1], planes, 0);
    expect(hits[0].label).toBe("wall");
    const result = solveMeshPlacement({ rayFrom: [0, 1.5, 0], rayTo: [0, -10, -10], hits,
      deadzone: { radiusM: 2, getRobotWorldPosition: () => [0, 0, 0], getRobotFloorWorldY: () => 0 },
      wasInsideDeadzone: false, fallbackY: 0 });
    expect(result.status).toBe("blocked");
  }
});

it("honors the same five-meter ray limit for detected floors and flat-floor fallback", () => {
  for (const distance of [4.99, 5.01]) {
    const z = -Math.sqrt(distance * distance - 1);
    const factor = 5 / distance;
    const args = { rayFrom: [0, 1, 0] as [number, number, number], rayTo: [0, 1 - factor, z * factor] as [number, number, number], deadzone: null, wasInsideDeadzone: false, fallbackY: 0 };
    for (const hits of [[], [{ position: [0, 0, z] as [number, number, number], normal: [0, 1, 0] as [number, number, number], label: "floor" }]]) {
      expect(solveMeshPlacement({ ...args, hits }).status).toBe(distance < 5 ? "ok" : "blocked");
    }
  }
});
