import { describe, expect, it } from "vitest";
import { CapturePoseHistory, lookupPoseSample, type PoseSample } from "../../src/localization/CapturePoseHistory";

const pose = (t: number, x = t): PoseSample => ({ t, position: [x, 0, 0], orientation: [0, 0, 0, 1] });
const strict = { maxNearestAgeS: .1, maxBracketAgeS: .1 };

describe("exposure-time pose history", () => {
  it("interpolates a fresh bracket and preserves exact sample timestamps", () => {
    const result = lookupPoseSample([pose(1), pose(1.1)], 1.05, strict)!;
    expect(result.t).toBe(1.05);
    expect(result.position[0]).toBeCloseTo(1.05);
    expect(result.orientation).toEqual([0, 0, 0, 1]);
    expect(lookupPoseSample([pose(1)], 1, strict)?.t).toBe(1);
  });
  it("keeps each host's bracket policy distinct from nearest extrapolation", () => {
    const samples = [pose(1), pose(2)];
    expect(lookupPoseSample(samples, 1.5, strict)).toBeNull();
    expect(lookupPoseSample(samples, 1.5, { ...strict, maxBracketAgeS: Infinity })?.position[0]).toBe(1.5);
    expect(lookupPoseSample(samples, 2.11, strict)).toBeNull();
    expect(lookupPoseSample(samples, .95, strict)?.t).toBe(1);
    expect(lookupPoseSample([], 1, strict)).toBeNull();
    expect(lookupPoseSample(samples, NaN, strict)).toBeNull();
  });
  it("owns a bounded chronological sequence and retires it on clear", () => {
    const history = new CapturePoseHistory(2, strict);
    const input = pose(1);
    history.sample(input);
    input.position[0] = 50;
    expect(history.latest()?.position[0]).toBe(1);
    history.sample(pose(1, 2));
    expect(history.read(1)?.position[0]).toBe(2);
    history.sample(pose(1.1));
    history.sample(pose(1.2));
    expect(history.read(1)).toBeNull();
    expect(() => history.sample(pose(1))).toThrow("must not decrease");
    history.clear();
    expect(history.latest()).toBeNull();
    expect(history.read(1.2)).toBeNull();
  });
});
