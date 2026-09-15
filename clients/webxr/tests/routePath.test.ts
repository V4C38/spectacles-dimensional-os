import { describe, expect, it } from "vitest";
import { filletPathCorners, rangePathY } from "../src/presentation/routePath";

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
