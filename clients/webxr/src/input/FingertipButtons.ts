import * as THREE from "three";
import { closestPoint, rayTargetVisible } from "./AffordanceProximity";

type Contact = { object: THREE.Mesh; point: THREE.Vector3; distance: number };
type Press = Contact & { normal: THREE.Vector3 };

/** A physical poke uses the ordinary button press/release path, without a pinch. */
export class FingertipButtons<T extends object> {
  private readonly presses = new Map<T, Press>();
  private readonly approaches = new Map<T, { object: THREE.Mesh; tip: THREE.Vector3 }>();
  private readonly previous = new Map<T, THREE.Vector3>();
  private readonly disarmed = new Map<T, THREE.Vector3>();

  constructor(private readonly events: {
    start(source: T, contact: Contact): void;
    end(source: T, contact: Contact, cancelled: boolean): void;
  }) {}

  owns(source: T): boolean { return this.presses.has(source) || this.disarmed.has(source); }

  release(source: T): void {
    const press = this.presses.get(source);
    if (!press) return;
    this.presses.delete(source); this.disarmed.set(source, press.point.clone());
    this.events.end(source, press, !rayTargetVisible(press.object) || press.object.userData.interactionEnabled === false);
  }

  update(source: T, tip: THREE.Vector3 | null, targets: readonly THREE.Mesh[], eligible: (object: THREE.Object3D, point: THREE.Vector3) => boolean): void {
    const press = this.presses.get(source);
    const locked = this.disarmed.get(source);
    if (locked) {
      if (tip && tip.distanceTo(locked) > 0.03) this.disarmed.delete(source);
      this.previous.delete(source);
      return;
    }
    if (press) {
      const valid = rayTargetVisible(press.object) && press.object.userData.interactionEnabled !== false;
      const closest = tip ? closestPoint(press.object, tip) : press.point;
      const delta = tip?.clone().sub(closest);
      const front = delta?.dot(press.normal) ?? 0;
      const lateral = delta ? delta.clone().addScaledVector(press.normal, -front).length() : Infinity;
      if (!tip || !valid || !eligible(press.object, closest) || front > 0.018 || front < -0.025 || lateral > 0.008) {
        this.presses.delete(source);
        this.disarmed.set(source, press.point.clone());
        this.events.end(source, press, !tip || !valid || lateral > 0.008 || front < 0 || !eligible(press.object, closest));
      }
      return;
    }
    const previous = this.previous.get(source);
    if (!tip) { this.previous.delete(source); return; }
    this.previous.set(source, tip.clone());
    if (!previous) return;
    let contact: Press | null = null;
    for (const object of targets) {
      if (!rayTargetVisible(object) || object.userData.interactionEnabled === false) continue;
      object.updateWorldMatrix(true, false);
      const point = closestPoint(object, tip);
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(object.getWorldQuaternion(new THREE.Quaternion()));
      const delta = tip.clone().sub(point), distance = delta.length();
      const before = previous.clone().sub(point).dot(normal), front = delta.dot(normal);
      const lateral = delta.clone().addScaledVector(normal, -front).length();
      if (front >= 0.012 && front <= 0.06 && lateral < 0.008 && this.approaches.get(source)?.object !== object) this.approaches.set(source, { object, tip: tip.clone() });
      // Require an approach from the visible front, never an accidental spawn
      // inside the panel or a finger entering from its back.
      if (distance > 0.009 || front < -0.004 || (before < 0.012 && this.approaches.get(source)?.object !== object) || !eligible(object, point)) continue;
      const approach = this.approaches.get(source);
      if (approach && approach.tip.clone().sub(tip).dot(normal) < 0.002) continue;
      if (!contact || distance < contact.distance) contact = { object, point, normal, distance };
    }
    if (contact) { this.approaches.delete(source); this.presses.set(source, contact); this.events.start(source, contact); }
  }

  cancel(): void {
    for (const [source, press] of this.presses) {
      this.disarmed.set(source, press.point.clone());
      this.events.end(source, press, true);
    }
    this.presses.clear(); this.previous.clear(); this.approaches.clear();
  }
}
