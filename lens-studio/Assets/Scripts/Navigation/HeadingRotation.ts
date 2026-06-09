/** Yaw-only heading helpers shared by nav marker view and placement drag/spawn. */

export function yawRotationFromPlanarDirection(x: number, z: number): quat {
  const yaw = Math.atan2(-z, x);
  const halfYaw = yaw * 0.5;
  // Lens Studio quat constructor is (w, x, y, z); Y-axis yaw = (cos, 0, sin, 0)
  return new quat(Math.cos(halfYaw), 0, Math.sin(halfYaw), 0);
}

/** Extract ground yaw from semantic +X forward, matching drag and bridge conventions. */
export function yawRotationFromWorldRotation(rotation: quat): quat {
  const forward = rotation.multiplyVec3(new vec3(1, 0, 0));
  const planarLength = Math.sqrt(forward.x * forward.x + forward.z * forward.z);
  if (planarLength <= 1e-6) {
    return quat.quatIdentity();
  }
  return yawRotationFromPlanarDirection(forward.x, forward.z);
}
