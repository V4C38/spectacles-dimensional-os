import { describe, expect, it } from "vitest";
import { composePose, inversePose, poseCoordinatesEqual, rotateVecByQuat, slerpQuat } from "../../src/localization/ClientTracking";
import type { Quat } from "../../src/ClientContracts";

describe("shared spatial operations", () => {
  it("composes and inverts rigid transforms without modifying observations", () => {
    const pose = { position: [1, 2, 3], orientation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] } as const;
    const offset = { position: [1, 0, 0], orientation: [0, 0, 0, 1] } as const;
    expect(composePose(pose, offset).position[1]).toBeCloseTo(3);
    const identity = composePose(pose, inversePose(pose));
    for (const v of identity.position) expect(v).toBeCloseTo(0);
    expect(identity.orientation[3]).toBeCloseTo(1);
    expect(pose.position).toEqual([1, 2, 3]);
  });
  it("interpolates shortest arcs with normalized output, including antipodal and close inputs", () => {
    const half = slerpQuat([0, 0, 0, 2], [0, 0, -2, 0], .5);
    expect(Math.hypot(...half)).toBeCloseTo(1);
    expect(rotateVecByQuat(half, [1, 0, 0])[0]).toBeCloseTo(0);
    expect(slerpQuat([0, 0, 0, 1], [0, 0, 0, -1], .5)).toEqual([0, 0, 0, 1]);
    expect(slerpQuat([0, 0, 0, 1], [0, 0, .00001, 1], .5)[2]).toBeCloseTo(.000005);
    expect(slerpQuat([0, 0, 0, 1], [0, 0, 1, 0], 0)).toEqual([0, 0, 0, 1]);
    expect(slerpQuat([0, 0, 0, 1], [0, 0, 1, 0], 1)[2]).toBeCloseTo(1);
  });
  it("rejects unusable interpolation inputs rather than manufacturing an identity", () => {
    for (const q of [[0, 0, 0, 0], [NaN, 0, 0, 1], [Infinity, 0, 0, 1]] as Quat[]) {
      expect(() => slerpQuat(q, [0, 0, 0, 1], .5)).toThrow();
    }
    expect(() => slerpQuat([0, 0, 0, 1], [0, 0, 0, 1], NaN)).toThrow();
  });
  it("supports exact component comparison when the tolerance is zero", () => {
    const pose = { position: [0, 0, 0], orientation: [0, 0, 0, 1] } as const;
    expect(poseCoordinatesEqual(pose, pose, 0)).toBe(true);
    expect(poseCoordinatesEqual(pose, { ...pose, position: [Number.EPSILON, 0, 0] }, 0)).toBe(false);
  });
  it("keeps component identity distinct from equivalent quaternion rotations", () => {
    expect(poseCoordinatesEqual({ position: [0, 0, 0], orientation: [0, 0, 0, 1] },
      { position: [0, 0, 0], orientation: [0, 0, 0, -1] })).toBe(false);
  });
});
