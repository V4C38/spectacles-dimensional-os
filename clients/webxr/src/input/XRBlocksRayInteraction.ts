import * as THREE from "three";
import type * as xb from "xrblocks";
import { RAY_LENGTH_M } from "../navigation/WebXRGroundPlacement";
import type { Vec3 } from "@dimos-ar-client/websocket/protocolTypes";

type Controller = xb.SelectEvent["target"];

export const INTERACTION_LAYER = 1;
export const EMPTY_RAY_LENGTH_M = 3;
export const IDLE_LASER_OPACITY = 0.5;
// Hand reach in front of the head, along the flattened view direction.
export const AIM_SHOW_REACH_M = 0.34;
export const AIM_HIDE_REACH_M = 0.27;
const REVEAL_DURATION_S = 0.14;

/** Only explicit application surfaces participate in the SDK's one hit list. */
export function registerRayTarget(mesh: THREE.Mesh): void {
  mesh.layers.enable(INTERACTION_LAYER);
  const raycast = mesh.raycast;
  mesh.raycast = function (raycaster, hits) {
    let node: THREE.Object3D | null = this;
    while (node) {
      if (!node.visible) return;
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

export type HeadPose = { position: THREE.Vector3; quaternion: THREE.Quaternion };

const vertexShader = /* glsl */ `
  uniform vec3 uP0;
  uniform vec3 uP1;
  uniform vec3 uP2;
  uniform float uRadius;
  uniform float uTipRadius;
  varying float vT;
  void main() {
    float t = position.y + 0.5;
    float u = 1.0 - t;
    vec3 center = u * u * uP0 + 2.0 * u * t * uP1 + t * t * uP2;
    vec3 tangent = normalize(2.0 * u * (uP1 - uP0) + 2.0 * t * (uP2 - uP1) + vec3(0.0, 0.0, 1e-6));
    vec3 reference = abs(tangent.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 side = normalize(cross(tangent, reference));
    vec3 up = cross(tangent, side);
    vec3 world = center + (side * position.x + up * position.z) * mix(uRadius, uTipRadius, t);
    vT = t;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vT;
  void main() {
    gl_FragColor = vec4(uColor, uOpacity * mix(0.3, 1.0, smoothstep(0.0, 0.15, vT)));
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
  aimed: boolean;
  fresh: boolean;
};

export class XRBlocksRayInteraction {
  readonly beams = new Map<Controller, LaserBeam>();
  // Open-ended tube; position.y spans the curve parameter and xz the ring.
  private readonly geometry = new THREE.CylinderGeometry(1, 1, 1, 6, 32, true);
  private readonly styledReticles = new Set<xb.Reticle>();
  private enabled = false;

  constructor(private readonly input: xb.Input) {
    input.raycaster.layers.set(INTERACTION_LAYER);
    input.raycaster.near = 0;
    input.raycaster.far = RAY_LENGTH_M;
  }

  hit(controller: Controller): THREE.Intersection | undefined {
    return this.input.intersectionsForController.get(controller)?.[0];
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
    const beam = this.beams.get(controller);
    if (!beam || beam.fresh) return ray;
    const direction = beam.tip.clone().sub(new THREE.Vector3(...ray.origin));
    if (direction.lengthSq() < 1e-8) return ray;
    return { origin: ray.origin, direction: direction.normalize().toArray() as Vec3 };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      for (const [controller, beam] of this.beams) {
        this.hide(controller, beam);
      }
    }
  }

  /** Without a head pose every ray counts as aimed. */
  update(deltaS = 1 / 60, head?: HeadPose): void {
    for (const controller of this.input.controllers) {
      if (!controller.inputSource) continue;
      const active = this.enabled && controller.inputSource.targetRayMode === "tracked-pointer" &&
        controller.userData.connected === true && controller.visible;
      let beam = this.beams.get(controller);
      if (!active) {
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
      // Invisible surfaces like the floor only end the beam while dragging on them.
      const ends = !!hit && (hit.object.userData.rayAmbient !== true || controller.userData.selected === true);
      const target = ends ? hit.point.clone() : origin.clone().addScaledVector(direction, EMPTY_RAY_LENGTH_M);
      const hovering = !!hit && hit.object.userData.rayPassive !== true;
      const opacity = hovering ? 1 : IDLE_LASER_OPACITY;
      beam.aimed = isAimed(origin, direction, head, beam.aimed);
      const shown = (!!hit && hit.object.userData.rayAmbient !== true) || beam.aimed ||
        controller.userData.selected === true;
      if (beam.fresh) {
        beam.tip.copy(target);
        beam.opacity = opacity;
        beam.fresh = false;
      } else {
        // Far tips follow more slowly, which hides angular hand jitter at range.
        const rate = THREE.MathUtils.clamp(40 / (1 + origin.distanceTo(target)), 10, 40);
        beam.tip.lerp(target, 1 - Math.exp(-rate * deltaS));
        beam.opacity += (opacity - beam.opacity) * (1 - Math.exp(-18 * deltaS));
      }
      beam.reveal = THREE.MathUtils.clamp(beam.reveal + (shown ? 1 : -1) * deltaS / REVEAL_DURATION_S, 0, 1);
      // The beam grows out of the hand and retracts into it.
      const extent = 1 - (1 - beam.reveal) ** 3;
      const end = origin.clone().lerp(beam.tip, extent);
      const bend = origin.clone().addScaledVector(direction, origin.distanceTo(end) * 0.5);
      const color = controller.userData.selected ? 0x0a84ff : 0xffffff;
      for (const mesh of [beam.mesh, beam.outline]) {
        const uniforms = mesh.material.uniforms;
        uniforms.uP0.value.copy(origin);
        uniforms.uP1.value.copy(bend);
        uniforms.uP2.value.copy(end);
        mesh.visible = beam.reveal > 0;
      }
      beam.mesh.material.uniforms.uColor.value.setHex(color);
      beam.mesh.material.uniforms.uOpacity.value = beam.opacity * extent;
      beam.outline.material.uniforms.uOpacity.value = beam.opacity * extent * 0.5;
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
        reticle.visible = beam.reveal >= 1;
      }
    }
  }

  dispose(): void {
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
    beam.aimed = false;
    if (controller.reticle) controller.reticle.visible = false;
  }

  private createBeam(): LaserBeam {
    const mesh = this.beamMesh(0xffffff, 0.0016, 0.0011);
    mesh.name = "XR Blocks laser";
    mesh.renderOrder = 1001;
    const outline = this.beamMesh(0x111111, 0.0028, 0.0019);
    outline.name = "XR Blocks laser outline";
    outline.renderOrder = 1000;
    return { mesh, outline, tip: new THREE.Vector3(), opacity: IDLE_LASER_OPACITY, reveal: 0, aimed: false, fresh: true };
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

/** A hand held out in front of the head and pointing roughly forward, with hysteresis. */
function isAimed(origin: THREE.Vector3, direction: THREE.Vector3, head: HeadPose | undefined, wasAimed: boolean): boolean {
  if (!head) return true;
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(head.quaternion);
  const flat = forward.clone().setY(0);
  if (flat.lengthSq() < 1e-6) return wasAimed;
  flat.normalize();
  const reach = origin.clone().sub(head.position).dot(flat);
  const pointing = direction.dot(flat);
  return wasAimed
    ? reach > AIM_HIDE_REACH_M && pointing > 0.3
    : reach > AIM_SHOW_REACH_M && pointing > 0.55;
}
