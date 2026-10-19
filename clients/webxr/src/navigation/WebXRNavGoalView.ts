import * as THREE from "three";
import type { Quat, Vec3 } from "@dimos-ar-client/websocket/protocolTypes";
import { registerRayTarget } from "../input/XRBlocksRayInteraction";

export type NavFlash = "cancelled" | "failed";

const IDLE_COLOR = 0xffffff;
const ACTIVE_COLOR = 0xffffff;
const FLASH_COLORS: Record<NavFlash, number> = { cancelled: ACTIVE_COLOR, failed: ACTIVE_COLOR };

export class WebXRNavGoalView {
  readonly object: THREE.Group;
  readonly cancelObject: THREE.Mesh;
  private readonly disc: THREE.Mesh;
  private readonly arrow: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly discMaterial: THREE.MeshBasicMaterial;
  private readonly arrowMaterial: THREE.MeshBasicMaterial;
  private readonly ringMaterial: THREE.MeshBasicMaterial;
  private readonly cancelMaterial: THREE.MeshStandardMaterial;

  constructor() {
    this.object = new THREE.Group();
    this.object.name = "WebXRNavGoalView";
    this.discMaterial = new THREE.MeshBasicMaterial({ visible: false });
    this.disc = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.018, 48), this.discMaterial);
    this.disc.name = "Navigation hit surface";
    this.arrowMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, toneMapped: false });
    const arrow = new THREE.Shape();
    arrow.moveTo(0, 0.1); arrow.lineTo(-0.065, 0.02); arrow.lineTo(-0.023, 0.02);
    arrow.lineTo(-0.023, -0.085); arrow.lineTo(0.023, -0.085);
    arrow.lineTo(0.023, 0.02); arrow.lineTo(0.065, 0.02); arrow.closePath();
    this.arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrow), this.arrowMaterial);
    this.arrow.name = "NavigationHeading";
    this.arrow.rotation.x = -Math.PI / 2;
    this.arrow.position.set(0, 0.023, 0);
    this.ringMaterial = new THREE.MeshBasicMaterial({ color: IDLE_COLOR, side: THREE.DoubleSide, toneMapped: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.166, 96), this.ringMaterial);
    this.ring.name = "NavigationCircle";
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.015;
    this.cancelMaterial = new THREE.MeshStandardMaterial({ color: ACTIVE_COLOR, emissive: ACTIVE_COLOR, emissiveIntensity: 0.12 });
    this.cancelObject = new THREE.Mesh(new THREE.OctahedronGeometry(0.04, 0), this.cancelMaterial);
    this.cancelObject.name = "WebXRNavGoalCancel";
    this.cancelObject.position.set(0, 0.22, 0);
    this.cancelObject.visible = false;
    this.object.add(this.disc, this.arrow, this.cancelObject);
    this.object.add(this.ring);
    this.object.visible = false;
    for (const mesh of [this.disc, this.arrow, this.ring, this.cancelObject]) registerRayTarget(mesh);
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
    this.arrowMaterial.color.setHex(color);
    this.ringMaterial.color.setHex(color);
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
    this.cancelMaterial.color.setHex(color);
  }

  dispose(): void {
    this.object.removeFromParent();
    this.disc.geometry.dispose();
    this.arrow.geometry.dispose();
    this.ring.geometry.dispose();
    this.cancelObject.geometry.dispose();
    this.discMaterial.dispose();
    this.arrowMaterial.dispose();
    this.ringMaterial.dispose();
    this.cancelMaterial.dispose();
  }
}
