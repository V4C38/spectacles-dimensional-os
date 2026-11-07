import * as THREE from "three";

/** Host-owned blocked marker geometry. Authoritative eligibility stays in ClientCore. */
export class WebXRReplicationPresenter {
  readonly object = new THREE.Group();
  static readonly blockedColor = 0x8e969e;

  constructor() {
    this.object.name = "Navigation blocked cross";
    this.object.visible = false;
    for (const angle of [-Math.PI / 4, Math.PI / 4]) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.012),
        new THREE.MeshBasicMaterial({ color: WebXRReplicationPresenter.blockedColor,
          side: THREE.DoubleSide, depthWrite: false }));
      bar.rotation.set(-Math.PI / 2, 0, angle);
      bar.position.y = 0.026;
      bar.raycast = () => {};
      this.object.add(bar);
    }
  }

  apply(blocked: boolean, targets: readonly THREE.Object3D[], aiming: boolean): void {
    this.object.visible = blocked;
    for (const target of targets) target.userData.rayDisabled = blocked || aiming;
  }

  dispose(): void {
    this.object.removeFromParent();
    for (const child of this.object.children) {
      const mesh = child as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
      mesh.geometry.dispose(); mesh.material.dispose();
    }
  }
}
