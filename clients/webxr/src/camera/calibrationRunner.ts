import type { Quat, Vec3 } from "@dimos-ar-client/websocket/protocolTypes";
import { rotateVecByQuat } from "@dimos-ar-client/localization/clientTrackingTransforms";
import { requireAcceptedProfile } from "./HmdCalibration";
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
  maxHeadingErrorDeg: number;
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

  if (new Set(observations.map(o => JSON.stringify([o.cameraPosition, o.cameraOrientation]))).size < profile.acceptance.minObservations) {
    reasons.push("need multiple independent viewpoints");
  }
  if (![profile.intrinsics.fx, profile.intrinsics.fy].every(value => Number.isFinite(value) && value > 0)) reasons.push("invalid focal lengths");

  let sumPx = 0;
  let countPx = 0;
  let maxPx = 0;
  for (const observation of observations) {
    if (observation.corners3d.length < 4) reasons.push("need at least four corners per observation");
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
      if (!Number.isFinite(err)) reasons.push("non-finite reprojection error");
      sumPx += err;
      countPx += 1;
      maxPx = Math.max(maxPx, err);
    }
  }
  const meanPx = countPx === 0 ? Number.POSITIVE_INFINITY : sumPx / countPx;
  if (!Number.isFinite(meanPx)) reasons.push("no finite reprojection observations");
  if (maxPx > profile.acceptance.maxReprojectionPx) {
    reasons.push(
      `max reprojection ${maxPx.toFixed(2)}px exceeds ${profile.acceptance.maxReprojectionPx}px`,
    );
  }

  let maxOrigin = 0;
  let maxHeading = 0;
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
    if (!Number.isFinite(err)) reasons.push("non-finite origin error");
    maxOrigin = Math.max(maxOrigin, err);
    const a = heading(observation.expectedOrigin.orientation);
    const b = heading(observation.solvedOrigin.orientation);
    const headingError = Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) * 180 / Math.PI;
    if (!Number.isFinite(headingError)) reasons.push("invalid heading");
    maxHeading = Math.max(maxHeading, headingError);
  }
  if (maxOrigin > profile.acceptance.maxOriginErrorM) {
    reasons.push(
      `T_odom_client error ${maxOrigin.toFixed(3)}m exceeds ${profile.acceptance.maxOriginErrorM}m`,
    );
  }

  if (maxHeading > profile.acceptance.maxHeadingErrorDeg) reasons.push(`heading error ${maxHeading.toFixed(2)}deg exceeds ${profile.acceptance.maxHeadingErrorDeg}deg`);

  return {
    maxHeadingErrorDeg: maxHeading,
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
  if (!report.accepted || report.observationCount < profile.acceptance.minObservations ||
      ![report.maxReprojectionPx, report.meanReprojectionPx, report.maxOriginErrorM, report.maxHeadingErrorDeg].every(Number.isFinite) ||
      report.maxReprojectionPx > profile.acceptance.maxReprojectionPx ||
      report.maxOriginErrorM > profile.acceptance.maxOriginErrorM ||
      report.maxHeadingErrorDeg > profile.acceptance.maxHeadingErrorDeg) {
    throw new Error(`calibration rejected: ${report.reasons.join("; ")}`);
  }
  const accepted = { ...profile, accepted: true, measuredAt, validation: { ...report } };
  requireAcceptedProfile(accepted);
  return accepted;
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

function heading(q: Quat): number {
  const norm = Math.hypot(...q);
  if (!Number.isFinite(norm) || norm < 1e-6) return Number.NaN;
  const direction = rotateVecByQuat(q.map(value => value / norm) as Quat, [1, 0, 0]);
  if (Math.hypot(direction[0], direction[1]) < 1e-6) return Number.NaN;
  return Math.atan2(direction[1], direction[0]);
}
