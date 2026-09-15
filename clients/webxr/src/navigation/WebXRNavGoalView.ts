import * as THREE from "three";
import type { Quat, Vec3 } from "@dimos-ar-client/websocket/protocolTypes";
import { RAY_LENGTH_M } from "./WebXRGroundPlacement";

export type NavFlash = "cancelled" | "failed";

const IDLE_COLOR = 0xffffff;
const ACTIVE_COLOR = 0xffcc33;
const FLASH_COLORS: Record<NavFlash, number> = {
  cancelled: 0xffd900,
  failed: 0xff0000,
};

export class WebXRNavGoalView {
  readonly object: THREE.Group;
  readonly cancelObject: THREE.Mesh;
  private readonly disc: THREE.Mesh;
  private readonly arrow: THREE.Mesh;
  private readonly discMaterial: THREE.MeshStandardMaterial;
  private readonly arrowMaterial: THREE.MeshStandardMaterial;
  private readonly cancelMaterial: THREE.MeshStandardMaterial;

  constructor() {
    this.object = new THREE.Group();
    this.object.name = "WebXRNavGoalView";
    this.discMaterial = new THREE.MeshStandardMaterial({ color: IDLE_COLOR });
    this.disc = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.02, 32), this.discMaterial);
    this.arrowMaterial = new THREE.MeshStandardMaterial({ color: IDLE_COLOR });
    this.arrow = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 12), this.arrowMaterial);
    this.arrow.rotation.x = Math.PI / 2;
    this.arrow.position.set(0, 0.04, -0.22);
    this.cancelMaterial = new THREE.MeshStandardMaterial({ color: 0xff3333 });
    this.cancelObject = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 16), this.cancelMaterial);
    this.cancelObject.name = "WebXRNavGoalCancel";
    this.cancelObject.position.set(0, 0.22, 0);
    this.cancelObject.visible = false;
    this.object.add(this.disc, this.arrow, this.cancelObject);
    this.object.visible = false;
  }

  setPose(position: Vec3, orientation: Quat): void {
    this.object.position.set(position[0], position[1], position[2]);
    this.object.quaternion.set(orientation[0], orientation[1], orientation[2], orientation[3]);
  }

  pose(): { position: Vec3; orientation: Quat } {
    return {
      position: [this.object.position.x, this.object.position.y, this.object.position.z],
      orientation: [
        this.object.quaternion.x,
        this.object.quaternion.y,
        this.object.quaternion.z,
        this.object.quaternion.w,
      ],
    };
  }

  show(): void {
    this.object.visible = true;
  }

  hide(): void {
    this.object.visible = false;
    this.cancelObject.visible = false;
  }

  setGoalActive(active: boolean): void {
    const color = active ? ACTIVE_COLOR : IDLE_COLOR;
    this.discMaterial.color.setHex(color);
    this.arrowMaterial.color.setHex(color);
  }

  setCancelVisible(visible: boolean): void {
    this.cancelObject.visible = visible && this.object.visible;
  }

  setFlash(flash: NavFlash | null): void {
    if (!flash) {
      this.setGoalActive(false);
      return;
    }
    const color = FLASH_COLORS[flash];
    this.discMaterial.color.setHex(color);
    this.arrowMaterial.color.setHex(color);
  }

  hitCancel(rayFrom: Vec3, rayDir: Vec3): boolean {
    if (!this.cancelObject.visible) {
      return false;
    }
    return rayHitsObject(rayFrom, rayDir, this.cancelObject);
  }

  dispose(): void {
    this.object.removeFromParent();
    this.disc.geometry.dispose();
    this.arrow.geometry.dispose();
    this.cancelObject.geometry.dispose();
    this.discMaterial.dispose();
    this.arrowMaterial.dispose();
    this.cancelMaterial.dispose();
  }
}

export function rayHitsObject(rayFrom: Vec3, rayDir: Vec3, object: THREE.Object3D): boolean {
  const direction = new THREE.Vector3(rayDir[0], rayDir[1], rayDir[2]);
  if (direction.lengthSq() <= 1e-8) {
    return false;
  }
  direction.normalize();
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(rayFrom[0], rayFrom[1], rayFrom[2]),
    direction,
    0,
    RAY_LENGTH_M,
  );
  return raycaster.intersectObject(object, true).length > 0;
}
