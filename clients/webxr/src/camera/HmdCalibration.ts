import type { Intrinsics, Quat, Vec3 } from "@dimos-ar-client/websocket/protocolTypes";

export const HMD_OPTIONS = [
  { id: "quest3", label: "Quest 3" },
  { id: "quest3s", label: "Quest 3S" },
] as const;

export type HmdId = (typeof HMD_OPTIONS)[number]["id"];

export interface HmdOption {
  id: HmdId;
  label: string;
}

export interface HmdStreamIdentity {
  width: number;
  height: number;
  frameRate: number;
  facingMode: "environment";
}

export interface HmdCalibrationProfile {
  id: HmdId;
  stream: HmdStreamIdentity;
  intrinsics: Intrinsics;
  T_tracking_optical: { position: Vec3; orientation: Quat };
  accepted: boolean;
  measuredAt: string | null;
  acceptance: {
    maxReprojectionPx: number;
    maxOriginErrorM: number;
    minObservations: number;
  };
}

export interface LiveVideoSettings {
  width?: number;
  height?: number;
  frameRate?: number;
  facingMode?: string;
}

export function parseHmdId(raw: string): HmdId {
  const match = HMD_OPTIONS.find((option) => option.id === raw);
  if (!match) {
    throw new Error("select an HMD");
  }
  return match.id;
}

export function hmdLabel(id: HmdId): string {
  const match = HMD_OPTIONS.find((option) => option.id === id);
  if (!match) {
    throw new Error("select an HMD");
  }
  return match.label;
}

export function matchStream(profile: HmdCalibrationProfile, settings: LiveVideoSettings): void {
  if (settings.width !== profile.stream.width || settings.height !== profile.stream.height) {
    throw new Error(
      `camera stream ${settings.width ?? "?"}x${settings.height ?? "?"} does not match ${profile.id} profile ${profile.stream.width}x${profile.stream.height}`,
    );
  }
  if (settings.frameRate !== profile.stream.frameRate) {
    throw new Error(
      `camera frameRate ${settings.frameRate ?? "?"} does not match ${profile.id} profile ${profile.stream.frameRate}`,
    );
  }
  if (settings.facingMode !== undefined && settings.facingMode !== profile.stream.facingMode) {
    throw new Error(`camera facingMode must be ${profile.stream.facingMode}`);
  }
}

export function requireAcceptedProfile(profile: HmdCalibrationProfile): void {
  if (!profile.accepted || !profile.measuredAt) {
    const label = hmdLabel(profile.id);
    throw new Error(
      `${label} camera calibration has not been measured yet. AprilTag localization needs an accepted profile before AR can start.`,
    );
  }
}

export function jpegDimensionsMatch(profile: HmdCalibrationProfile, width: number, height: number): void {
  if (width !== profile.intrinsics.width || height !== profile.intrinsics.height) {
    throw new Error(
      `JPEG ${width}x${height} does not match ${profile.id} intrinsics ${profile.intrinsics.width}x${profile.intrinsics.height}`,
    );
  }
}
