import { expect, it } from "vitest";
import { roundedSurfaceGeometry } from "../src/presentation/RoundedSurfaceGeometry";

it("adds exactly one millimeter behind the glass without a competing front cap", () => {
  const geometry = roundedSurfaceGeometry(0.9, 0.76, 0.05, 0.001);
  geometry.computeBoundingBox();
  expect(geometry.boundingBox!.min.z).toBeCloseTo(-0.001); expect(geometry.boundingBox!.max.z).toBeCloseTo(0);
  const normals = geometry.getAttribute("normal"), index = geometry.getIndex()!;
  for (let i = 0; i < index.count; i += 3) expect([0, 1, 2].every(offset => normals.getZ(index.getX(i + offset)) > 0.99)).toBe(false);
  geometry.dispose();
});
