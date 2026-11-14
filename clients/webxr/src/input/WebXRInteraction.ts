import type { PresencePointer } from "@dimos-ar-client/ClientContracts";
import { webxrToClientTrackingPoint } from "../utilities/WebXRCoordinates";
import * as THREE from "three";
import type * as xb from "xrblocks";
import type { Vec3 } from "@dimos-ar-client/ClientContracts";

export const GROUND_NORMAL_MIN_Y = Math.cos((20 * Math.PI) / 180);
export const RAY_LENGTH_M = 20;
export const FLOOR_AIM_RANGE_M = 5;

export type MeshBlockReason = "none" | "wall" | "unscanned";

export type MeshHit = { position: Vec3; normal: Vec3; label?: string };

export type MeshPlacementResult = {
  status: "ok" | "blocked";
  blockReason: MeshBlockReason;
  probePosition: Vec3;
  goalPosition: Vec3 | null;
};

export type SolveMeshPlacementArgs = {
  rayFrom: Vec3;
  rayTo: Vec3;
  hits: MeshHit[];
  fallbackY: number;
};

export function isGroundNormal(normal: Vec3): boolean {
  const length = Math.hypot(normal[0], normal[1], normal[2]);
  if (length <= 0.0001) {
    return false;
  }
  return normal[1] / length >= GROUND_NORMAL_MIN_Y;
}

export function solveMeshPlacement(args: SolveMeshPlacementArgs): MeshPlacementResult {
  const point = pinchPlanarPoint(args.rayFrom, args.rayTo, args.fallbackY);
  const hit = args.hits[0];
  const floorY = args.fallbackY;
  const valid = hit
    ? pointIsOnRay(hit.position, args.rayFrom, args.rayTo) && isGroundNormal(hit.normal) && (hit.label === "floor" ||
        (!hit.label && Math.abs(hit.position[1] - floorY) <= FLOOR_HEIGHT_TOLERANCE_M))
    : args.rayTo[1] < args.rayFrom[1] && pointIsOnRay(point, args.rayFrom, args.rayTo);
  const position = hit?.position ?? point;
  return {
    status: valid ? "ok" : "blocked",
    blockReason: valid ? "none" : hit?.label === "unscanned" ? "unscanned" : "wall",
    probePosition: position,
    goalPosition: valid ? position : null,
  };
}

export const FLOOR_HEIGHT_TOLERANCE_M = 0.18;

function pointIsOnRay(point: Vec3, from: Vec3, to: Vec3): boolean {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  return Math.hypot(point[0] - from[0], point[1] - from[1], point[2] - from[2]) <= length;
}

export type FloorPlane = { position: Vec3; normal: Vec3; polygon?: Vec3[]; label?: string };

export function isFloorSurface(plane: FloorPlane, floorY: number): boolean {
  return isGroundNormal(plane.normal) && (plane.label === "floor" ||
    (!plane.label && Math.abs(plane.position[1] - floorY) <= FLOOR_HEIGHT_TOLERANCE_M));
}

/** Polygons are finite. Every detected non-floor surface still blocks a ray. */
export function navigationSurfaceHits(from: Vec3, dir: Vec3, planes: readonly FloorPlane[], floorY: number): MeshHit[] {
  const hasFloor = planes.some(plane => isFloorSurface(plane, floorY));
  const hit = intersectRayPlanes(from, dir, planes);
  const fallback = intersectRayPlanes(from, dir, [{ position: [0, floorY, 0], normal: [0, 1, 0] }]);
  if (hit && (!fallback || hasFloor || distanceSquared(from, hit.position) <= distanceSquared(from, fallback.position))) return [hit];
  if (!hasFloor) return fallback ? [fallback] : [];
  return [{ position: fallback?.position ?? from, normal: [0, 0, 0], label: "unscanned" }];
}

function distanceSquared(a: Vec3, b: Vec3): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

function insidePolygon(point: Vec3, polygon: Vec3[], normal: Vec3): boolean {
  // Project onto the dominant plane, so vertical walls work as well as floors.
  const drop = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
  const axes = [0, 1, 2].filter(axis => axis !== drop);
  const [u, v] = axes;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[v] > point[v]) !== (b[v] > point[v]) &&
        point[u] < (b[u] - a[u]) * (point[v] - a[v]) / (b[v] - a[v]) + a[u]) inside = !inside;
  }
  return inside;
}

