import * as THREE from "three";
import { Text } from "troika-three-text";
import type { Quat, Vec3 } from "@dimos-ar-client/websocket/protocolTypes";
import { registerRayTarget } from "../input/XRBlocksRayInteraction";
import { GlassSurface } from "../presentation/glassMaterial";
import { syncText, UI_FONT_SEMIBOLD } from "../presentation/fonts";

export type NavFlash = "cancelled" | "failed";

const MARKER_COLOR = 0xffffff;
const IDLE_OPACITY = 0.5;
const FLASH_COLORS: Record<NavFlash, number> = { cancelled: 0xff453a, failed: 0xff9f0a };
const CANCEL_DIAMETER_M = 0.12;

export class WebXRNavGoalView {
  readonly object: THREE.Group;
  readonly cancelObject: GlassSurface;
  private readonly cancelRoot = new THREE.Group();
  private readonly cancelLabel: Text;
  private readonly glyph: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly disc: THREE.Mesh;
  private readonly arrow: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly discMaterial: THREE.MeshBasicMaterial;
  private readonly arrowMaterial: THREE.MeshBasicMaterial;
  private readonly ringMaterial: THREE.MeshBasicMaterial;
  private readonly glyphMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, depthWrite: false });

  constructor() {
    this.object = new THREE.Group();
    this.object.name = "WebXRNavGoalView";
    this.discMaterial = new THREE.MeshBasicMaterial({ visible: false });
    this.disc = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.018, 48), this.discMaterial);
    this.disc.name = "Navigation hit surface";
    this.arrowMaterial = markerMaterial();
    const arrow = new THREE.Shape();
    arrow.moveTo(0, 0.1); arrow.lineTo(-0.065, 0.02); arrow.lineTo(-0.023, 0.02);
    arrow.lineTo(-0.023, -0.085); arrow.lineTo(0.023, -0.085);
    arrow.lineTo(0.023, 0.02); arrow.lineTo(0.065, 0.02); arrow.closePath();
    this.arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrow), this.arrowMaterial);
    this.arrow.name = "NavigationHeading";
    this.arrow.rotation.x = -Math.PI / 2;
    this.arrow.position.set(0, 0.023, 0);
    this.arrow.scale.setScalar(1.3);
    this.ringMaterial = markerMaterial();
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.268, 128), this.ringMaterial);
    this.ring.name = "NavigationCircle";
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.015;

    this.cancelObject = new GlassSurface({ width: CANCEL_DIAMETER_M, height: CANCEL_DIAMETER_M, radius: CANCEL_DIAMETER_M / 2, tint: "#ff453a", alpha: 1, rim: 0.12, rimWidth: 0.002 });
    this.cancelObject.name = "WebXRNavGoalCancel";
    for (const angle of [Math.PI / 4, -Math.PI / 4]) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.044, 0.0065), this.glyphMaterial);
      bar.rotation.z = angle;
      bar.position.z = 0.002;
      bar.raycast = () => {};
      this.glyph.push(bar);
    }
    this.cancelLabel = new Text();
    this.cancelLabel.text = "Cancel";
    this.cancelLabel.font = UI_FONT_SEMIBOLD;
    this.cancelLabel.fontSize = 0.026;
    this.cancelLabel.anchorX = "center";
    this.cancelLabel.anchorY = "middle";
    this.cancelLabel.color = 0xffffff;
    this.cancelLabel.position.set(0, -CANCEL_DIAMETER_M / 2 - 0.028, 0.002);
    this.cancelLabel.raycast = () => {};
    syncText(this.cancelLabel);
    this.cancelRoot.name = "Navigation cancel button";
    this.cancelRoot.position.set(0, 0.38, 0);
    this.cancelRoot.add(this.cancelObject, ...this.glyph, this.cancelLabel);
    this.cancelRoot.visible = false;

    this.object.add(this.disc, this.arrow, this.ring, this.cancelRoot);
    this.object.visible = false;
    for (const mesh of [this.disc, this.arrow, this.ring, this.cancelObject]) registerRayTarget(mesh);
    this.setGoalActive(false);
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
    this.cancelRoot.visible = false;
  }

  setGoalActive(active: boolean): void {
    this.setMarkerStyle(MARKER_COLOR, active ? 1 : IDLE_OPACITY);
  }

  setCancelVisible(visible: boolean): void {
    this.cancelRoot.visible = visible && this.object.visible;
  }

  cancelVisible(): boolean {
    return this.cancelRoot.visible;
  }

  /** Yaw-only billboard toward the viewer, independent of the goal heading. */
  update(eye: THREE.Vector3, cancelHovered: boolean): void {
    this.object.updateWorldMatrix(true, false);
    const center = this.cancelRoot.getWorldPosition(new THREE.Vector3());
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(eye.x - center.x, eye.z - center.z));
    this.cancelRoot.quaternion.copy(this.object.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(yaw));
    this.cancelObject.setHover(cancelHovered ? 1 : 0);
    this.cancelObject.step();
    const scale = 1 + this.cancelObject.hover() * 0.08;
    this.cancelRoot.scale.setScalar(scale);
  }

  setFlash(flash: NavFlash | null): void {
    if (!flash) {
      this.setGoalActive(false);
      return;
    }
    this.setMarkerStyle(FLASH_COLORS[flash], 1);
  }

  dispose(): void {
    this.object.removeFromParent();
    this.disc.geometry.dispose();
    this.arrow.geometry.dispose();
    this.ring.geometry.dispose();
    this.cancelObject.dispose();
    for (const bar of this.glyph) bar.geometry.dispose();
    this.cancelLabel.dispose();
    this.discMaterial.dispose();
    this.arrowMaterial.dispose();
    this.ringMaterial.dispose();
    this.glyphMaterial.dispose();
  }

  private setMarkerStyle(color: number, opacity: number): void {
    for (const material of [this.arrowMaterial, this.ringMaterial]) {
      material.color.setHex(color);
      material.opacity = opacity;
    }
  }
}

function markerMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: MARKER_COLOR, side: THREE.DoubleSide, toneMapped: false, transparent: true, depthWrite: false });
}
