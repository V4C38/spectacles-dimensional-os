import type { Intrinsics, Quat, Vec3 } from "@dimos-ar-client/ClientContracts";

export const HMD_OPTIONS = [
  { id: "quest3", label: "Quest 3" },
  { id: "quest3s", label: "Quest 3S" },
] as const;

export type HmdId = (typeof HMD_OPTIONS)[number]["id"];

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

const ACCEPTANCE = {
  maxReprojectionPx: 2,
  maxOriginErrorM: 0.05,
  maxHeadingErrorDeg: 5,
  minObservations: 4,
} as const;

// Device camera profiles. Source calibration records are linked below.
const QUEST3_SOURCE = "https://github.com/tark146/UnrealAndroidCamera2Plugin/blob/f3b378fd83b1a2fc49ca9dfac01163d0bb5f3bce/Source/AndroidCamera2Plugin/Private/SimpleCamera2Test.cpp";
const QUEST3S_SOURCE = "https://github.com/LV-Robotics-Lab/quest_streamer/blob/942561ff4f19ac9c9a8c18b7b6cc4af35157bee8/quest_streamer/apriltag_fusion.py";

function publishedProfile(
  id: HmdId, source: string, fx: number, cx: number, nativeCy: number,
  position: HmdCalibrationProfile["T_viewer_optical"]["position"],
  sensorToOptical: HmdCalibrationProfile["T_viewer_optical"]["orientation"],
): HmdCalibrationProfile {
  const [x, y, z, w] = sensorToOptical;
  const norm = Math.hypot(x, y, z, w);
  return {
    id,
    stream: { width: 1280, height: 960, frameRate: 30, facingMode: "environment" },
    intrinsics: {
      fx, fy: fx, cx, cy: nativeCy - 160, width: 1280, height: 960,
      distortion_model: "none", distortion: [],
    },
    cameraLabel: "camera2 1, facing back",
    published: { source, cameraId: "50", cameraEye: "left", viewerReference: "gyro-assumed-viewer" },
    T_viewer_optical: {
      position,
      // Camera2 maps sensor -> optical. Invert for T_viewer_optical; both
      // the sensor and WebXR viewer use right/up/back axes. Optical axes stay
      // right/down/forward.
      orientation: [-x / norm, -y / norm, -z / norm, w / norm],
    },
    measuredAt: null,
    acceptance: ACCEPTANCE,
  };
}

export const HMD_PROFILES: Record<HmdId, HmdCalibrationProfile> = {
  quest3: publishedProfile("quest3", QUEST3_SOURCE,
    870.6005249023438, 640.2453002929688, 641.2428588867188,
    [-0.03187057375907898, -0.01715778559446335, -0.06285717338323593],
    [-0.9951009154319763, -0.0002342800289625302, -0.005589410196989775, 0.09870576858520508]),
  quest3s: publishedProfile("quest3s", QUEST3S_SOURCE,
    865.5078, 639.85144, 641.9739,
    [-0.03211516, -0.012897672, -0.0740648],
    [-0.9985061, -0.003634827, -0.0021247282, 0.054477543]),
};

// Model-specific calibration files override the built-in device profiles.
const measuredProfiles = import.meta.glob<HmdCalibrationProfile>("./profiles/*.json", { eager: true, import: "default" });

export function profileForHmd(id: HmdId, overrides: Readonly<Record<string, HmdCalibrationProfile>> = measuredProfiles): HmdCalibrationProfile {
  const measured = overrides[`./profiles/${id}.json`];
  if (measured) {
    requireUsableProfile(measured);
    requireAcceptedProfile(measured);
    if (measured.id !== id) throw new Error("calibration model mismatch");
    return measured;
  }
  const profile = HMD_PROFILES[id];
  if (!profile) {
    throw new Error("select an HMD");
  }
  return profile;
}
