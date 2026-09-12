import { describe, expect, it } from "vitest";
import { composeLidarPoint } from "../../Assets/Scripts/DimosARClient/sensors/PointCloudRenderer";
import { odomToClientTrackingPoint } from "../../Assets/Scripts/DimosARClient/core/localization/clientTrackingTransforms";
import { clientTrackingToSpecsPoint } from "../../Assets/Scripts/DimosARClient/SpecsCoordinates";
import type { ClientTrackingOrigin } from "../../Assets/Scripts/DimosARClient/core/localization/clientTrackingOrigin";
import type { Vec3 } from "../../Assets/Scripts/DimosARClient/core/websocket/protocolTypes";

const ORIGIN: ClientTrackingOrigin = {
  position: [1, 0, 0],
  orientation: [0, 0, 0, 1],
  confidence: 1,
  ts: 0,
};

function expectVec3(actual: Vec3, expected: Vec3): void {
  expect(actual[0]).toBeCloseTo(expected[0], 6);
  expect(actual[1]).toBeCloseTo(expected[1], 6);
  expect(actual[2]).toBeCloseTo(expected[2], 6);
}

describe("composeLidarPoint", () => {
  it("maps one odom point through tracking then Specs", () => {
    const point: Vec3 = [2, 0, 0];
    expectVec3(
      composeLidarPoint(point, ORIGIN),
      clientTrackingToSpecsPoint(odomToClientTrackingPoint(point, ORIGIN)),
    );
  });
});
