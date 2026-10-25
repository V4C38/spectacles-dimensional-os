import { describe, expect, it } from "vitest";
import { filletPathCorners, rangePathY } from "../src/navigation/RoutePathGeometry";

describe("routePath", () => {
  it("fillets sharp corners and ranges Y from floor to goal", () => {
    const filleted = filletPathCorners([
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
    ]);
    expect(filleted.length).toBeGreaterThan(3);
    const ranged = rangePathY(
      [
        [0, 9, 0],
        [1, 9, 0],
      ],
      0,
      0.4,
    );
    expect(ranged[0][1]).toBeCloseTo(0);
    expect(ranged[1][1]).toBeCloseTo(0.4);
  });
});

import { anchorPathStart, clipPathToCircles, routeRibbon } from "../src/navigation/RoutePathGeometry";
it("trims across short segments to both circle boundaries and suppresses overlapping circles", () => {
  const points: import("@dimos-ar-client/websocket/protocolTypes").Vec3[] = [[0, 0, 0], [0.02, 0, 0], [0.04, 0, 0], [1, 0, 0]];
  const clipped = clipPathToCircles(points, { center: [0, 0, 0], radius: 0.06 }, { center: [1, 0, 0], radius: 0.268 });
  expect(clipped[0][0]).toBeCloseTo(0.06); expect(clipped.at(-1)![0]).toBeCloseTo(0.732);
  expect(clipPathToCircles([[0, 0, 0], [0.1, 0, 0]], { center: [0, 0, 0], radius: 0.06 }, { center: [0.1, 0, 0], radius: 0.268 })).toEqual([]);
  expect(anchorPathStart([[0, 0, 0], [1, 0, 0], [2, 0, 0]], [1.5, 0, 0])).toEqual([[1.5, 0, 0], [2, 0, 0]]);
});

it("shares ribbon vertices at dense joins and preserves physical width", () => {
  const points: import("@dimos-ar-client/websocket/protocolTypes").Vec3[] = Array.from({ length: 100 }, (_, i) => [i / 100, 0, 0]);
  const { positions, indices } = routeRibbon(points, 0.008);
  expect(indices.slice(0, 12)).toEqual([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4]);
  for (let i = 0; i < points.length; i++) expect(Math.abs(positions[i * 6 + 2] - positions[i * 6 + 5])).toBeCloseTo(0.008);
  expect(routeRibbon([[0, 0, 0], [0, 0, 0]], 0.008).positions).toEqual([]);
});
