import { describe, expect, it } from "vitest";
import {
  DEADZONE_EXIT_MARGIN_CM,
  isGroundNormal,
  isInsideRobotDeadzone,
  solveMeshPlacement,
  type RobotGroundDeadzone,
} from "../../Assets/Scripts/App/Navigation/GroundPlacement";

function vec(x: number, y: number, z: number): vec3 {
  return new vec3(x, y, z);
}

describe("isGroundNormal", () => {
  it("accepts ramp normals up to ~65 deg from horizontal", () => {
    expect(isGroundNormal(vec(0, 0.5, 0.866))).toBe(true);
  });

  it("rejects steep wall normals", () => {
    expect(isGroundNormal(vec(0, 0.34, 0.94))).toBe(false);
  });
});

describe("isInsideRobotDeadzone", () => {
  const deadzone: RobotGroundDeadzone = {
    radiusCm: 75,
    getRobotWorldPosition: () => vec(0, 0, 0),
    getRobotFloorWorldY: () => 10,
  };

  it("detects points inside the deadzone radius", () => {
    expect(isInsideRobotDeadzone(vec(50, 0, 0), deadzone, false)).toBe(true);
  });

  it("applies exit hysteresis after entering the deadzone", () => {
    expect(
      isInsideRobotDeadzone(
        vec(80, 0, 0),
        deadzone,
        true,
        DEADZONE_EXIT_MARGIN_CM,
      ),
    ).toBe(true);
    expect(isInsideRobotDeadzone(vec(80, 0, 0), deadzone, false)).toBe(false);
  });
});

describe("solveMeshPlacement", () => {
  const deadzone: RobotGroundDeadzone = {
    radiusCm: 75,
    getRobotWorldPosition: () => vec(0, 0, 0),
    getRobotFloorWorldY: () => 100,
  };

  it("pins Y to robot floor inside the deadzone", () => {
    const result = solveMeshPlacement({
      rayFrom: vec(40, 120, 0),
      rayTo: vec(41, 120, 0),
      hits: [],
      deadzone,
      wasInsideDeadzone: false,
      fallbackY: 50,
    });
    expect(result.status).toBe("ok");
    expect(result.goalPosition?.y).toBe(100);
    expect(result.wasInsideDeadzone).toBe(true);
  });

  it("returns unscanned when the mesh has no hits", () => {
    const result = solveMeshPlacement({
      rayFrom: vec(100, 120, 100),
      rayTo: vec(100, 120, -500),
      hits: [],
      deadzone: null,
      wasInsideDeadzone: false,
      fallbackY: 50,
    });
    expect(result.status).toBe("blocked");
    expect(result.blockReason).toBe("unscanned");
    expect(result.goalPosition).toBeNull();
  });

  it("blocks on the nearest wall hit", () => {
    const result = solveMeshPlacement({
      rayFrom: vec(0, 120, 0),
      rayTo: vec(0, 120, -500),
      hits: [{ position: vec(0, 80, 200), normal: vec(0, 0, 1) }],
      deadzone: null,
      wasInsideDeadzone: false,
      fallbackY: 50,
    });
    expect(result.status).toBe("blocked");
    expect(result.blockReason).toBe("wall");
    expect(result.probePosition).toEqual(vec(0, 80, 200));
  });

  it("accepts the nearest ground hit", () => {
    const result = solveMeshPlacement({
      rayFrom: vec(0, 120, 0),
      rayTo: vec(0, 120, -500),
      hits: [
        { position: vec(0, 20, 300), normal: vec(0, 1, 0) },
        { position: vec(0, 80, 400), normal: vec(0, 0, 1) },
      ],
      deadzone: null,
      wasInsideDeadzone: false,
      fallbackY: 50,
    });
    expect(result.status).toBe("ok");
    expect(result.goalPosition).toEqual(vec(0, 20, 300));
  });

  it("blocks when the nearest hit is a wall even if ground exists farther along the ray", () => {
    const result = solveMeshPlacement({
      rayFrom: vec(0, 120, 0),
      rayTo: vec(0, 120, -500),
      hits: [
        { position: vec(0, 80, 200), normal: vec(0, 0, 1) },
        { position: vec(0, 20, 300), normal: vec(0, 1, 0) },
      ],
      deadzone: null,
      wasInsideDeadzone: false,
      fallbackY: 50,
    });
    expect(result.status).toBe("blocked");
    expect(result.blockReason).toBe("wall");
  });
});
