import { describe, it, expect } from "vitest";
import { scaleIn, scaleOut, nextAnimationVersion, DEFAULT_SCALE_ANIMATION_VERSION_KEY, lerpVec3 } from "../../Assets/Scripts/DimOSSpecsClient/utilities/AnimationUtilities";
import { advanceAnimations, flushAnimations } from "../mocks/animate";
import { exponentialSmoothAlpha, interpolatePose } from "../../Assets/Scripts/DimOSSpecsClient/utilities/RuntimePoseSmoothing";

describe("lerpVec3", () => {
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

it("retired interpolation and completion cannot change a restarted panel", async () => {
  flushAnimations();
  let scale = vec3.zero();
  const panel = { enabled: false, getTransform: () => ({
    getLocalScale: () => scale, setLocalScale: (value: vec3) => { scale = value; },
  }) } as unknown as SceneObject;
  const opening = scaleIn(panel, .5);
  advanceAnimations(.4); expect(scale.x).toBeCloseTo(.4);
  const closing = scaleOut(panel, .5);
  advanceAnimations(.5); expect(scale.x).toBeCloseTo(.2);
  nextAnimationVersion(panel, DEFAULT_SCALE_ANIMATION_VERSION_KEY);
  panel.getTransform().setLocalScale(vec3.one().uniformScale(.75));
  advanceAnimations(.9); expect(scale.x).toBe(.75);
  flushAnimations(); await Promise.all([opening, closing]);
  expect(panel.enabled).toBe(true); expect(scale.x).toBe(.75);
});
