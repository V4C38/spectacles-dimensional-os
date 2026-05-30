export function flattenCalibrationRotation(rotation: quat): quat {
  // Alignment treats the tracked object's local +X axis as semantic robot-forward.
  // This is a calibration convention shared with the bridge math; it is separate from
  // Lens Studio's camera-facing "-Z is visually forward" intuition.
  const xx = rotation.x * rotation.x;
  const yy = rotation.y * rotation.y;
  const zz = rotation.z * rotation.z;
  const ww = rotation.w * rotation.w;
  const xy = rotation.x * rotation.y;
  const xz = rotation.x * rotation.z;
  const yz = rotation.y * rotation.z;
  const xw = rotation.x * rotation.w;
  const yw = rotation.y * rotation.w;
  const zw = rotation.z * rotation.w;

  const forwardX = 1 - 2 * (yy + zz);
  const forwardZ = 2 * (xz - yw);
  const planarLength = Math.sqrt(forwardX * forwardX + forwardZ * forwardZ);
  const yaw = planarLength > 0.001 ? Math.atan2(-forwardZ, forwardX) : 0.0;
  const halfYaw = yaw * 0.5;
  return new quat(0, Math.sin(halfYaw), 0, Math.cos(halfYaw));
}
