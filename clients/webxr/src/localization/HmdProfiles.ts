import { requireUsableProfile } from "./HmdCalibration";
import type { HmdCalibrationProfile, HmdId } from "./HmdCalibration";

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

export function profileForHmd(id: HmdId): HmdCalibrationProfile {
  const measured = measuredProfiles[`./profiles/${id}.json`];
  if (measured) {
    requireUsableProfile(measured);
    if (measured.id !== id) throw new Error("calibration model mismatch");
    return measured;
  }
  const profile = HMD_PROFILES[id];
  if (!profile) {
    throw new Error("select an HMD");
  }
  return profile;
}