export function intersectRayPlanes(
  rayFrom: Vec3,
  rayDir: Vec3,
  planes: readonly FloorPlane[],
): MeshHit | null {
  const dir = normalizeVec3(rayDir);
  if (!dir) {
    return null;
  }
  let bestT = Number.POSITIVE_INFINITY;
  let best: MeshHit | null = null;
  for (const plane of planes) {
    const normal = normalizeVec3(plane.normal);
    if (!normal) {
      continue;
    }
    const denom = normal[0] * dir[0] + normal[1] * dir[1] + normal[2] * dir[2];
    if (Math.abs(denom) <= 0.0001) {
      continue;
    }
    const t =
      (normal[0] * (plane.position[0] - rayFrom[0]) +
        normal[1] * (plane.position[1] - rayFrom[1]) +
        normal[2] * (plane.position[2] - rayFrom[2])) /
      denom;
    if (t < 0 || t > RAY_LENGTH_M || t >= bestT) {
      continue;
    }
    const position: Vec3 = [rayFrom[0] + dir[0] * t, rayFrom[1] + dir[1] * t, rayFrom[2] + dir[2] * t];
    if (plane.polygon && !insidePolygon(position, plane.polygon, normal)) continue;
    bestT = t;
    best = {
      position: [rayFrom[0] + dir[0] * t, rayFrom[1] + dir[1] * t, rayFrom[2] + dir[2] * t],
      normal,
      ...(plane.label ? { label: plane.label } : {}),
    };
  }
  return best;
}

export function planeNormalFromPose(orientation: [number, number, number, number]): Vec3 {
  const [x, y, z, w] = orientation;
  return [
    2 * (x * y - z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z + x * w),
  ];
}

function normalizeVec3(value: Vec3): Vec3 | null {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length <= 0.0001) {
    return null;
  }
  return [value[0] / length, value[1] / length, value[2] / length];
}

function pinchPlanarPoint(rayFrom: Vec3, rayTo: Vec3, planeY: number): Vec3 {
  const delta: Vec3 = [rayTo[0] - rayFrom[0], rayTo[1] - rayFrom[1], rayTo[2] - rayFrom[2]];
  const direction = normalizeVec3(delta);
  if (!direction) {
    return [rayFrom[0], planeY, rayFrom[2]];
  }
  if (Math.abs(direction[1]) <= 0.0001) {
    const horizontalLength = Math.hypot(delta[0], delta[2]);
    if (horizontalLength <= 0.0001) {
      return [rayFrom[0], planeY, rayFrom[2]];
    }
    const travel = Math.min(horizontalLength, RAY_LENGTH_M);
    return [rayFrom[0] + direction[0] * travel, planeY, rayFrom[2] + direction[2] * travel];
  }
  const distanceAlongRay = (planeY - rayFrom[1]) / direction[1];
  if (distanceAlongRay < 0) {
    return [rayTo[0], planeY, rayTo[2]];
  }
  return [
    rayFrom[0] + direction[0] * distanceAlongRay,
    planeY,
    rayFrom[2] + direction[2] * distanceAlongRay,
  ];
}

export type NearbyAffordance = { object: THREE.Mesh; point: THREE.Vector3; distance: number; miss: number };

/** Closest point on the actual local control shape; world-space distance handles scaled panels. */
export function closestPoint(mesh: THREE.Mesh, point: THREE.Vector3): THREE.Vector3 {
  if (mesh.userData.meshSelection) {
    const positions = mesh.geometry.getAttribute("position"), indices = mesh.geometry.index;
    const triangle = new THREE.Triangle(), candidate = new THREE.Vector3(), best = new THREE.Vector3();
    let distance = Infinity;
    for (let i = 0; i < (indices?.count ?? positions.count); i += 3) {
      for (const [j, vertex] of [triangle.a, triangle.b, triangle.c].entries())
        vertex.fromBufferAttribute(positions, indices ? indices.getX(i + j) : i + j).applyMatrix4(mesh.matrixWorld);
      triangle.closestPointToPoint(point, candidate);
      const next = candidate.distanceToSquared(point);
      if (next < distance) { distance = next; best.copy(candidate); }
    }
    return best;
  }
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
  } else if (mesh.geometry.type === "SphereGeometry") {
    local.clampLength(0, (mesh.geometry as THREE.SphereGeometry).parameters.radius);
  } else if (mesh.geometry.type === "CylinderGeometry") {
    const radius = (mesh.geometry as THREE.CylinderGeometry).parameters.radiusTop;
    const length = Math.hypot(local.x, local.z);
    if (length > radius) { local.x *= radius / length; local.z *= radius / length; }
    local.y = THREE.MathUtils.clamp(local.y, box.min.y, box.max.y);
  } else box.clampPoint(local, local);
  return mesh.localToWorld(local);
}

