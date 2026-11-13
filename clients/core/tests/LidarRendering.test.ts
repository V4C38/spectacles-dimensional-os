import { expect, it, vi } from "vitest";
import { LidarFrameSampler } from "../src/sensors/LidarRendering";
import type { Vec3 } from "../src/ClientContracts";

it("samples the same source indices for geometry and colors and caches independent changes", () => {
  const project = vi.fn((point: Readonly<Vec3>) => [...point] as Vec3);
  const sampler = new LidarFrameSampler(project, { maximum: 4, minimum: 0, default: 4 });
  const points: Vec3[] = Array.from({ length: 8 }, (_, i) => [i, 0, i / 4]);
  const origin = {};
  const input = { points, origin, mode: "full" as const };
  const first = sampler.sample(input);
  expect(first.sourceIndices).toEqual([0, 2, 4, 6]);
  expect(first.positions.map(point => point[0])).toEqual([0, 2, 4, 6]);
  const stable = sampler.sample(input);
  expect(stable.positions).toBe(first.positions);
  expect(stable.colors).toBe(first.colors);
  expect(stable.positionsChanged).toBe(false);
  expect(stable.colorsChanged).toBe(false);
  const recolored = sampler.sample({ ...input, robot: [0, 0, 1] });
  expect(recolored.positions).toBe(first.positions);
  expect(recolored.colorsChanged).toBe(true);
  expect(project).toHaveBeenCalledTimes(4);
  expect(sampler.sample({ ...input, origin: {} }).positionsChanged).toBe(true);
});

it("keeps native minimum and browser zero-point limits explicit", () => {
  const points: Vec3[] = [[0, 0, 0], [1, 0, 0]];
  const input = { points, origin: {}, mode: "full" as const, pointLimit: 0 };
  const project = (p: Readonly<Vec3>) => [...p] as Vec3;
  expect(new LidarFrameSampler(project, { maximum: 4000, minimum: 0, default: 4000 }).sample(input).positions).toHaveLength(0);
  expect(new LidarFrameSampler(project, { maximum: 4000, minimum: 250, default: 1500 }).sample(input).positions).toHaveLength(2);
});

it("invalidates only colors for rotated bounds and native odometry scale corrections", () => {
  const sampler = new LidarFrameSampler((p: Readonly<Vec3>) => [...p] as Vec3,
    { maximum: 4000, minimum: 0, default: 4000 });
  const input = { points: [[6, -2.5, 0.4]] as Vec3[], origin: {}, mode: "obstacles" as const,
    robot: [5, -2.5, .33] as Vec3, bounds: [1, .4, .5] as Vec3, odomScaleCorrectionFactor: 1.25 };
  const corrected = sampler.sample(input);
  expect(corrected.colors[0][3]).toBeCloseTo(.5);
  const native = sampler.sample({ ...input, odomScaleCorrectionFactor: 1 });
  expect(native.positions).toBe(corrected.positions);
  expect(native.colors[0][3]).toBeLessThan(corrected.colors[0][3]);
  expect(native.positionsChanged).toBe(false);
  const rotated = sampler.sample({ ...input, orientation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] });
  expect(rotated.colorsChanged).toBe(true);
  sampler.clear();
  expect(sampler.sample(input).positionsChanged).toBe(true);
});
