import { describe, expect, it } from "vitest";
import {
  HMD_OPTIONS,
  hmdLabel,
  jpegDimensionsMatch,
  matchStream,
  parseHmdId,
  requireAcceptedProfile,
} from "../src/camera/HmdCalibration";
import { HMD_PROFILES, profileForHmd } from "../src/camera/hmdProfiles";

describe("HmdCalibration", () => {
  it("exposes Quest 3 and Quest 3S as the current HMD options", () => {
    expect(HMD_OPTIONS.map((option) => option.id)).toEqual(["quest3", "quest3s"]);
    expect(parseHmdId("quest3")).toBe("quest3");
    expect(parseHmdId("quest3s")).toBe("quest3s");
    expect(hmdLabel("quest3")).toBe("Quest 3");
    expect(() => parseHmdId("")).toThrow("select an HMD");
    expect(() => parseHmdId("quest2")).toThrow("select an HMD");
    expect(profileForHmd("quest3s").id).toBe("quest3s");
  });

  it("rejects unmatched streams and unaccepted profiles", () => {
    const profile = HMD_PROFILES.quest3;
    expect(() =>
      matchStream(profile, { width: 640, height: 480, frameRate: 30, facingMode: "environment" }),
    ).toThrow("does not match");
    expect(() =>
      matchStream(profile, { width: 1280, height: 960, frameRate: 15, facingMode: "environment" }),
    ).toThrow("frameRate");
    matchStream(HMD_PROFILES.quest3s, {
      width: 1280,
      height: 960,
      frameRate: 30,
      facingMode: "environment",
    });
    expect(() => requireAcceptedProfile(profile)).toThrow("camera calibration has not been measured yet");
    expect(() => jpegDimensionsMatch(profile, 100, 100)).toThrow("JPEG");
    jpegDimensionsMatch(profile, 1280, 960);
  });
});
