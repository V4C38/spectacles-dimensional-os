import * as THREE from "three";
import type * as xb from "xrblocks";
import { closestPoint, rayTargetVisible } from "./AffordanceProximity";
import type { Vec3 } from "@dimos-ar-client/websocket/protocolTypes";

type Controller = xb.SelectEvent["target"];

/** Near targeting shares the SDK hit list and press lifecycle with distant rays. */
export class WebXRDirectInteraction {
  private readonly indexPoints = new Map<Controller, THREE.Vector3>();
  private readonly points = new Map<Controller, THREE.Vector3>();
  private readonly hovered = new Map<Controller, THREE.Intersection>();
  private readonly captures = new Map<Controller, { direct: boolean; target?: THREE.Object3D; normal: THREE.Vector3 }>();

  sample(frame: XRFrame, reference: XRReferenceSpace, controllers: Controller[]): void {
    for (const controller of controllers) {
      const source = controller.inputSource;
      let point: THREE.Vector3 | null = null;
      this.indexPoints.delete(controller);
      if (source?.hand) {
        const index = source.hand.get("index-finger-tip"), thumb = source.hand.get("thumb-tip");
        const a = index && frame.getJointPose?.(index, reference), b = thumb && frame.getJointPose?.(thumb, reference);
        if (a) this.indexPoints.set(controller, new THREE.Vector3(a.transform.position.x, a.transform.position.y, a.transform.position.z));
        else this.indexPoints.delete(controller);
        if (a) {
          point = new THREE.Vector3(a.transform.position.x, a.transform.position.y, a.transform.position.z);
          if (b) point.add(new THREE.Vector3(b.transform.position.x, b.transform.position.y, b.transform.position.z)).multiplyScalar(0.5);
        }
      } else if (source?.gripSpace) {
        this.indexPoints.delete(controller);
        const pose = frame.getPose(source.gripSpace, reference);
        if (pose) {
          const p = pose.transform.position, q = pose.transform.orientation;
          point = new THREE.Vector3(0, 0, -0.06).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w)).add(new THREE.Vector3(p.x, p.y, p.z));
        }
      }
      this.setPoint(controller, point);
    }
  }

  setPoint(controller: Controller, point: THREE.Vector3 | null): void {
    if (point) this.points.set(controller, point);
    else { this.points.delete(controller); this.hovered.delete(controller); }
  }
  indexTip(controller: Controller): THREE.Vector3 | null { return this.indexPoints.get(controller) ?? null; }
  point(controller: Controller): THREE.Vector3 | undefined { return this.points.get(controller); }
  isDirect(controller: Controller): boolean { return this.captures.get(controller)?.direct ?? this.hovered.has(controller); }
  hasLostCapture(): boolean { return [...this.captures].some(([source, capture]) => capture.direct && !this.points.has(source)); }

  resolve(controller: Controller, scene: THREE.Object3D | undefined, eligible: (object: THREE.Object3D, point: THREE.Vector3) => boolean): THREE.Intersection | undefined {
    const capture = this.captures.get(controller);
    if (!controller.visible || controller.userData.connected === false) { this.hovered.delete(controller); return undefined; }
    if (capture && !capture.direct) return undefined;
    const point = this.points.get(controller);
    if (!point || !scene) { this.hovered.delete(controller); return undefined; }
    const previous = this.hovered.get(controller)?.object;
    let best: THREE.Intersection | undefined;
    scene.traverse(object => {
      if (!(object instanceof THREE.Mesh) || !object.userData.rayTarget || object.userData.rayAmbient ||
          !rayTargetVisible(object) || object.userData.interactionEnabled === false ||
          (capture?.target && capture.target !== object)) return;
      object.updateWorldMatrix(true, false);
      const contact = object.userData.touchButton ? this.indexPoints.get(controller) ?? point : point;
      const closest = closestPoint(object, contact);
      const distance = closest.distanceTo(contact);
      if (distance > (object === previous ? 0.04 : 0.025) || !eligible(object, closest)) return;
      const priority = Number(object.userData.rayPriority ?? 0);
      const bestPriority = Number(best?.object.userData.rayPriority ?? Infinity);
      if (!best || priority < bestPriority || (priority === bestPriority && distance < best.distance)) best = { object, point: closest, distance };
    });
    if (best) this.hovered.set(controller, best); else this.hovered.delete(controller);
    return best;
  }

  capture(controller: Controller, target: THREE.Object3D, normal?: THREE.Vector3): void {
    const direction = normal ?? new THREE.Vector3(0, 0, 1).applyQuaternion(target.getWorldQuaternion(new THREE.Quaternion()));
    this.captures.set(controller, { direct: this.hovered.has(controller), target, normal: direction.normalize() });
  }
  ray(controller: Controller): { origin: Vec3; direction: Vec3 } | null {
    if (!this.isDirect(controller)) return null;
    const target = this.captures.get(controller)?.target ?? this.hovered.get(controller)?.object;
    const point = target?.userData.touchButton ? this.indexPoints.get(controller) ?? this.points.get(controller) : this.points.get(controller);
    if (!point) return null;
    const normal = this.captures.get(controller)?.normal ?? new THREE.Vector3(0, 0, 1);
    return { origin: point.clone().addScaledVector(normal, 0.1).toArray() as Vec3, direction: normal.clone().negate().toArray() as Vec3 };
  }
  cancel(): void { this.captures.clear(); }
  reset(): void { this.cancel(); this.points.clear(); this.indexPoints.clear(); this.hovered.clear(); }
}
