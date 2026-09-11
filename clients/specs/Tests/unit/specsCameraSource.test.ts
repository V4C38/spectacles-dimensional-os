import { describe, expect, it } from "vitest";
import { quat, vec3 } from "../shims/lens-runtime";
import {
  composeDeviceOptical,
  lookupPoseSample,
  scaleCameraIntrinsics,
  specsWorldPoseToTracking,
  type PoseSample,
} from "../../Assets/Scripts/DimosARClient/localization/SpecsCameraSource";
import { specsToClientTrackingPose } from "../../Assets/Scripts/DimosARClient/SpecsCoordinates";
import type { Quat, Vec3 } from "../../Assets/Scripts/DimosARClient/core/websocket/protocolTypes";

function sample(t: number, x: number, y: number, z: number): PoseSample {
  return {
    t,
    position: new vec3(x, y, z),
    rotation: new quat(1, 0, 0, 0),
  };
}

function expectVec3(actual: Vec3, expected: Vec3): void {
  expect(actual[0]).toBeCloseTo(expected[0], 6);
  expect(actual[1]).toBeCloseTo(expected[1], 6);
  expect(actual[2]).toBeCloseTo(expected[2], 6);
}

function expectQuat(actual: Quat, expected: Quat): void {
  const sign = actual[3] * expected[3] < 0 ? -1 : 1;
  expect(actual[0]).toBeCloseTo(expected[0] * sign, 6);
  expect(actual[1]).toBeCloseTo(expected[1] * sign, 6);
  expect(actual[2]).toBeCloseTo(expected[2] * sign, 6);
  expect(actual[3]).toBeCloseTo(expected[3] * sign, 6);
}

describe("lookupPoseSample", () => {
  it("interpolates position between samples", () => {
    const pose = lookupPoseSample([sample(0, 0, 0, 0), sample(2, 10, 0, 0)], 1);
    expect(pose).not.toBeNull();
    expect(pose!.t).toBe(1);
    expect(pose!.position.x).toBeCloseTo(5, 6);
  });

  it("returns null when the nearest sample is stale", () => {
    expect(lookupPoseSample([sample(0, 0, 0, 0)], 0.2)).toBeNull();
  });

  it("returns the nearest sample within 0.1 s", () => {
    const pose = lookupPoseSample([sample(1, 3, 0, 0)], 1.05);
    expect(pose).not.toBeNull();
    expect(pose!.position.x).toBeCloseTo(3, 6);
  });
});

describe("scaleCameraIntrinsics", () => {
  it("scales fx fy cx cy to the JPEG texture size", () => {
    const deviceCamera = {
      resolution: { x: 200, y: 100 },
      focalLength: { x: 50, y: 40 },
      principalPoint: { x: 100, y: 50 },
    };
    const texture = { getWidth: () => 100, getHeight: () => 50 };
    expect(scaleCameraIntrinsics(deviceCamera as DeviceCamera, texture as Texture)).toEqual({
      fx: 25,
      fy: 20,
      cx: 50,
      cy: 25,
      width: 100,
      height: 50,
      distortion_model: "none",
      distortion: [],
    });
  });
});

describe("composeDeviceOptical", () => {
  it("uses the device pose when extrinsics are missing", () => {
    const device = sample(0, 1, 2, 3);
    const optical = composeDeviceOptical(device, null);
    expect(optical.position.x).toBe(1);
    expect(optical.position.y).toBe(2);
    expect(optical.position.z).toBe(3);
  });
});

describe("specsWorldPoseToTracking", () => {
  it("converts a known Specs pose into the client tracking frame", () => {
    const tracking = specsWorldPoseToTracking(new vec3(0, 0, 100), new quat(1, 0, 0, 0));
    const expected = specsToClientTrackingPose({
      position: [0, 0, 100],
      orientation: [0, 0, 0, 1],
    });
    expectVec3(tracking.position, expected.position);
    expectQuat(tracking.orientation, expected.orientation);
  });
});
