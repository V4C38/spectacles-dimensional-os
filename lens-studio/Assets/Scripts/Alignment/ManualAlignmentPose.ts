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
    // Pass the raw rotation; the bridge owns flattening when the pose is submitted.
    // quat constructor is (w, x, y, z)
    rotation: new quat(rotation.w, rotation.x, rotation.y, rotation.z),
  };
}

export function manualMarkerPoseFromMarkerWorldPose(
  position: vec3,
  rotation: quat,
): ManualAlignmentPose {
  return {
    position: new vec3(position.x, position.y, position.z),
    // quat constructor is (w, x, y, z)
    rotation: new quat(rotation.w, rotation.x, rotation.y, rotation.z),
  };
}
