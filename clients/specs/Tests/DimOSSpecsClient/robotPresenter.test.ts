import { describe, expect, it } from "vitest";
import {
  RobotPresenter,
  robotDeadzoneRadiusCm,
  robotFloorOffsetCm,
} from "../../Assets/Scripts/DimOSSpecsClient/presentation/RobotPresenter";
import { clientTrackingToSpecsPoint } from "../../Assets/Scripts/DimOSSpecsClient/utilities/SpecsCoordinates";
import type { RobotDescription, Vec3 } from "../../Assets/Scripts/DimOSARClient/websocket/protocolTypes";

const GO2: RobotDescription = {
  display_name: "Unitree Go2",
  body_bounds_m: [0.7, 0.5, 0.55],
  footprint_m: [0.7, 0.5],
  base_height_m: 0.33,
};

function expectVec3(actual: Vec3, expected: Vec3): void {
  expect(actual[0]).toBeCloseTo(expected[0], 6);
  expect(actual[1]).toBeCloseTo(expected[1], 6);
  expect(actual[2]).toBeCloseTo(expected[2], 6);
}

describe("robotFloorOffsetCm", () => {
  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2])("aligns the floor arrow +X with robot forward at Lens yaw %s", (yaw) => {
    const rotation = new quat(Math.cos(yaw / 2), 0, Math.sin(yaw / 2), 0);
    const presenter = {
      robot: GO2,
      worldPosition: () => new vec3(10, 50, -20),
      worldRotation: () => rotation,
    } as unknown as RobotPresenter;
    const floor = RobotPresenter.prototype.floorPose.call(presenter)!;
    const arrow = floor.rotation.multiplyVec3(new vec3(1, 0, 0));
    const forward = rotation.multiplyVec3(new vec3(0, 0, -1));
    expect(arrow.x).toBeCloseTo(forward.x, 6);
    expect(arrow.z).toBeCloseTo(forward.z, 6);
    expect(floor.position.y).toBeCloseTo(17, 6);
  });

  it("offsets from pose to floor using base_height_m", () => {
    expectVec3(robotFloorOffsetCm(GO2), clientTrackingToSpecsPoint([0, 0, -0.33]));
    expectVec3(robotFloorOffsetCm(GO2), [0, -33, 0]);
  });
});

describe("robotDeadzoneRadiusCm", () => {
  it("uses half the max footprint plus 20 cm, floored at 20", () => {
    expect(robotDeadzoneRadiusCm(GO2)).toBe(55);
    expect(
      robotDeadzoneRadiusCm({
        ...GO2,
        footprint_m: [0.1, 0.1],
      }),
    ).toBe(25);
    expect(
      robotDeadzoneRadiusCm({
        ...GO2,
        footprint_m: [0, 0],
      }),
    ).toBe(20);
  });
});
