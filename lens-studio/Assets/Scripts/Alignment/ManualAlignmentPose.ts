import { flattenCalibrationRotation } from "./CalibrationRotation";

export const MANUAL_MARKER_DOWN_CM = 35.0;

export interface ManualAlignmentPose {
  position: vec3;
  rotation: quat;
}

export function manualMarkerPoseFromReference(
  position: vec3,
  rotation: quat,
): ManualAlignmentPose {
  return {
    position: new vec3(position.x, position.y - MANUAL_MARKER_DOWN_CM, position.z),
    // Keep the preview visually level in Lens, but let the bridge own the
    // semantic calibration flattening when the pose is actually submitted.
    rotation: flattenCalibrationRotation(rotation),
  };
}

export function manualMarkerPoseFromMarkerWorldPose(
  position: vec3,
  rotation: quat,
): ManualAlignmentPose {
  return {
    position: new vec3(position.x, position.y, position.z),
    rotation: new quat(rotation.x, rotation.y, rotation.z, rotation.w),
  };
}
