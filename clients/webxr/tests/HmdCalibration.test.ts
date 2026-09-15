import { describe, expect, it } from "vitest";
import { jpegDimensionsMatch, matchStream, parseHmdId, requireAcceptedProfile } from "../src/camera/HmdCalibration";
import { HMD_PROFILES } from "../src/camera/hmdProfiles";

describe("HmdCalibration", () => {
  it("rejects unknown HMD ids", () => {
    expect(() => parseHmdId("")).toThrow();
    expect(() => parseHmdId("quest2")).toThrow();
  });

  it("rejects unmatched streams and unaccepted profiles", () => {
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
    expect(() => requireAcceptedProfile(profile)).toThrow();
    expect(() => jpegDimensionsMatch(profile, 100, 100)).toThrow();
    jpegDimensionsMatch(profile, 1280, 960);
  });
});
