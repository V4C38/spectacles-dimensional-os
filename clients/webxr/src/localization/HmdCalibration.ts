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
  // Physical optical camera pose in viewer local coordinates, in meters.
  cameraLabel?: string;
  published?: {
    source: string;
    cameraId: "50";
    cameraEye: "left";
    // Camera2 calibration references the headset gyro/viewer frame.
    viewerReference: "gyro-assumed-viewer";
  };
  T_viewer_optical: { position: Vec3; orientation: Quat };
  accepted?: boolean;
  measuredAt: string | null;
  validation?: { maxReprojectionPx: number; maxOriginErrorM: number; maxHeadingErrorDeg: number; observationCount: number };
  acceptance: {
    maxReprojectionPx: number;
    maxOriginErrorM: number;
    maxHeadingErrorDeg: number;
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

export function jpegDimensionsMatch(profile: HmdCalibrationProfile, width: number, height: number): void {
  if (width !== profile.intrinsics.width || height !== profile.intrinsics.height) {
    throw new Error(
      `JPEG ${width}x${height} does not match ${profile.id} intrinsics ${profile.intrinsics.width}x${profile.intrinsics.height}`,
    );
  }
}

export function requireAcceptedProfile(profile: HmdCalibrationProfile): void {
  const i = profile.intrinsics;
  const t = profile.T_viewer_optical;
  const report = profile.validation;
  if (!report || ![report.maxReprojectionPx, report.maxOriginErrorM, report.maxHeadingErrorDeg].every(value => Number.isFinite(value) && value >= 0) ||
      report.maxReprojectionPx > 2 || report.maxOriginErrorM > 0.05 || report.maxHeadingErrorDeg > 5 || !Number.isInteger(report.observationCount) || report.observationCount < 4) {
    throw new Error("Independent camera calibration validation is required. Install a validated profile or Skip localization.");
  }
  if (!profile.accepted || !profile.measuredAt || !Number.isFinite(Date.parse(profile.measuredAt)) || !profile.cameraLabel ||
      /avatar|virtual/i.test(profile.cameraLabel) ||
      ![i.fx, i.fy, i.cx, i.cy, ...t.position, ...t.orientation].every(Number.isFinite) ||
      i.fx <= 0 || i.fy <= 0 || profile.stream.width <= 0 || profile.stream.height <= 0 ||
      !Number.isFinite(profile.stream.frameRate) || profile.stream.frameRate <= 0 ||
      profile.stream.facingMode !== "environment" || Math.abs(Math.hypot(...t.orientation) - 1) > 1e-4 ||
      i.width !== profile.stream.width || i.height !== profile.stream.height) {
    throw new Error(`Measured ${profile.id} camera calibration is unavailable. Install a validated profile or Skip localization.`);
  }
}

export function requireUsableProfile(profile: HmdCalibrationProfile): void {
  const { intrinsics: i, T_viewer_optical: t, stream } = profile;
  if (!profile.cameraLabel || /avatar|virtual|front/i.test(profile.cameraLabel) ||
      ![i.fx, i.fy, i.cx, i.cy, ...t.position, ...t.orientation].every(Number.isFinite) ||
      i.fx <= 0 || i.fy <= 0 || i.cx <= 0 || i.cx >= i.width || i.cy <= 0 || i.cy >= i.height ||
      Math.abs(Math.hypot(...t.orientation) - 1) > 1e-4 ||
      stream.width <= 0 || stream.height <= 0 || stream.frameRate <= 0 || !Number.isFinite(stream.frameRate) ||
      stream.facingMode !== "environment" || i.width !== stream.width || i.height !== stream.height) {
    throw new Error("Camera calibration is invalid. Choose a supported headset profile.");
  }
}

export function matchesProfileCamera(profile: HmdCalibrationProfile, label: string): boolean {
  if (!label || /avatar|virtual|front|selfie/i.test(label)) return false;
  if (!/^camera(?:\s*2)?\s+1, facing back$/i.test(profile.cameraLabel ?? "")) return label === profile.cameraLabel;
  // Quest Browser labels vary by capture backend: camera 1, camera2 1,
  // or camera 2 1. Native Camera2 dumps call the left camera 50.
  return label.toLowerCase() === profile.cameraLabel?.toLowerCase() ||
    /^camera(?:\s*2)?\s+1, facing back$/i.test(label) ||
    /^(?:camera2?\s+)?50(?:, facing back)?$/i.test(label) ||
    /\bleft\b.*\bcamera\b|\bcamera\b.*\bleft\b/i.test(label);
}

export function profileForStream(profile: HmdCalibrationProfile, settings: LiveVideoSettings): HmdCalibrationProfile {
  let selected = profile;
  if (profile.stream.width === 1280 && profile.stream.height === 960 && settings.width === 1280 && settings.height === 720) {
    // Preserve actual camera pixels. The browser center-crops the sensor
    // for its 16:9 stream rather than vertically rescaling pixels.
    selected = {
      ...profile,
      stream: { ...profile.stream, height: 720 },
      intrinsics: { ...profile.intrinsics, height: 720, cy: profile.intrinsics.cy - (profile.stream.height - 720) / 2 },
    };
  }
  matchStream(selected, settings);
  return selected;
}
