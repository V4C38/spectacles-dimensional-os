import * as THREE from "three";
import { glassMaterial } from "./GlassSurface";
import {
  registerRayTarget,
  UI_CONTROL_RAY_PRIORITY,
} from "../input/XRBlocksRayInteraction";
/** Physical iOS-style track, progress and thumb, with an independent capture area. */
export class SpeedSlider extends THREE.Group {
  readonly hit: THREE.Mesh;
  private readonly fill: THREE.Mesh;
  readonly thumb: THREE.Mesh;
  constructor(readonly width: number) {
    super();
    const height = width * 0.035;
    const track = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      glassMaterial({
        width,
        height,
        radius: height / 2,
        tint: "#636366",
        alpha: 1,
        rim: 0,
        rimWidth: 0.001,
      }),
    );
    this.fill = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      glassMaterial({
        width,
        height,
        radius: height / 2,
        tint: "#ffffff",
        alpha: 1,
        rim: 0,
        rimWidth: 0.001,
      }),
    );
    this.fill.position.z = 0.001;
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(width * 0.064, 32),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.22,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.thumb = new THREE.Mesh(
      new THREE.CircleGeometry(width * 0.055, 40),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.thumb.position.z = 0.004;
    shadow.position.set(0.001, -0.002, -0.001);
    this.thumb.add(shadow);
    this.hit = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 1.18, width * 0.2),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.hit.userData.manipulationSpeedSlider = true;
    this.hit.userData.sliderThumb = this.thumb;
    this.hit.userData.sliderHalfWidth = width / 2;
    this.hit.userData.rayPriority = UI_CONTROL_RAY_PRIORITY;
    this.hit.userData.touchButton = true;
    registerRayTarget(this.hit);
    this.add(track, this.fill, this.thumb, this.hit);
    this.traverse((n) => {
      n.renderOrder = n === this.thumb ? 66 : 65;
      if (n !== this.hit) n.raycast = () => {};
      if (n instanceof THREE.Mesh)
        for (const m of Array.isArray(n.material) ? n.material : [n.material])
          m.depthTest = m.depthWrite = false;
    });
    this.setValue(0.2);
  }
  setValue(value: number) {
    const t = THREE.MathUtils.clamp((value - 0.05) / 0.95, 0, 1);
    this.fill.scale.x = Math.max(0.0001, t);
    this.fill.position.x = (-this.width * (1 - t)) / 2;
    this.thumb.position.x = this.width * (t - 0.5);
  }
}
