import { describe, expect, it } from "vitest";
import { acceptProfile, evaluateCalibration } from "../src/camera/calibrationRunner";
import { HMD_PROFILES } from "../src/camera/hmdProfiles";

describe("evaluateCalibration", () => {
  it("accepts observations inside the recorded thresholds", () => {
    const profile = {
      ...HMD_PROFILES.quest3,
      intrinsics: { ...HMD_PROFILES.quest3.intrinsics, fx: 600, fy: 600, cx: 640, cy: 480 },
    };
    const corners3d: Array<[number, number, number]> = [
      [0.1, 0.1, 1],
      [-0.1, 0.1, 1],
      [-0.1, -0.1, 1],
      [0.1, -0.1, 1],
    ];
    const observation = {
      corners3d,
      corners2d: corners3d.map(([x, y, z]) => {
        return [600 * (x / z) + 640, 600 * (y / z) + 480] as [number, number];
      }),
      cameraPosition: [0, 0, 0] as [number, number, number],
      cameraOrientation: [0, 0, 0, 1] as [number, number, number, number],
      expectedOrigin: { position: [0, 0, 0] as [number, number, number], orientation: [0, 0, 0, 1] as [number, number, number, number] },
      solvedOrigin: { position: [0.01, 0, 0] as [number, number, number], orientation: [0, 0, 0, 1] as [number, number, number, number] },
    };
    const report = evaluateCalibration(profile, [observation, observation, observation, observation]);
    expect(report.accepted).toBe(true);
    const accepted = acceptProfile(profile, report, "2026-09-14T00:00:00Z");
    expect(accepted.accepted).toBe(true);
    expect(accepted.measuredAt).toBe("2026-09-14T00:00:00Z");
  });

  it("rejects sparse or inaccurate captures", () => {
    const report = evaluateCalibration(HMD_PROFILES.quest3, []);
    expect(report.accepted).toBe(false);
    expect(report.reasons[0]).toContain("need 4 observations");
    expect(() => acceptProfile(HMD_PROFILES.quest3, report, "now")).toThrow("rejected");

    const blank = {
      corners3d: [[0, 0, 1]] as [number, number, number][],
      corners2d: [[0, 0]] as [number, number][],
      cameraPosition: [0, 0, 0] as [number, number, number],
      cameraOrientation: [0, 0, 0, 1] as [number, number, number, number],
    };
    const missingOrigin = evaluateCalibration(HMD_PROFILES.quest3, [blank, blank, blank, blank]);
    expect(missingOrigin.accepted).toBe(false);
    expect(missingOrigin.reasons.some((reason) => reason.includes("T_odom_client"))).toBe(true);
  });
});