export function proximityToAffordance(ray: THREE.Ray, mesh: THREE.Mesh, retained: boolean, range: number): NearbyAffordance | null {
  if (mesh.userData.meshSelection) return null;
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


/** Near targeting shares the SDK hit list and press lifecycle with distant rays. */
export class WebXRDirectInteraction {
  private readonly indexPoints = new Map<Controller, THREE.Vector3>();
  private readonly points = new Map<Controller, THREE.Vector3>();
  private readonly hovered = new Map<Controller, THREE.Intersection>();
  private readonly captures = new Map<Controller, { direct: boolean; target?: THREE.Object3D; normal: THREE.Vector3 }>();

  sample(frame: XRFrame, reference: XRReferenceSpace, controllers: Controller[]): void {
    for (const controller of controllers) {
      const source = controller.inputSource;
      let point: THREE.Vector3 | null = null;
      this.indexPoints.delete(controller);
      if (source?.hand) {
        const index = source.hand.get("index-finger-tip"), thumb = source.hand.get("thumb-tip");
        const a = index && frame.getJointPose?.(index, reference), b = thumb && frame.getJointPose?.(thumb, reference);
        if (a) this.indexPoints.set(controller, new THREE.Vector3(a.transform.position.x, a.transform.position.y, a.transform.position.z));
        else this.indexPoints.delete(controller);
        if (a) {
          point = new THREE.Vector3(a.transform.position.x, a.transform.position.y, a.transform.position.z);
          if (b) point.add(new THREE.Vector3(b.transform.position.x, b.transform.position.y, b.transform.position.z)).multiplyScalar(0.5);
        }
      } else if (source?.gripSpace) {
        this.indexPoints.delete(controller);
        const pose = frame.getPose(source.gripSpace, reference);
        if (pose) {
          const p = pose.transform.position, q = pose.transform.orientation;
          point = new THREE.Vector3(0, 0, -0.06).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w)).add(new THREE.Vector3(p.x, p.y, p.z));
        }
      }
      this.setPoint(controller, point);
    }
  }

  setPoint(controller: Controller, point: THREE.Vector3 | null): void {
    if (point) this.points.set(controller, point);
    else { this.points.delete(controller); this.hovered.delete(controller); }
  }
  indexTip(controller: Controller): THREE.Vector3 | null { return this.indexPoints.get(controller) ?? null; }
  point(controller: Controller): THREE.Vector3 | undefined { return this.points.get(controller); }
  isDirect(controller: Controller): boolean { return this.captures.get(controller)?.direct ?? this.hovered.has(controller); }
  hasLostCapture(): boolean { return [...this.captures].some(([source, capture]) => capture.direct && !this.points.has(source)); }

  resolve(controller: Controller, scene: THREE.Object3D | undefined, eligible: (object: THREE.Object3D, point: THREE.Vector3) => boolean): THREE.Intersection | undefined {
    const capture = this.captures.get(controller);
    if (!controller.visible || controller.userData.connected === false) { this.hovered.delete(controller); return undefined; }
    if (capture && !capture.direct) return undefined;
    const point = this.points.get(controller);
    if (!point || !scene) { this.hovered.delete(controller); return undefined; }
    const previous = this.hovered.get(controller)?.object;
    let best: THREE.Intersection | undefined;
    scene.traverse(object => {
      if (!(object instanceof THREE.Mesh) || !object.userData.rayTarget || object.userData.rayAmbient ||
          !rayTargetVisible(object) || object.userData.interactionEnabled === false ||
          (capture?.target && capture.target !== object)) return;
      object.updateWorldMatrix(true, false);
      const contact = object.userData.touchButton ? this.indexPoints.get(controller) ?? point : point;
      const closest = closestPoint(object, contact);
      const distance = closest.distanceTo(contact);
      if (distance > (object === previous ? 0.04 : 0.025) || !eligible(object, closest)) return;
      const priority = Number(object.userData.rayPriority ?? 0);
      const bestPriority = Number(best?.object.userData.rayPriority ?? Infinity);
      if (!best || priority < bestPriority || (priority === bestPriority && distance < best.distance)) best = { object, point: closest, distance };
    });
    if (best) this.hovered.set(controller, best); else this.hovered.delete(controller);
    return best;
  }

  capture(controller: Controller, target: THREE.Object3D, normal?: THREE.Vector3): void {
    const direction = normal ?? new THREE.Vector3(0, 0, 1).applyQuaternion(target.getWorldQuaternion(new THREE.Quaternion()));
    this.captures.set(controller, { direct: this.hovered.has(controller), target, normal: direction.normalize() });
  }
  ray(controller: Controller): { origin: Vec3; direction: Vec3 } | null {
    if (!this.isDirect(controller)) return null;
    const target = this.captures.get(controller)?.target ?? this.hovered.get(controller)?.object;
    const point = target?.userData.touchButton ? this.indexPoints.get(controller) ?? this.points.get(controller) : this.points.get(controller);
    if (!point) return null;
    const normal = this.captures.get(controller)?.normal ?? new THREE.Vector3(0, 0, 1);
    return { origin: point.clone().addScaledVector(normal, 0.1).toArray() as Vec3, direction: normal.clone().negate().toArray() as Vec3 };
  }
  cancel(): void { this.captures.clear(); }
  reset(): void { this.cancel(); this.points.clear(); this.indexPoints.clear(); this.hovered.clear(); }
}

