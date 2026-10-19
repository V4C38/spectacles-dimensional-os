import * as THREE from "three";
import type * as xb from "xrblocks";
import { RAY_LENGTH_M } from "../navigation/WebXRGroundPlacement";
import type { Vec3 } from "@dimos-ar-client/websocket/protocolTypes";

type Controller = xb.SelectEvent["target"];

export const INTERACTION_LAYER = 1;
export const EMPTY_RAY_LENGTH_M = 3;

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

export class XRBlocksRayInteraction {
  readonly beams = new Map<Controller, THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>>();
  private readonly outlines = new Map<Controller, THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>>();
  private readonly geometry = new THREE.CylinderGeometry(1, 1, 1, 8).translate(0, 0.5, 0).rotateX(-Math.PI / 2);
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

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      for (const [controller, beam] of this.beams) {
        beam.visible = false;
        this.outlines.get(controller)!.visible = false;
        if (controller.reticle) controller.reticle.visible = false;
      }
    }
  }

  update(): void {
    for (const controller of this.input.controllers) {
      if (!controller.inputSource) continue;
      const active = this.enabled && controller.inputSource.targetRayMode === "tracked-pointer" &&
        controller.userData.connected === true && controller.visible;
      let beam = this.beams.get(controller);
      if (!active) {
        if (beam) { beam.visible = false; this.outlines.get(controller)!.visible = false; }
        if (controller.reticle) controller.reticle.visible = false;
        continue;
      }
      if (!beam) {
        beam = new THREE.Mesh(this.geometry, this.material(0xffffff));
        beam.name = "XR Blocks laser";
        const outline = new THREE.Mesh(this.geometry, this.material(0x111111));
        outline.name = "XR Blocks laser outline";
        beam.renderOrder = 1001;
        outline.renderOrder = 1000;
        beam.frustumCulled = outline.frustumCulled = false;
        // Visuals stay on render layer 0, outside INTERACTION_LAYER.
        controller.add(outline, beam);
        this.beams.set(controller, beam);
        this.outlines.set(controller, outline);
      }
      const hit = this.hit(controller);
      const length = hit?.distance ?? EMPTY_RAY_LENGTH_M;
      const outline = this.outlines.get(controller)!;
      beam.scale.set(0.0016, 0.0016, length);
      outline.scale.set(0.0028, 0.0028, length);
      beam.material.color.setHex(controller.userData.selected ? 0xff8a24 : 0xffffff);
      beam.visible = outline.visible = true;
      const reticle = controller.reticle;
      if (reticle) {
        if (!this.styledReticles.has(reticle)) {
          reticle.geometry.scale(0.26, 0.26, 0.26);
          this.styledReticles.add(reticle);
        }
        reticle.material.visible = true;
        reticle.setColor(beam.material.color);
        if (!hit) {
          const ray = this.ray(controller);
          reticle.position.fromArray(ray.origin).addScaledVector(new THREE.Vector3(...ray.direction), length);
          reticle.quaternion.copy(controller.getWorldQuaternion(new THREE.Quaternion()));
        }
        reticle.visible = true;
      }
    }
  }

  dispose(): void {
    for (const mesh of [...this.beams.values(), ...this.outlines.values()]) {
      mesh.removeFromParent();
      mesh.material.dispose();
    }
    this.geometry.dispose();
    this.beams.clear();
    this.outlines.clear();
  }

  private material(color: number): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, toneMapped: false });
  }
}
