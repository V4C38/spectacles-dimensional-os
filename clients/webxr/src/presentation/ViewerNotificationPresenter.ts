import { NotificationPill } from "./NotificationPill";
import * as THREE from "three";
import { VIEWER_NOTIFICATION_STYLE } from "@dimos-ar-client/presentation/WorldVisualStyle";
import {
  NotificationCenter,
  type ClientNotification,
} from "@dimos-ar-client/presentation/NotificationCenter";
export type ViewerNotification = ClientNotification;

/** Viewer-relative drawing only. Lifetime and preemption belong to ClientCore. */
export class ViewerNotificationPresenter {
  private readonly pill = new NotificationPill();
  readonly object = this.pill.object;
  readonly center = new NotificationCenter();
  private revision = -1;
  private readonly target = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly angles = new THREE.Euler(0, 0, 0, "YXZ");
  show(notification: ViewerNotification): void {
    this.center.show(notification);
    this.object.visible = true;
  }
  tick(
    position: readonly number[],
    orientation: readonly number[],
    projectionY: number,
    deltaS: number,
  ): void {
    this.center.tick(deltaS);
    const state = this.center.snapshot(),
      current = state.notification;
    this.object.visible = current !== null;
    if (!current) return;
    this.rotation.fromArray(orientation);
    this.angles.setFromQuaternion(this.rotation, "YXZ");
    this.angles.z = 0;
    this.rotation.setFromEuler(this.angles);
    this.target
      .set(0, (-0.9 * 0.45) / Math.max(0.1, projectionY), -0.9)
      .applyQuaternion(this.rotation)
      .add(new THREE.Vector3().fromArray(position));
    // Tilt the surface toward the viewer without moving its lower-view anchor.
    this.angles.x -= VIEWER_NOTIFICATION_STYLE.upwardTiltRad;
    this.rotation.setFromEuler(this.angles);
    if (state.revision !== this.revision) {
      this.revision = state.revision;
      this.object.position.copy(this.target);
      this.object.quaternion.copy(this.rotation);
    }
    const alpha = 1 - Math.exp(-12 * deltaS),
      elapsed = state.elapsedS;
    this.object.position.lerp(this.target, alpha);
    this.object.quaternion.slerp(this.rotation, alpha);
    // Interpolating different yaw/pitch poses can introduce roll between level endpoints.
    this.angles.setFromQuaternion(this.object.quaternion, "YXZ");
    this.angles.z = 0;
    this.object.quaternion.setFromEuler(this.angles);
    const opacity = Math.min(
      1,
      elapsed / 0.12,
      ((current.durationS ?? 2.5) - elapsed) / 0.18,
    );
    this.pill.draw(current, elapsed, opacity);
    this.object.scale.setScalar(0.9 + 0.1 * opacity);
  }

  dispose(): void {
    this.pill.dispose();
  }
}
