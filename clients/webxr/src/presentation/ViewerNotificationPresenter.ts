import * as THREE from "three";
import { Text } from "troika-three-text";
import { VIEWER_NOTIFICATION_STYLE } from "@dimos-ar-client/presentation/WorldVisualStyle";
import { NotificationCenter, notificationGlyph, type ClientNotification } from "@dimos-ar-client/presentation/NotificationCenter";
import { GlassSurface } from "./GlassSurface";
import { syncText, UI_FONT_REGULAR } from "./UIFonts";
import { disposeTextResources } from "./TextResources";
export type ViewerNotification = ClientNotification;

/** Viewer-relative drawing only. Lifetime and preemption belong to ClientCore. */
export class ViewerNotificationPresenter {
  readonly object = new THREE.Group();
  readonly center = new NotificationCenter();
  private readonly plate = new GlassSurface({ width: 0.30, height: 0.065, radius: 0.0325, tint: "#202022", alpha: 0.94 });
  private readonly text = new Text();
  private readonly glyphGeometry = new THREE.BufferGeometry();
  private readonly glyphPositions = new Float32Array(64 * 6 * 3);
  private readonly glyphMesh = new THREE.Mesh(this.glyphGeometry,
    new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
  private revision = -1;
  private readonly target = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly angles = new THREE.Euler(0, 0, 0, "YXZ");
  constructor() {
    this.object.name = "Viewer notification";
    this.object.add(this.plate, this.text, this.glyphMesh);
    this.glyphGeometry.setAttribute("position", new THREE.BufferAttribute(this.glyphPositions, 3));
    this.glyphMesh.frustumCulled = false;
    this.text.font = UI_FONT_REGULAR; this.text.fontSize = 0.017;
    this.text.anchorX = "left"; this.text.anchorY = "middle"; this.text.color = 0xffffff;
    this.text.position.set(-0.087, 0, 0.006); this.text.maxWidth = 0.22;
    this.glyphMesh.position.set(-0.116, 0, 0.009);
    this.object.traverse(node => {
      node.raycast = () => {}; node.renderOrder = 1000;
      if (node instanceof THREE.Mesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) { material.depthTest = material.depthWrite = false; }
    });
    this.object.visible = false;
  }
  show(notification: ViewerNotification): void { this.center.show(notification); this.object.visible = true; }
  clear(key: string): void { this.center.clear(key); }
  tick(position: readonly number[], orientation: readonly number[], projectionY: number, deltaS: number): void {
    this.center.tick(deltaS);
    const state = this.center.snapshot(), current = state.notification;
    this.object.visible = current !== null;
    if (!current) return;
    this.rotation.fromArray(orientation);
    this.angles.setFromQuaternion(this.rotation, "YXZ");
    this.angles.z = 0;
    this.rotation.setFromEuler(this.angles);
    this.target.set(0, -0.9 * 0.45 / Math.max(0.1, projectionY), -0.9).applyQuaternion(this.rotation).add(new THREE.Vector3().fromArray(position));
    // Tilt the surface toward the viewer without moving its lower-view anchor.
    this.angles.x -= VIEWER_NOTIFICATION_STYLE.upwardTiltRad;
    this.rotation.setFromEuler(this.angles);
    if (state.revision !== this.revision) {
      this.revision = state.revision; this.text.text = current.text; syncText(this.text);
      this.object.position.copy(this.target); this.object.quaternion.copy(this.rotation);
    }
    const alpha = 1 - Math.exp(-12 * deltaS), elapsed = state.elapsedS;
    this.object.position.lerp(this.target, alpha); this.object.quaternion.slerp(this.rotation, alpha);
    // Interpolating different yaw/pitch poses can introduce roll between level endpoints.
    this.angles.setFromQuaternion(this.object.quaternion, "YXZ");
    this.angles.z = 0;
    this.object.quaternion.setFromEuler(this.angles);
    const opacity = Math.min(1, elapsed / 0.12, ((current.durationS ?? 2.5) - elapsed) / 0.18);
    this.plate.setOpacity(opacity);
    for (const material of Array.isArray(this.text.material) ? this.text.material : [this.text.material]) material.opacity = opacity;
    this.object.scale.setScalar(0.9 + 0.1 * opacity);
    const color = current.tone === "warning" ? 0xffd60a : current.tone === "success" ? 0x30d158 : current.tone === "danger" ? 0xff453a : 0xffffff;
    let offset = 0;
    for (const [x, y, ex, ey] of notificationGlyph(current.glyph, elapsed)) {
      const length = Math.hypot(ex - x, ey - y);
      if (length < 0.00001) continue;
      const dx = -(ey - y) / length * 0.11, dy = (ex - x) / length * 0.11;
      for (const [px, py] of [[x + dx, y + dy], [x - dx, y - dy], [ex + dx, ey + dy],
        [ex + dx, ey + dy], [x - dx, y - dy], [ex - dx, ey - dy]]) {
        this.glyphPositions[offset++] = px * 0.01; this.glyphPositions[offset++] = py * 0.01; this.glyphPositions[offset++] = 0;
      }
    }
    this.glyphGeometry.attributes.position.needsUpdate = true;
    this.glyphGeometry.setDrawRange(0, offset / 3);
    this.glyphMesh.material.color.setHex(color); this.glyphMesh.material.opacity = opacity;
  }

  dispose(): void {
    this.object.removeFromParent(); this.plate.dispose(); disposeTextResources(this.text);
    this.glyphGeometry.dispose(); this.glyphMesh.material.dispose();
  }
}
