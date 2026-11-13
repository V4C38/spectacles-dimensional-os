import { describe, it, expect } from "vitest";
import { scaleIn, scaleOut, nextAnimationVersion, DEFAULT_SCALE_ANIMATION_VERSION_KEY, lerpVec3 } from "../../Assets/Scripts/DimOSSpecsClient/utilities/AnimationUtilities";
import { advanceAnimations, flushAnimations } from "../mocks/animate";
import { exponentialSmoothAlpha, interpolatePose, RuntimePoseSmoothing } from "../../Assets/Scripts/DimOSSpecsClient/utilities/RuntimePoseSmoothing";

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
  it("adapts shared shortest-arc interpolation back to native quaternion order", () => {
    const result = interpolatePose(vec3.zero(), new vec3(10, 20, 30), quat.quatIdentity(),
      new quat(-Math.SQRT1_2, 0, -Math.SQRT1_2, 0), Math.log(2), 1);
    expect([result.position.x, result.position.y, result.position.z]).toEqual([5, 10, 15]);
    expect(result.rotation.w).toBeCloseTo(Math.cos(Math.PI / 8));
    expect(result.rotation.y).toBeCloseTo(Math.sin(Math.PI / 8));
  });

  it("does not advance runtime tracking without a positive frame delta", () => {
    const smoothing = new RuntimePoseSmoothing();
    smoothing.setTarget({ position: new vec3(5, 5, 5), rotation: quat.quatIdentity() }, false);
    const current = { position: vec3.zero(), rotation: quat.quatIdentity() };
    expect(smoothing.tick(current, 0)).toBeNull();
    expect(smoothing.tick(current, -1)).toBeNull();
  });

  it("returns target when dt is zero", () => {
    const pos = new vec3(0, 0, 0);
    const targetPos = new vec3(5, 5, 5);
    const rot = quat.quatIdentity();
    const targetRot = new quat(0.707, 0, 0.707, 0);
    const result = interpolatePose(pos, targetPos, rot, targetRot, 0, 10);
    expect(result.position).toEqual(targetPos);
    expect(result.rotation.w).toBe(targetRot.w);
    expect(result.rotation.y).toBe(targetRot.y);
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
