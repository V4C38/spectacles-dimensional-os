import * as THREE from "three";
import { NotificationPill } from "../presentation/NotificationPill";
import { EndEffectorStatus, END_EFFECTOR_STATUS_STYLE, type EndEffectorStatusInput } from "@dimos-ar-client/manipulation/EndEffectorStatus";

/** Non-interactive status beside the end effector, clear of its marker buttons. */
export class TargetWarning {
  private readonly pill = new NotificationPill();
  readonly object = this.pill.object;
  private readonly status = new EndEffectorStatus();
  private readonly anchor = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  constructor() {
    this.object.name = "End effector status";
    this.object.visible = false;
  }
  update(position: THREE.Vector3, now: number, input: EndEffectorStatusInput): void {
    const sample = this.status.sample(input, now);
    this.object.visible = sample.notification !== null;
    this.anchor.copy(position);
    if (!sample.notification) return;
    this.object.scale.setScalar(0.8 * sample.scale);
    this.pill.draw(sample.notification, sample.elapsedS, sample.opacity);
  }
  faceViewer(eye: THREE.Vector3): void {
    this.object.position.copy(this.anchor);
    this.object.lookAt(eye);
    this.offset.set(END_EFFECTOR_STATUS_STYLE.rightM, END_EFFECTOR_STATUS_STYLE.upM, 0)
      .applyQuaternion(this.object.quaternion);
    this.object.position.add(this.offset);
  }
  dispose(): void {
    this.pill.dispose();
  }
}
