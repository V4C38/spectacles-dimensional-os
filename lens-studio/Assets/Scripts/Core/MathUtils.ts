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

/**
 * Rotation quaternion from the upper-left 3x3 of a mat4 (columns are basis
 * vectors). Basis is normalized defensively. Shepperd's method.
 * Note: Lens quat constructor is (w, x, y, z).
 */
export function quatFromMat4Rotation(m: mat4): quat {
  const c0 = new vec3(m.column0.x, m.column0.y, m.column0.z).normalize();
  const c1 = new vec3(m.column1.x, m.column1.y, m.column1.z).normalize();
  const c2 = new vec3(m.column2.x, m.column2.y, m.column2.z).normalize();
  // r[row][col]
  const r00 = c0.x, r01 = c1.x, r02 = c2.x;
  const r10 = c0.y, r11 = c1.y, r12 = c2.y;
  const r20 = c0.z, r21 = c1.z, r22 = c2.z;
  const trace = r00 + r11 + r22;
  let w: number, x: number, y: number, z: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1.0) * 2;
    w = 0.25 * s; x = (r21 - r12) / s; y = (r02 - r20) / s; z = (r10 - r01) / s;
  } else if (r00 > r11 && r00 > r22) {
    const s = Math.sqrt(1.0 + r00 - r11 - r22) * 2;
    w = (r21 - r12) / s; x = 0.25 * s; y = (r01 + r10) / s; z = (r02 + r20) / s;
  } else if (r11 > r22) {
    const s = Math.sqrt(1.0 + r11 - r00 - r22) * 2;
    w = (r02 - r20) / s; x = (r01 + r10) / s; y = 0.25 * s; z = (r12 + r21) / s;
  } else {
    const s = Math.sqrt(1.0 + r22 - r00 - r11) * 2;
    w = (r10 - r01) / s; x = (r02 + r20) / s; y = (r12 + r21) / s; z = 0.25 * s;
  }
  const result = new quat(w, x, y, z);
  result.normalize();
  return result;
}

/** Yaw-only heading from planar direction (shared by nav marker and placement drag). */
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