type Contact = { object: THREE.Mesh; point: THREE.Vector3; distance: number };
type Press = Contact & { normal: THREE.Vector3 };

/** A physical poke uses the ordinary button press/release path, without a pinch. */
export class FingertipButtons<T extends object> {
  private readonly presses = new Map<T, Press>();
  private readonly approaches = new Map<T, { object: THREE.Mesh; tip: THREE.Vector3 }>();
  private readonly previous = new Map<T, THREE.Vector3>();
  private readonly disarmed = new Map<T, THREE.Vector3>();

  constructor(private readonly events: {
    start(source: T, contact: Contact): void;
    end(source: T, contact: Contact, cancelled: boolean): void;
  }) {}

  owns(source: T): boolean { return this.presses.has(source) || this.disarmed.has(source); }

  release(source: T): void {
    const press = this.presses.get(source);
    if (!press) return;
    this.presses.delete(source); this.disarmed.set(source, press.point.clone());
    this.events.end(source, press, !rayTargetVisible(press.object) || press.object.userData.interactionEnabled === false);
  }

  update(source: T, tip: THREE.Vector3 | null, targets: readonly THREE.Mesh[], eligible: (object: THREE.Object3D, point: THREE.Vector3) => boolean, pinching = false): void {
    const press = this.presses.get(source);
    const locked = this.disarmed.get(source);
    if (locked) {
      if (tip && tip.distanceTo(locked) > 0.03) this.disarmed.delete(source);
      this.previous.delete(source);
      return;
    }
    if (press) {
      const valid = rayTargetVisible(press.object) && press.object.userData.interactionEnabled !== false;
      // Pinch changes the finger skeleton. Preserve the existing button press
      // until pinch release, while still cancelling loss of tracking/eligibility.
      if (pinching && tip && valid && eligible(press.object, press.point)) return;
      const closest = tip ? closestPoint(press.object, tip) : press.point;
      const delta = tip?.clone().sub(closest);
      const front = delta?.dot(press.normal) ?? 0;
      const lateral = delta ? delta.clone().addScaledVector(press.normal, -front).length() : Infinity;
      if (!tip || !valid || !eligible(press.object, closest) || front > 0.018 || front < -0.025 || lateral > 0.008) {
        this.presses.delete(source);
        this.disarmed.set(source, press.point.clone());
        this.events.end(source, press, !tip || !valid || lateral > 0.008 || front < 0 || !eligible(press.object, closest));
      }
      return;
    }
    const previous = this.previous.get(source);
    if (!tip) { this.previous.delete(source); return; }
    this.previous.set(source, tip.clone());
    if (!previous) return;
    let contact: Press | null = null;
    for (const object of targets) {
      if (!rayTargetVisible(object) || object.userData.interactionEnabled === false) continue;
      object.updateWorldMatrix(true, false);
      const point = closestPoint(object, tip);
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(object.getWorldQuaternion(new THREE.Quaternion()));
      const delta = tip.clone().sub(point), distance = delta.length();
      const before = previous.clone().sub(point).dot(normal), front = delta.dot(normal);
      const lateral = delta.clone().addScaledVector(normal, -front).length();
      if (front >= 0.012 && front <= 0.06 && lateral < 0.008 && this.approaches.get(source)?.object !== object) this.approaches.set(source, { object, tip: tip.clone() });
      // Require an approach from the visible front, never an accidental spawn
      // inside the panel or a finger entering from its back.
      if (distance > 0.009 || front < -0.004 || (before < 0.012 && this.approaches.get(source)?.object !== object) || !eligible(object, point)) continue;
      const approach = this.approaches.get(source);
      if (approach && approach.tip.clone().sub(tip).dot(normal) < 0.002) continue;
      if (!contact || distance < contact.distance) contact = { object, point, normal, distance };
    }
    if (contact) { this.approaches.delete(source); this.presses.set(source, contact); this.events.start(source, contact); }
  }

