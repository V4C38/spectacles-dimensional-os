import { expect, it } from "vitest";
import { HMD_PROFILES, profileForHmd } from "../src/localization/HmdCalibration";
import { acceptedProfile } from "./fixtures/camera";
it("uses published defaults but refuses a geometrically plausible rejected measured override", () => {
  expect(profileForHmd("quest3", {})).toBe(HMD_PROFILES.quest3);
  const accepted = acceptedProfile(), key = "./profiles/quest3.json";
  expect(profileForHmd("quest3", { [key]: accepted })).toBe(accepted);
  expect(() => profileForHmd("quest3", { [key]: { ...accepted, accepted: false } })).toThrow();
  expect(() => profileForHmd("quest3", { [key]: { ...accepted, measuredAt: null } })).toThrow();
  expect(() => profileForHmd("quest3", { [key]: { ...accepted, validation: { ...accepted.validation!, maxOriginErrorM: .5 } } })).toThrow();
});
