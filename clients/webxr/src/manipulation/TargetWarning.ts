import * as THREE from "three";
import { NotificationPill } from "../presentation/NotificationPill";
/** Lifetime and anchor policy for one reusable warning pill and rejected target. */
export class TargetWarning {
  private readonly pill = new NotificationPill();
  readonly object = this.pill.object;
  readonly rejected = new THREE.Mesh(
    new THREE.SphereGeometry(0.007, 16, 12),
    new THREE.MeshBasicMaterial({
      color: 0xff453a,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  private started = -Infinity;
  private revision = -1;
  private message = "";
  constructor() {
    this.object.visible = this.rejected.visible = false;
    this.rejected.raycast = () => {};
  }
  show(
    revision: number,
    message: string,
    position: THREE.Vector3,
    now: number,
  ) {
    if (revision === this.revision) return;
    this.revision = revision;
    this.started = now;
    this.message = message;
    this.rejected.position.copy(position);
  }
  update(position: THREE.Vector3, now: number) {
    const age = now - this.started;
    this.object.visible = this.rejected.visible = age >= 0 && age < 1.5;
    if (!this.object.visible) return;
    const opacity = Math.min(1, age / 0.12, (1.5 - age) / 0.18);
    this.object.position.copy(position).add(new THREE.Vector3(0, -0.065, 0));
    this.object.scale.setScalar(0.8 * (0.9 + 0.1 * opacity));
    this.pill.draw(
      { text: this.message, tone: "warning", glyph: "warning" },
      age,
      opacity,
    );
    this.rejected.material.opacity = opacity;
  }
  faceViewer(eye: THREE.Vector3) {
    this.object.lookAt(eye);
  }
  dispose() {
    this.pill.dispose();
    this.rejected.removeFromParent();
    this.rejected.geometry.dispose();
    this.rejected.material.dispose();
  }
}
