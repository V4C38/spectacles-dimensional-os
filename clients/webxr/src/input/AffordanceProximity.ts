import * as THREE from "three";

export type NearbyAffordance = { object: THREE.Mesh; point: THREE.Vector3; distance: number; miss: number };

/** Closest point on the actual local control shape; world-space distance handles scaled panels. */
export function closestPoint(mesh: THREE.Mesh, point: THREE.Vector3): THREE.Vector3 {
  const local = mesh.worldToLocal(point.clone());
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox!;
  const uniforms = (mesh.material as THREE.ShaderMaterial).uniforms;
  const size = uniforms?.uSize?.value as THREE.Vector2 | undefined;
  if (size) {
    const r = Number(uniforms.uRadius?.value ?? 0);
    const innerX = Math.max(0, size.x / 2 - r), innerY = Math.max(0, size.y / 2 - r);
    const center = new THREE.Vector2(THREE.MathUtils.clamp(local.x, -innerX, innerX), THREE.MathUtils.clamp(local.y, -innerY, innerY));
    const offset = new THREE.Vector2(local.x, local.y).sub(center);
    if (offset.length() > r) offset.setLength(r);
    local.set(center.x + offset.x, center.y + offset.y, 0);
  } else if (mesh.geometry.type === "CylinderGeometry") {
    const radius = (mesh.geometry as THREE.CylinderGeometry).parameters.radiusTop;
    const length = Math.hypot(local.x, local.z);
    if (length > radius) { local.x *= radius / length; local.z *= radius / length; }
    local.y = THREE.MathUtils.clamp(local.y, box.min.y, box.max.y);
  } else box.clampPoint(local, local);
  return mesh.localToWorld(local);
}

export function proximityToAffordance(ray: THREE.Ray, mesh: THREE.Mesh, retained: boolean, range: number): NearbyAffordance | null {
  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
  const sphere = mesh.geometry.boundingSphere!.clone().applyMatrix4(mesh.matrixWorld);
  const maxMiss = retained ? 0.08 : 0.05;
  if (ray.direction.dot(sphere.center.clone().sub(ray.origin)) < 0 || ray.distanceSqToPoint(sphere.center) > (sphere.radius + maxMiss) ** 2) return null;
  // Distance to a convex shape along a ray is convex. This also handles tilted/scaled controls.
  let low = Math.max(0, ray.origin.distanceTo(sphere.center) - sphere.radius - maxMiss), high = Math.min(range, ray.origin.distanceTo(sphere.center) + sphere.radius + maxMiss);
  const measure = (t: number) => { const point = ray.at(t, new THREE.Vector3()); return point.distanceToSquared(closestPoint(mesh, point)); };
  for (let i = 0; i < 22; i++) {
    const a = low + (high - low) / 3, b = high - (high - low) / 3;
    if (measure(a) < measure(b)) high = b; else low = a;
  }
  const distance = (low + high) / 2;
  if (distance <= 0 || distance > range) return null;
  const point = closestPoint(mesh, ray.at(distance, new THREE.Vector3()));
  const miss = point.distanceTo(ray.at(distance, new THREE.Vector3()));
  const threshold = Math.min(maxMiss, distance * Math.tan(THREE.MathUtils.degToRad(retained ? 4.5 : 3)));
  return miss <= threshold ? { object: mesh, point, distance, miss } : null;
}

export function rayTargetVisible(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (!node.visible || node.userData.rayDisabled === true) return false;
  return true;
}
