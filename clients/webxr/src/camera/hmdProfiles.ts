import type { HmdCalibrationProfile, HmdId } from "./HmdCalibration";

const ACCEPTANCE = {
  maxReprojectionPx: 2,
  maxOriginErrorM: 0.05,
  minObservations: 4,
} as const;

export const HMD_PROFILES: Record<HmdId, HmdCalibrationProfile> = {
  quest3: {
    id: "quest3",
    stream: {
      width: 1280,
      height: 960,
      frameRate: 30,
      facingMode: "environment",
    },
    intrinsics: {
      fx: 0,
      fy: 0,
      cx: 640,
      cy: 480,
      width: 1280,
      height: 960,
      distortion_model: "none",
      distortion: [],
    },
    T_tracking_optical: {
      position: [0, 0, 0],
      orientation: [0, 0, 0, 1],
    },
    accepted: false,
    measuredAt: null,
    acceptance: ACCEPTANCE,
  },
  quest3s: {
    id: "quest3s",
    stream: {
      width: 1280,
      height: 960,
      frameRate: 30,
      facingMode: "environment",
    },
    intrinsics: {
      fx: 0,
      fy: 0,
      cx: 640,
      cy: 480,
      width: 1280,
      height: 960,
      distortion_model: "none",
      distortion: [],
    },
    T_tracking_optical: {
      position: [0, 0, 0],
      orientation: [0, 0, 0, 1],
    },
    accepted: false,
    measuredAt: null,
    acceptance: ACCEPTANCE,
  },
};

export function profileForHmd(id: HmdId): HmdCalibrationProfile {
  const profile = HMD_PROFILES[id];
  if (!profile) {
    throw new Error("select an HMD");
  }
  return profile;
}
