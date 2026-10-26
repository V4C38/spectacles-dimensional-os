import { WebXRDirectInteraction } from "./WebXRDirectInteraction";
import * as THREE from "three";
import { proximityToAffordance, rayTargetVisible } from "./AffordanceProximity";
import type * as xb from "xrblocks";
import { RAY_LENGTH_M } from "../navigation/WebXRGroundPlacement";
import type { Vec3 } from "@dimos-ar-client/websocket/protocolTypes";

export type Controller = xb.SelectEvent["target"];

export const INTERACTION_LAYER = 1;
export const EMPTY_RAY_LENGTH_M = 3;
export const IDLE_LASER_OPACITY = 0.6;

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