  cancel(): void {
    for (const [source, press] of this.presses) {
      this.disarmed.set(source, press.point.clone());
      this.events.end(source, press, true);
    }
    this.presses.clear(); this.previous.clear(); this.approaches.clear();
  }
}

/** Authorizes presses as well as release callbacks dispatched independently by XR Blocks. */
export class InteractionCapture<T extends { userData: { id?: number } }> {
  private current: T | null = null;
  private readonly presses = new Map<number, { target: object | undefined; allowed: boolean; consumed: boolean }>();
  get owner(): T | null { return this.current; }

  press(source: T, target: object | undefined): boolean {
    const allowed = !this.current || this.current === source;
    this.presses.set(source.userData.id ?? -1, { target, allowed, consumed: false });
    if (allowed) this.current = source;
    return allowed;
  }
  activate(id: number, target: object): boolean {
    const press = this.presses.get(id);
    if (!press?.allowed || press.consumed || press.target !== target ||
        (this.current && this.current.userData.id !== id)) return false;
    press.consumed = true;
    return true;
  }
  release(source: T): void { if (this.current === source) this.current = null; }
  cancel(): void { this.current = null; this.presses.clear(); }
}

export type Controller = xb.SelectEvent["target"];

export const INTERACTION_LAYER = 1;
export const EMPTY_RAY_LENGTH_M = 3;
export const IDLE_LASER_OPACITY = 0.6;

export const UI_CONTROL_RAY_PRIORITY = -1;

/** Only explicit application surfaces participate in the SDK's one hit list. */
export function registerRayTarget(mesh: THREE.Mesh): void {
  mesh.layers.enable(INTERACTION_LAYER);
  mesh.userData.rayTarget = true;
  const raycast = mesh.raycast;
  mesh.raycast = function (raycaster, hits) {
    let node: THREE.Object3D | null = this;
    while (node) {
      if (!node.visible || node.userData.rayDisabled === true) return;
      node = node.parent;
    }
    raycast.call(this, raycaster, hits);
  };
}

/** Blocks the ray without counting as a hover target for laser feedback. */
export function markRayPassive(mesh: THREE.Object3D): void {
  mesh.userData.rayPassive = true;
}

/** An invisible surface such as the floor: it does not reveal the laser on its own. */
export function markRayAmbient(mesh: THREE.Object3D): void {
  mesh.userData.rayAmbient = true;
}

const vertexShader = /* glsl */ `
  uniform vec3 uP0;
  uniform vec3 uP1;
  uniform vec3 uP2;
  uniform float uRadius;
  uniform float uTipRadius;
  varying float vStartDistance;
  void main() {
    float t = position.y + 0.5;
    float u = 1.0 - t;
    vec3 center = u * u * uP0 + 2.0 * u * t * uP1 + t * t * uP2;
    vec3 tangent = normalize(2.0 * u * (uP1 - uP0) + 2.0 * t * (uP2 - uP1) + vec3(0.0, 0.0, 1e-6));
    vec3 reference = abs(tangent.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 side = normalize(cross(tangent, reference));
    vec3 up = cross(tangent, side);
    float startDistance = distance(center, uP0);
    float taper = smoothstep(0.0, 0.05, startDistance);
    vec3 world = center + (side * position.x + up * position.z) * mix(uRadius, uTipRadius, t) * taper;
    vStartDistance = startDistance;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vStartDistance;
  void main() {
    gl_FragColor = vec4(uColor, uOpacity * smoothstep(0.0, 0.05, vStartDistance));
    #include <colorspace_fragment>
  }
`;

type BeamMesh = THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;

export type LaserBeam = {
  mesh: BeamMesh;
  outline: BeamMesh;
  tip: THREE.Vector3;
  opacity: number;
  reveal: number;
  affordance: THREE.Object3D | null;
  fresh: boolean;
};

export class XRBlocksRayInteraction {
  readonly direct = new WebXRDirectInteraction();
  readonly beams = new Map<Controller, LaserBeam>();
  // Open-ended tube; position.y spans the curve parameter and xz the ring.
  private readonly geometry = new THREE.CylinderGeometry(1, 1, 1, 6, 32, true);
  private readonly styledReticles = new Set<xb.Reticle>();
  private enabled = false;
  private readonly anchors = new Map<Controller, { object: THREE.Object3D; local: THREE.Vector3 }>();
  private readonly dragDirections = new Map<Controller, { direction: THREE.Vector3; at: number }>();

