import * as THREE from "three";
import { Text } from "troika-three-text";
import type { Quat, Vec3 } from "@dimos-ar-client/websocket/protocolTypes";
import { registerRayTarget } from "../input/XRBlocksRayInteraction";
import { disposeTextResources } from "../presentation/TextResources";
import { GlassSurface } from "../presentation/GlassSurface";
import { syncText, UI_FONT_SEMIBOLD } from "../presentation/UIFonts";

import type { NavFlash } from "@dimos-ar-client/navigation/NavigationInteraction";
export type { NavFlash } from "@dimos-ar-client/navigation/NavigationInteraction";

const MARKER_COLOR = 0xffffff;
const IDLE_OPACITY = 0.25;
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

  private readonly visuals = new THREE.Group();
  private readonly connector = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(0, 0.275, 0)]), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.002, gapSize: 0.006, transparent: true, opacity: 0.5, depthWrite: false }));
  private selected = false;
  private hovered = false;
  private dragging = false;
  private following = false;
  private opacity = IDLE_OPACITY;
  private visualScale = 1;
  private pulseTime = 0;
  private motion = 0;
  private aiming = false;
  private flash: NavFlash | null = null;

  constructor() {
    this.object = new THREE.Group();
    this.object.name = "WebXRNavGoalView";
    this.discMaterial = new THREE.MeshBasicMaterial({ visible: false });
    this.disc = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.018, 48), this.discMaterial);
    this.disc.name = "Navigation hit surface";
    this.arrowMaterial = markerMaterial();
    const arrow = new THREE.Shape();
    arrow.moveTo(0, 0.1); arrow.lineTo(-0.05, 0.02); arrow.lineTo(-0.014, 0.02);
    arrow.lineTo(-0.014, -0.085); arrow.lineTo(0.014, -0.085);
    arrow.lineTo(0.014, 0.02); arrow.lineTo(0.05, 0.02); arrow.closePath();
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

    this.connector.name = "Navigation cancel connector";
    this.connector.computeLineDistances(); this.connector.raycast = () => {};
    this.visuals.add(this.arrow, this.ring);
    this.object.add(this.disc, this.visuals, this.cancelRoot, this.connector);
    this.object.visible = false;
    // Proximity uses the circular hit surface, not the decorative arrow/ring bounding boxes.
    this.arrow.userData.proximityTarget = this.ring.userData.proximityTarget = false;
    for (const mesh of [this.disc, this.arrow, this.ring, this.cancelObject]) {
      mesh.userData.rayPriority = 10;
      registerRayTarget(mesh);
    }
    this.applyStyle(0);
  }

  setPose(position: Vec3, orientation: Quat): void {
    this.object.position.set(position[0], position[1], position[2]);
    this.object.quaternion.set(orientation[0], orientation[1], orientation[2], orientation[3]);
  }

  circleBounds(): { center: Vec3; radius: number } {
    const center = this.ring.getWorldPosition(new THREE.Vector3()).toArray() as Vec3;
    return { center, radius: 0.268 * this.ring.getWorldScale(new THREE.Vector3()).x };
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
    this.cancelRoot.visible = this.connector.visible = false;
  }

  setGoalActive(_active: boolean): void { /* Goal existence is independent of following state. */ }
  setInteraction(dragging: boolean, following: boolean): void { this.dragging = dragging; this.following = following; }
  setHovered(hovered: boolean): void { this.hovered = hovered; }
  setSelected(selected: boolean): void { this.selected = selected; }
  setAiming(aiming: boolean): void {
    this.aiming = aiming;
    for (const mesh of [this.disc, this.arrow, this.ring]) mesh.userData.rayDisabled = aiming;
  }

  tick(deltaS: number): void { this.applyStyle(Math.max(0, deltaS)); }

  private applyStyle(deltaS: number): void {
    const alpha = 1 - Math.exp(-32 * deltaS);
    const moving = this.following && !this.dragging && !this.aiming && !this.flash;
    this.motion += ((moving ? 1 : 0) - this.motion) * alpha;
    this.pulseTime = (this.pulseTime + deltaS) % 1.2;
    const pulse = (1 - Math.cos(this.pulseTime / 1.2 * Math.PI * 2)) / 2;
    const opacity = this.flash ? 1 : this.dragging ? 0.75 : this.aiming ? 0.25 :
      this.following ? 1 : this.selected || this.hovered ? 0.5 : IDLE_OPACITY;
    this.opacity += (opacity - this.opacity) * alpha;
    const scale = this.aiming ? 0.85 : (this.selected ? 1.15 : 1) * (this.hovered ? 1.04 : 1);
    this.visualScale += (scale - this.visualScale) * alpha;
    this.visuals.scale.setScalar(this.visualScale);
    this.disc.scale.setScalar(this.selected ? 1.15 : 1);
    this.ring.scale.setScalar(1 + 0.04 * pulse * this.motion);
    this.arrow.position.z = -0.012 * pulse * this.motion;
    this.setMarkerStyle(this.flash ? FLASH_COLORS[this.flash] : MARKER_COLOR, this.opacity);
  }

  setCancelVisible(visible: boolean): void {
    this.cancelRoot.visible = this.connector.visible = visible && this.object.visible && !this.aiming;
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
    this.flash = flash;
    this.applyStyle(0);
  }

  dispose(): void {
    this.object.removeFromParent();
    this.connector.geometry.dispose(); this.connector.material.dispose();
    this.disc.geometry.dispose();
    this.arrow.geometry.dispose();
    this.ring.geometry.dispose();
    this.cancelObject.dispose();
    for (const bar of this.glyph) bar.geometry.dispose();
    disposeTextResources(this.cancelLabel);
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
