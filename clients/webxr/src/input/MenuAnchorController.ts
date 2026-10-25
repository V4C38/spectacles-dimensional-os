import * as THREE from "three";

/** A summoned menu follows its source position; grabbing leaves its current world pose intact. */
export class MenuAnchorController {
  private anchor: XRInputSource | null = null;
  private readonly offset = new THREE.Vector3();
  get source(): XRInputSource | null { return this.anchor; }

  attach(source: XRInputSource, position: THREE.Vector3, eye: THREE.Vector3, headRotation: THREE.Quaternion, panel: THREE.Object3D): void {
    this.anchor = source;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(headRotation);
    forward.y = 0;
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1);
    this.offset.copy(forward.normalize()).multiplyScalar(0.18).add(new THREE.Vector3(0, source.hand ? 0.20 : 0.12, 0));
    // Follow the new source from the existing pose instead of snapping on attach.
    this.update(position, eye, panel, 1 / 60);
  }

  update(position: THREE.Vector3, eye: THREE.Vector3, panel: THREE.Object3D, deltaS: number): void {
    if (!this.anchor) return;
    const alpha = 1 - Math.exp(-20 * Math.max(0, deltaS));
    panel.position.lerp(position.clone().add(this.offset), alpha);
    this.faceViewer(eye, panel, alpha);
  }

  detach(): void { this.anchor = null; }

  faceViewer(eye: THREE.Vector3, panel: THREE.Object3D, alpha: number): void {
    if (panel.position.distanceToSquared(eye) < 1e-8) return;
    const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, panel.position, new THREE.Vector3(0, 1, 0)));
    panel.quaternion.slerp(rotation, alpha);
    const angles = new THREE.Euler().setFromQuaternion(panel.quaternion, "YXZ");
    angles.z = 0;
    panel.quaternion.setFromEuler(angles);
  }
}
