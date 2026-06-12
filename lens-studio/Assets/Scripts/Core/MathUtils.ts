// ================================================================
/**
 * Shared math utilities for Lens Studio: vec3/quat cloning and
 * distance functions.
 */
// ================================================================

/** Clone a quat object. quat constructor is (w, x, y, z). */
export function cloneQuat(q: quat): quat {
  return new quat(q.w, q.x, q.y, q.z);
}

/** Clone a vec3 object. */
export function cloneVec3(v: vec3): vec3 {
  return new vec3(v.x, v.y, v.z);
}

/** Euclidean distance between two world-space points. */
export function vec3Distance(a: vec3, b: vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Angular distance in radians between two unit quaternions. */
export function quatAngularDistanceRad(a: quat, b: quat): number {
  const dot = Math.abs(a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z);
  return 2.0 * Math.acos(Math.min(1.0, Math.max(-1.0, dot)));
}
