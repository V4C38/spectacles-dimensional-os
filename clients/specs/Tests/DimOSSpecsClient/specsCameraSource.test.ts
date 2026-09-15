import { describe, expect, it } from "vitest";
import { quat, vec3 } from "../shims/lens-runtime";
import {
  lookupPoseSample,
  scaleCameraIntrinsics,
  type PoseSample,
} from "../../Assets/Scripts/DimOSSpecsClient/localization/SpecsCameraSource";

function sample(t: number, x: number, y: number, z: number): PoseSample {
  return {
    t,
    position: new vec3(x, y, z),
    rotation: new quat(1, 0, 0, 0),
  };
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
