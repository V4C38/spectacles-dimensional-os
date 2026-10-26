import * as THREE from "three";
/** Setup starts below the viewer’s forward line and follows the viewer until an explicit manual grab pins it. */
export class ViewerPanelPlacement {
  private pinned = false;
  begin(): void { this.pinned = false; }
  pin(): void { this.pinned = true; }
  update(panel: THREE.Object3D, eye: THREE.Vector3, orientation: THREE.Quaternion, deltaS: number, initial = false): void {
    if (this.pinned) return;
    const target = new THREE.Vector3(0, 0, -0.9).applyQuaternion(orientation).add(eye);
    target.y -= 0.1;
    const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, target, new THREE.Vector3(0, 1, 0)));
    const alpha = initial ? 1 : 1 - Math.exp(-5 * Math.max(0, deltaS));
    panel.position.lerp(target, alpha); panel.quaternion.slerp(rotation, alpha);
    const angles = new THREE.Euler().setFromQuaternion(panel.quaternion, "YXZ"); angles.z = 0; panel.quaternion.setFromEuler(angles);
  }
}
