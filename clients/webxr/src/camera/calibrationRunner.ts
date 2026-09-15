import type { Quat, Vec3 } from "@dimos-ar-client/websocket/protocolTypes";
import { rotateVecByQuat } from "@dimos-ar-client/localization/clientTrackingTransforms";
import type { HmdCalibrationProfile } from "./HmdCalibration";

export interface CalibrationObservation {
  corners3d: Vec3[];
  corners2d: Array<[number, number]>;
  cameraPosition: Vec3;
  cameraOrientation: Quat;
  expectedOrigin?: { position: Vec3; orientation: Quat };
  solvedOrigin?: { position: Vec3; orientation: Quat };
}

export interface CalibrationReport {
  accepted: boolean;
  meanReprojectionPx: number;
  maxReprojectionPx: number;
  maxOriginErrorM: number;
  observationCount: number;
  reasons: string[];
}

export function evaluateCalibration(
  profile: HmdCalibrationProfile,
  observations: readonly CalibrationObservation[],
): CalibrationReport {
  const reasons: string[] = [];
  if (observations.length < profile.acceptance.minObservations) {
    reasons.push(
      `need ${profile.acceptance.minObservations} observations, got ${observations.length}`,
    );
  }

  let sumPx = 0;
  let countPx = 0;
  let maxPx = 0;
  for (const observation of observations) {
    if (observation.corners3d.length !== observation.corners2d.length) {
      throw new Error("calibration observation corners3d/corners2d length mismatch");
    }
    for (let i = 0; i < observation.corners3d.length; i++) {
      const projected = projectPoint(
        profile,
        observation.cameraPosition,
        observation.cameraOrientation,
        observation.corners3d[i],
      );
      const err = Math.hypot(
        projected[0] - observation.corners2d[i][0],
        projected[1] - observation.corners2d[i][1],
      );
      sumPx += err;
      countPx += 1;
      maxPx = Math.max(maxPx, err);
    }
  }
  const meanPx = countPx === 0 ? Number.POSITIVE_INFINITY : sumPx / countPx;
  if (maxPx > profile.acceptance.maxReprojectionPx) {
    reasons.push(
      `max reprojection ${maxPx.toFixed(2)}px exceeds ${profile.acceptance.maxReprojectionPx}px`,
    );
  }

  let maxOrigin = 0;
  for (const observation of observations) {
    if (!observation.expectedOrigin || !observation.solvedOrigin) {
      reasons.push("calibration observation is missing T_odom_client");
      continue;
    }
    const err = Math.hypot(
      observation.solvedOrigin.position[0] - observation.expectedOrigin.position[0],
      observation.solvedOrigin.position[1] - observation.expectedOrigin.position[1],
      observation.solvedOrigin.position[2] - observation.expectedOrigin.position[2],
    );
    maxOrigin = Math.max(maxOrigin, err);
  }
  if (maxOrigin > profile.acceptance.maxOriginErrorM) {
    reasons.push(
      `T_odom_client error ${maxOrigin.toFixed(3)}m exceeds ${profile.acceptance.maxOriginErrorM}m`,
    );
  }

  return {
    accepted: reasons.length === 0,
    meanReprojectionPx: meanPx,
    maxReprojectionPx: maxPx,
    maxOriginErrorM: maxOrigin,
    observationCount: observations.length,
    reasons,
  };
}

export function acceptProfile(
  profile: HmdCalibrationProfile,
  report: CalibrationReport,
  measuredAt: string,
): HmdCalibrationProfile {
  if (!report.accepted) {
    throw new Error(`calibration rejected: ${report.reasons.join("; ")}`);
  }
  return {
    ...profile,
    accepted: true,
    measuredAt,
  };
}

function projectPoint(
  profile: HmdCalibrationProfile,
  cameraPosition: Vec3,
  cameraOrientation: Quat,
  point: Vec3,
): [number, number] {
  const relative: Vec3 = [
    point[0] - cameraPosition[0],
    point[1] - cameraPosition[1],
    point[2] - cameraPosition[2],
  ];
  const qInv: Quat = [
    -cameraOrientation[0],
    -cameraOrientation[1],
    -cameraOrientation[2],
    cameraOrientation[3],
  ];
  const local = rotateVecByQuat(qInv, relative);
  if (!(local[2] > 1e-6)) {
    throw new Error("calibration point is not in front of the camera");
  }
  return [
    profile.intrinsics.fx * (local[0] / local[2]) + profile.intrinsics.cx,
    profile.intrinsics.fy * (local[1] / local[2]) + profile.intrinsics.cy,
  ];
}
