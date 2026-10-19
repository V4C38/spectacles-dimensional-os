import { describe, expect, it } from "vitest";
import { jpegDimensionsMatch, matchStream, parseHmdId } from "../src/camera/HmdCalibration";
import { HMD_PROFILES } from "../src/camera/hmdProfiles";

describe("HmdCalibration", () => {
  it("rejects unknown HMD ids", () => {
    expect(() => parseHmdId("")).toThrow();
    expect(() => parseHmdId("quest2")).toThrow();
  });

  it("rejects unmatched streams and jpeg sizes", () => {
    const profile = HMD_PROFILES.quest3;
    expect(() =>
      matchStream(profile, { width: 640, height: 480, frameRate: 30, facingMode: "environment" }),
    ).toThrow();
    expect(() =>
      matchStream(profile, { width: 1280, height: 960, frameRate: 15, facingMode: "environment" }),
    ).toThrow();
    matchStream(HMD_PROFILES.quest3s, {
      width: 1280,
      height: 960,
      frameRate: 30,
      facingMode: "environment",
    });
    expect(() => jpegDimensionsMatch(profile, 100, 100)).toThrow();
    jpegDimensionsMatch(profile, 1280, 960);
  });
});

import { matchesProfileCamera, profileForStream, requireUsableProfile } from "../src/camera/HmdCalibration";
import { rotateVecByQuat } from "@dimos-ar-client/localization/clientTrackingTransforms";

for (const id of ["quest3", "quest3s"] as const) {
  it(`uses the ${id} device profile`, () => {
    const profile = HMD_PROFILES[id];
    expect(() => requireUsableProfile(profile)).not.toThrow();
    expect(profile.intrinsics.cy).toBeCloseTo(id === "quest3" ? 481.2428589 : 481.9739);
    // A camera on the front left, aimed slightly downward; no optical-axis flip.
    const forward = rotateVecByQuat(profile.T_viewer_optical.orientation, [0, 0, 1]);
    const down = rotateVecByQuat(profile.T_viewer_optical.orientation, [0, 1, 0]);
    expect(forward[2]).toBeLessThan(-0.95);
    expect(forward[1]).toBeLessThan(-0.05);
    expect(down[1]).toBeLessThan(-0.95);
    expect(profile.T_viewer_optical.position[0]).toBeLessThan(0);
    expect(profile.T_viewer_optical.position[2]).toBeLessThan(0);
  });
}

it("binds profiles to the left physical camera and rejects other devices", () => {
  const profile = HMD_PROFILES.quest3;
  for (const label of ["camera 1, facing back", "camera2 1, facing back", "camera 2 1, facing back", "Camera2 50, facing back", "Left physical camera"]) {
    expect(matchesProfileCamera(profile, label)).toBe(true);
  }
  for (const label of ["Avatar camera", "Virtual left camera", "camera 0, facing front", "camera 2, facing back", "camera2 2, facing back", "camera 2 2, facing back", "camera2 0, facing front", "Right camera", "camera2 51, facing back", "", "Webcam"]) {
    expect(matchesProfileCamera(profile, label)).toBe(false);
  }
});

it("adjusts the principal point for the actual 720-row crop without resizing pixels", () => {
  const profile = HMD_PROFILES.quest3;
  const selected = profileForStream(profile, { width: 1280, height: 720, frameRate: 30, facingMode: "environment" });
  expect(selected.intrinsics.fx).toBe(profile.intrinsics.fx);
  expect(selected.intrinsics.cx).toBe(profile.intrinsics.cx);
  expect(selected.intrinsics.cy).toBeCloseTo(profile.intrinsics.cy - 120);
  expect(selected.intrinsics.height).toBe(720);
  expect(profile.intrinsics.height).toBe(960);
  expect(() => profileForStream(profile, { width: 640, height: 480, frameRate: 30 })).toThrow();
});

it("still rejects corrupted and placeholder calibration", () => {
  const p = HMD_PROFILES.quest3;
  expect(() => requireUsableProfile({ ...p, intrinsics: { ...p.intrinsics, fx: 0 } })).toThrow();
  expect(() => requireUsableProfile({ ...p, T_viewer_optical: { position: [0, 0, 0], orientation: [0, 0, 0, 0] } })).toThrow();
  expect(() => requireUsableProfile({ ...p, accepted: true })).not.toThrow();
});