  capture(controller: Controller, object: THREE.Object3D, point: THREE.Vector3): void {
    object.updateWorldMatrix(true, false);
    this.anchors.set(controller, { object, local: object.worldToLocal(point.clone()) });
    this.dragDirections.delete(controller);
  }

  releaseCaptures(): void { this.anchors.clear(); this.dragDirections.clear(); }

  presencePointers(): PresencePointer[] {
    const result: PresencePointer[] = [];
    for (const [controller, beam] of this.beams) {
      if (!beam.mesh.visible || beam.mesh.material.uniforms.uOpacity.value <= .01) continue;
      const id = controller.inputSource?.handedness === "left" ? 0 : 1;
      if (result.some(p => p.id === id)) continue;
      const point = (name: string) => webxrToClientTrackingPoint(beam.mesh.material.uniforms[name].value.toArray());
      result.push({ id, start: point("uP0"), control: point("uP1"), end: point("uP2"),
        opacity: beam.mesh.material.uniforms.uOpacity.value, cursor: controller.reticle?.visible === true });
    }
    return result;
  }

  /** Manipulation may move the object after the ordinary hover/beam update. */
  updateCapturedEndpoints(): void {
    for (const [controller] of this.anchors) {
      const target = this.capturedPoint(controller), beam = this.beams.get(controller);
      if (!target || !beam) continue;
      const ray = this.ray(controller);
      const origin = new THREE.Vector3(...ray.origin), direction = new THREE.Vector3(...ray.direction);
      beam.tip.copy(target);
      for (const mesh of [beam.mesh, beam.outline]) {
        mesh.material.uniforms.uP0.value.copy(origin);
        mesh.material.uniforms.uP1.value.copy(origin).addScaledVector(direction, origin.distanceTo(target) * 0.5);
        mesh.material.uniforms.uP2.value.copy(target);
      }
      controller.reticle?.position.copy(target);
    }
  }

  private capturedPoint(controller: Controller): THREE.Vector3 | null {
    const anchor = this.anchors.get(controller);
    if (!anchor) return null;
    if (!anchor.object.parent || !rayTargetVisible(anchor.object)) {
      this.anchors.delete(controller); this.dragDirections.delete(controller); return null;
    }
    anchor.object.updateWorldMatrix(true, false);
    return anchor.object.localToWorld(anchor.local.clone());
  }
  private policy: {
    eligible: (controller: Controller, object: THREE.Object3D, point: THREE.Vector3) => boolean;
    ignored?: (controller: Controller, object: THREE.Object3D) => boolean;
    captured: (controller: Controller) => boolean;
    unobstructed: (object: THREE.Object3D, origin: THREE.Vector3, point: THREE.Vector3) => boolean;
  } = { eligible: (_controller, object) => object.userData.rayPassive !== true && object.userData.rayAmbient !== true && object.userData.interactionEnabled !== false,
    captured: () => false, unobstructed: () => true };

  setPolicy(policy: typeof this.policy): void { this.policy = policy; }
  private readonly originalRaycast: xb.Input["performRaycastOnScene"];

  constructor(private readonly input: xb.Input) {
    this.originalRaycast = input.performRaycastOnScene;
    input.performRaycastOnScene = controller => {
      this.originalRaycast.call(input, controller);
      const hits = input.intersectionsForController.get(controller);
      if (hits && this.policy.ignored) for (let i = hits.length - 1; i >= 0; i--) if (this.policy.ignored(controller, hits[i].object)) hits.splice(i, 1);
      const near = this.enabled ? this.direct.resolve(controller, input.scene, (object, point) => this.policy.eligible(controller, object, point)) : undefined;
      if (hits && (near || this.direct.isDirect(controller))) { hits.length = 0; if (near) hits.push(near); }
      hits?.sort(compareRayHits);
    };
    input.raycaster.layers.set(INTERACTION_LAYER);
    input.raycaster.near = 0;
    input.raycaster.far = RAY_LENGTH_M;
  }

  hoverTargets(preserveCapturedHoverFor?: THREE.Object3D): THREE.Object3D[] {
    const targets: THREE.Object3D[] = [];
    for (const controller of this.input.controllers) {
      if (!controller.visible || controller.userData.connected !== true) continue;
      const hit = this.hit(controller);
      // A selection press can retain its real hover; manipulation still suppresses it.
      if (this.policy.captured(controller) && (!preserveCapturedHoverFor ||
        hit?.object !== preserveCapturedHoverFor || this.anchors.get(controller)?.object !== preserveCapturedHoverFor)) continue;
      if (hit && rayTargetVisible(hit.object) && this.policy.eligible(controller, hit.object, hit.point)) targets.push(hit.object);
    }
    return targets;
  }

