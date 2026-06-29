import { describe, it, expect } from "vitest";
import {
  exponentialSmoothAlpha,
  interpolatePose,
  isLatestAnimationVersion,
  lerpVec3,
  nextAnimationVersion,
  smoothScalar,
} from "../../Assets/Scripts/App/Utilities/AnimationUtilities";

describe("lerpVec3", () => {
  it("interpolates at t=0 and t=1", () => {
    const a = new vec3(0, 0, 0);
    const b = new vec3(10, 20, 30);
    expect(lerpVec3(a, b, 0)).toEqual(a);
    expect(lerpVec3(a, b, 1)).toEqual(b);
  });

  it("interpolates at midpoint", () => {
    const a = new vec3(0, 0, 0);
    const b = new vec3(10, 20, 30);
    const mid = lerpVec3(a, b, 0.5);
    expect(mid.x).toBe(5);
    expect(mid.y).toBe(10);
    expect(mid.z).toBe(15);
  });
});

describe("exponentialSmoothAlpha", () => {
  it("returns 1 when dt is zero", () => {
    expect(exponentialSmoothAlpha(0, 10)).toBe(1);
  });

  it("increases with dt and rate", () => {
    const low = exponentialSmoothAlpha(0.016, 5);
    const high = exponentialSmoothAlpha(0.016, 20);
    expect(high).toBeGreaterThan(low);
    expect(low).toBeGreaterThan(0);
    expect(low).toBeLessThan(1);
  });
});

describe("smoothScalar", () => {
  it("snaps to target when dt is zero", () => {
    expect(smoothScalar(1, 5, 0, 10)).toBe(5);
  });

  it("moves toward target when dt is positive", () => {
    const result = smoothScalar(0, 10, 0.016, 10);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(10);
  });
});

describe("interpolatePose", () => {
  it("returns target when dt is zero", () => {
    const pos = new vec3(0, 0, 0);
    const targetPos = new vec3(5, 5, 5);
    const rot = quat.quatIdentity();
    const targetRot = new quat(0.707, 0, 0.707, 0);
    const result = interpolatePose(pos, targetPos, rot, targetRot, 0, 10);
    expect(result.position).toEqual(targetPos);
    expect(result.rotation.w).toBeCloseTo(targetRot.w, 5);
  });
});

describe("animation version tokens", () => {
  it("increments and validates latest version", () => {
    const store: { [key: string]: number } = {};
    const key = "testVersion";
    const v1 = nextAnimationVersion(store, key);
    expect(v1).toBe(1);
    expect(isLatestAnimationVersion(store, key, v1)).toBe(true);
    const v2 = nextAnimationVersion(store, key);
    expect(v2).toBe(2);
    expect(isLatestAnimationVersion(store, key, v1)).toBe(false);
    expect(isLatestAnimationVersion(store, key, v2)).toBe(true);
  });
});
