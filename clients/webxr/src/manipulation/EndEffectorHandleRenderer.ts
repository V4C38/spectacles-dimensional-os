import * as THREE from "three";
import { indicatorMaterial } from "../presentation/PoseIndicatorMaterial";
import { registerRayTarget } from "../input/XRBlocksRayInteraction";
import { clientTrackingToWebxrPoint } from "../utilities/WebXRCoordinates";

/** Tool interaction stays on top; environment depth never modifies this material. */
export class EndEffectorHandleRenderer {
  readonly object = new THREE.Group();
  readonly collider: THREE.Mesh;
  readonly visual: THREE.Mesh;
  constructor() {
    this.object.name = "EndEffectorHandle";
    this.collider = new THREE.Mesh(
      new THREE.SphereGeometry(0.036, 20, 16),
      indicatorMaterial(),
    );
    this.visual = new THREE.Mesh(new THREE.SphereGeometry(0.012, 20, 16), this.collider.material);
    this.visual.renderOrder = 50;
    this.visual.raycast = () => {};
    this.object.add(this.visual);
    this.collider.material = new THREE.MeshBasicMaterial({ visible: false });
    this.collider.name = "EndEffectorHandleCollider";
    this.collider.userData.rayPriority = 10;
    registerRayTarget(this.collider);
    this.collider.renderOrder = 50;
    this.object.add(this.collider);
    const axes = new THREE.AxesHelper(0.075);
    const positions = axes.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++)
      positions.setXYZ(
        i,
        ...clientTrackingToWebxrPoint([
          positions.getX(i),
          positions.getY(i),
          positions.getZ(i),
        ]),
      );
    axes.raycast = () => {};
    axes.traverse((part) => {
      if (part instanceof THREE.LineSegments) part.material.depthTest = false;
    });
    axes.visible = false;
    this.object.add(axes);
  }
  dispose(): void {
    this.object.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        object.geometry.dispose();
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material])
          material.dispose();
      }
    });
    this.object.removeFromParent();
  }
}