  hit(controller: Controller): THREE.Intersection | undefined {
    return resolveRayHit(this.input.intersectionsForController.get(controller) ?? []);
  }

  ray(controller: Controller): { origin: Vec3; direction: Vec3 } {
    this.input.setRaycasterFromController(controller);
    return {
      origin: this.input.raycaster.ray.origin.toArray() as Vec3,
      direction: this.input.raycaster.ray.direction.toArray() as Vec3,
    };
  }

  /** The ray toward the smoothed laser tip, for drags that should not inherit hand jitter. */
  smoothedRay(controller: Controller): { origin: Vec3; direction: Vec3 } {
    const ray = this.ray(controller);
    if (this.anchors.has(controller)) {
      const now = performance.now();
      const target = new THREE.Vector3(...ray.direction);
      const previous = this.dragDirections.get(controller);
      const direction = previous ? previous.direction.lerp(target, 1 - Math.exp(-20 * Math.max(0, now - previous.at) / 1000)).normalize() : target;
      this.dragDirections.set(controller, { direction, at: now });
      return { origin: ray.origin, direction: direction.toArray() as Vec3 };
    }
    const beam = this.beams.get(controller);
    if (!beam || beam.fresh) return ray;
    const direction = beam.tip.clone().sub(new THREE.Vector3(...ray.origin));
    if (direction.lengthSq() < 1e-8) return ray;
    return { origin: ray.origin, direction: direction.normalize().toArray() as Vec3 };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.releaseCaptures();
      this.direct.reset();
      for (const [controller, beam] of this.beams) {
        this.hide(controller, beam);
      }
    }
  }

  update(deltaS = 1 / 60): void {
    const targets: THREE.Mesh[] = [];
    this.input.scene?.updateMatrixWorld(true);
    this.input.scene?.traverse(object => {
      if (object instanceof THREE.Mesh && object.userData.rayTarget && object.userData.proximityTarget !== false && object.userData.rayAmbient !== true && rayTargetVisible(object)) targets.push(object);
    });
    for (const controller of this.input.controllers) {
      if (!controller.inputSource) continue;
      const active = !this.direct.isDirect(controller) && this.enabled && controller.inputSource.targetRayMode === "tracked-pointer" &&
        controller.userData.connected === true && controller.visible;
      let beam = this.beams.get(controller);
      if (!active) {
        this.anchors.delete(controller); this.dragDirections.delete(controller);
        if (beam) this.hide(controller, beam);
        else if (controller.reticle) controller.reticle.visible = false;
        continue;
      }
      if (!beam) {
        beam = this.createBeam();
        // Visuals stay on render layer 0, outside INTERACTION_LAYER.
        controller.add(beam.outline, beam.mesh);
        this.beams.set(controller, beam);
      }
      const hit = this.hit(controller);
      const ray = this.ray(controller);
      const origin = new THREE.Vector3(...ray.origin);
      const direction = new THREE.Vector3(...ray.direction);
      const actionable = !!hit && this.policy.eligible(controller, hit.object, hit.point);
      let nearby: ReturnType<typeof proximityToAffordance> = null;
      if (!actionable) {
        const probe = new THREE.Ray(origin, direction);
        for (const target of targets) {
          if (target.userData.interactionEnabled === false) continue;
          const candidate = proximityToAffordance(probe, target, beam.affordance === target, RAY_LENGTH_M);
          if (!candidate || !this.policy.eligible(controller, target, candidate.point) || !this.policy.unobstructed(target, origin, candidate.point)) continue;
          if (!nearby || Number(target.userData.rayPriority ?? 0) < Number(nearby.object.userData.rayPriority ?? 0) ||
            (target.userData.rayPriority === nearby.object.userData.rayPriority && candidate.miss < nearby.miss)) nearby = candidate;
        }
      }
      const captured = this.policy.captured(controller);
      const shown = actionable || nearby !== null || captured;
      beam.affordance = actionable ? hit!.object : nearby?.object ?? null;
      const distance = actionable ? hit!.distance : nearby?.distance ?? EMPTY_RAY_LENGTH_M;
      const anchor = this.capturedPoint(controller);
      const target = anchor ?? (actionable ? hit!.point.clone() : origin.clone().addScaledVector(direction, distance));
      const opacity = actionable || captured ? 1 : IDLE_LASER_OPACITY;
      if (beam.fresh || anchor) {
        beam.tip.copy(target);
        beam.opacity = opacity;
        beam.fresh = false;
      } else {
        // Far tips follow more slowly, which hides angular hand jitter at range.
        const rate = THREE.MathUtils.clamp(40 / (1 + origin.distanceTo(target)), 10, 40);
        beam.tip.lerp(target, 1 - Math.exp(-rate * deltaS));
        beam.opacity += (opacity - beam.opacity) * (1 - Math.exp(-18 * deltaS));
      }
      beam.reveal = THREE.MathUtils.clamp(beam.reveal + (shown ? 1 : -1) * deltaS / (shown ? 0.18 : 0.24), 0, 1);
      // The beam grows out of the hand and retracts into it.
      const extent = anchor ? 1 : 1 - (1 - beam.reveal) ** 3;
      const end = origin.clone().lerp(beam.tip, extent);
      const visualStart = origin.clone().addScaledVector(direction, Math.min(0.03, Math.max(0, origin.distanceTo(end) - 0.005)));
      const bend = visualStart.clone().addScaledVector(direction, visualStart.distanceTo(end) * 0.5);
      const color = 0xffffff;
      for (const mesh of [beam.mesh, beam.outline]) {
        const uniforms = mesh.material.uniforms;
        uniforms.uP0.value.copy(visualStart);
        uniforms.uP1.value.copy(bend);
        uniforms.uP2.value.copy(end);
        mesh.visible = beam.reveal > 0;
      }
      beam.mesh.material.uniforms.uColor.value.setHex(color);
      beam.mesh.material.uniforms.uOpacity.value = beam.opacity * extent;
      beam.outline.material.uniforms.uOpacity.value = beam.opacity * extent * 0.6;
      const reticle = controller.reticle;
      if (reticle) {
        if (!this.styledReticles.has(reticle)) {
          reticle.geometry.scale(0.26, 0.26, 0.26);
          this.styledReticles.add(reticle);
        }
        reticle.material.visible = true;
        reticle.setColor(new THREE.Color(color));
        reticle.position.copy(beam.tip);
        if (!hit) reticle.quaternion.copy(controller.getWorldQuaternion(new THREE.Quaternion()));
        reticle.visible = actionable && beam.reveal >= 0.99;
      }
    }
  }

  dispose(): void {
    this.releaseCaptures();
    this.input.performRaycastOnScene = this.originalRaycast;
    for (const beam of this.beams.values()) {
      for (const mesh of [beam.mesh, beam.outline]) {
        mesh.removeFromParent();
        mesh.material.dispose();
      }
    }
    this.geometry.dispose();
    this.beams.clear();
  }

  private hide(controller: Controller, beam: LaserBeam): void {
    beam.mesh.visible = beam.outline.visible = false;
    beam.fresh = true;
    beam.reveal = 0;
    beam.affordance = null;
    if (controller.reticle) controller.reticle.visible = false;
  }

  private createBeam(): LaserBeam {
    const mesh = this.beamMesh(0xffffff, 0.0016, 0.0011);
    mesh.name = "XR Blocks laser";
    mesh.renderOrder = 1001;
    const outline = this.beamMesh(0x111111, 0.0028, 0.0019);
    outline.name = "XR Blocks laser outline";
    outline.renderOrder = 1000;
    return { mesh, outline, tip: new THREE.Vector3(), opacity: IDLE_LASER_OPACITY, reveal: 0, affordance: null, fresh: true };
  }

  private beamMesh(color: number, radius: number, tipRadius: number): BeamMesh {
    const mesh = new THREE.Mesh(this.geometry, new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uP0: { value: new THREE.Vector3() },
        uP1: { value: new THREE.Vector3() },
        uP2: { value: new THREE.Vector3() },
        uRadius: { value: radius },
        uTipRadius: { value: tipRadius },
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: 1 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }));
    // Vertices are placed in world space by the shader, so bounds are meaningless.
    mesh.frustumCulled = false;
    mesh.raycast = () => {};
    return mesh;
  }
}

/** One precedence rule for hover, laser endpoints and press dispatch. */
export function resolveRayHit(hits: readonly THREE.Intersection[]): THREE.Intersection | undefined {
  return [...hits].sort(compareRayHits)[0];
}

export function preferredPointer(controllers: readonly Controller[]): Controller | undefined {
  const tracked = controllers.filter(controller => controller.visible && controller.userData.connected === true &&
    controller.inputSource?.targetRayMode === "tracked-pointer");
  return tracked.find(controller => controller.inputSource?.handedness === "right") ??
    tracked.find(controller => controller.inputSource?.handedness === "left") ?? tracked[0];
}

function compareRayHits(a: THREE.Intersection, b: THREE.Intersection): number {
  return Number(a.object.userData.rayPriority ?? 0) - Number(b.object.userData.rayPriority ?? 0) || a.distance - b.distance;
}
