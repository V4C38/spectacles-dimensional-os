import { describe, it, expect } from "vitest";
import {
  cloneQuat,
  cloneVec3,
  vec3Distance,
  quatAngularDistanceRad,
  quatFromMat4Rotation,
  yawRotationFromWorldRotation,
} from "../../Assets/Scripts/Core/Utilities";
import { vec3, quat, mat4 } from "../shims/lens-runtime";

describe("cloneQuat and cloneVec3", () => {
  it("returns equal components in new instances", () => {
    const q = new quat(0.7, 0, 0.7, 0);
    const clonedQ = cloneQuat(q);
    expect(clonedQ).not.toBe(q);
    expect(clonedQ.w).toBe(q.w);
    expect(clonedQ.x).toBe(q.x);
    expect(clonedQ.y).toBe(q.y);
    expect(clonedQ.z).toBe(q.z);

    const v = new vec3(1, 2, 3);
    const clonedV = cloneVec3(v);
    expect(clonedV).not.toBe(v);
    expect(clonedV.x).toBe(1);
    expect(clonedV.y).toBe(2);
    expect(clonedV.z).toBe(3);
  });
});

describe("vec3Distance", () => {
  it("computes Euclidean distance", () => {
    expect(vec3Distance(new vec3(0, 0, 0), new vec3(3, 4, 0))).toBe(5);
  });
});

describe("quatAngularDistanceRad", () => {
  it("returns zero for identical quaternions", () => {
    const q = new quat(1, 0, 0, 0);
    expect(quatAngularDistanceRad(q, cloneQuat(q))).toBeCloseTo(0, 9);
  });

  it("returns pi for opposite orientations", () => {
    const identity = new quat(1, 0, 0, 0);
    const flipped = new quat(0, 0, 1, 0);
    expect(quatAngularDistanceRad(identity, flipped)).toBeCloseTo(Math.PI, 5);
  });
});

describe("quatFromMat4Rotation", () => {
  it("extracts a 90 degree Y rotation", () => {
    const m = mat4.fromRotationY(Math.PI / 2);
    const q = quatFromMat4Rotation(m);
    const expected = new quat(Math.cos(Math.PI / 4), 0, Math.sin(Math.PI / 4), 0);
    expect(quatAngularDistanceRad(q, expected)).toBeCloseTo(0, 4);
  });
});

describe("yawRotationFromWorldRotation", () => {
  it("preserves yaw-only world rotation", () => {
    const yawOnly = new quat(Math.cos(Math.PI / 4), 0, Math.sin(Math.PI / 4), 0);
    const extracted = yawRotationFromWorldRotation(yawOnly);
    expect(quatAngularDistanceRad(extracted, yawOnly)).toBeCloseTo(0, 4);
  });

  it("returns identity for near-vertical forward", () => {
    const half = Math.PI / 4;
    const vertical = new quat(Math.cos(half), 0, 0, Math.sin(half));
    const extracted = yawRotationFromWorldRotation(vertical);
    expect(extracted.w).toBeCloseTo(1, 3);
    expect(extracted.x).toBeCloseTo(0, 3);
    expect(extracted.y).toBeCloseTo(0, 3);
    expect(extracted.z).toBeCloseTo(0, 3);
  });
});
