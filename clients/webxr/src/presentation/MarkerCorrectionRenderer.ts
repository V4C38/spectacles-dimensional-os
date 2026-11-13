import * as THREE from "three";
import type { ClientTrackingOrigin } from "@dimos-ar-client/localization/ClientTracking";
import { MarkerCorrectionTrail, ROBOT_LINE_STYLE } from "@dimos-ar-client/presentation/WorldPresentation";

import { AdaptiveDashedLineRenderer } from "./AdaptiveDashedLineRenderer";

export class MarkerCorrectionRenderer {
  readonly object = new THREE.Group();
  private readonly trail = new MarkerCorrectionTrail();
  private readonly sphere: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly stem: AdaptiveDashedLineRenderer | null;
  private readonly position = new THREE.Vector3();

  constructor(private readonly source: THREE.Mesh, withStem = false) {
    this.object.name = "MarkerCorrectionTrail";
    this.sphere = new THREE.Mesh(source.geometry, (source.material as THREE.ShaderMaterial).clone());
    this.sphere.material.transparent = true;
    this.sphere.material.depthWrite = false;
    this.sphere.renderOrder = source.renderOrder;
    this.sphere.raycast = () => {};
    this.object.add(this.sphere);
    this.stem = withStem ? new AdaptiveDashedLineRenderer() : null;
    if (this.stem) this.object.add(this.stem.object);
    source.parent!.add(this.object);
    this.reset();
  }

  update(origin: ClientTrackingOrigin | null, now: number, floorY?: number): void {
    this.source.position.set(0, 0, 0);
    this.source.getWorldPosition(this.position);
    const ghost = this.trail.update(origin, this.position.toArray(), now);
    if (this.trail.displayedPosition) this.source.position.copy(this.source.parent!.worldToLocal(new THREE.Vector3(...this.trail.displayedPosition)));
    this.object.scale.setScalar(this.trail.scale);
    this.object.visible = ghost !== null;
    if (!ghost) return;
    this.object.position.copy(this.object.parent!.worldToLocal(this.position.fromArray(ghost)));
    this.object.quaternion.copy(this.object.parent!.getWorldQuaternion(new THREE.Quaternion())).invert();
    this.sphere.scale.copy(this.source.scale);
    const source = (this.source.material as THREE.ShaderMaterial).uniforms;
    const uniforms = this.sphere.material.uniforms;
    uniforms.uOpacity.value = source.uOpacity.value * 0.3;
    for (const key of ["uCenterColor", "uRimColor"]) uniforms[key].value.copy(source[key].value);
    if (this.stem) {
      const bottom = floorY === undefined ? 0.03 : Math.max(0.03, ghost[1] - floorY - 0.02);
      this.stem.object.visible = bottom > 0.03;
      this.stem.setSegments([[0, -0.03, 0], [0, -bottom, 0]]);
      this.stem.setStyle(ROBOT_LINE_STYLE.selectedWidthM, ROBOT_LINE_STYLE.selectedOpacity * 0.3);
    }
  }

  reset(): void { this.trail.reset(); this.object.visible = false; this.source.position.set(0, 0, 0); }
  dispose(): void {
    this.object.removeFromParent();
    this.sphere.material.dispose();
    this.stem?.dispose();
  }
}
