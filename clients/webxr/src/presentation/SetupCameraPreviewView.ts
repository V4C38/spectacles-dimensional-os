import * as THREE from "three";
import type { HmdCameraSource } from "../localization/HmdCameraSource";

export type CameraPreviewFrame = ReturnType<HmdCameraSource["previewFrame"]>;

/** A 5 fps thumbnail of the capture owner's existing stream; no extra camera or JPEG work. */
export class SetupCameraPreviewView extends THREE.Group {
  readonly image: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly guide: THREE.LineLoop;
  private readonly canvas = typeof document === "undefined" ? null : document.createElement("canvas");
  private readonly texture: THREE.CanvasTexture | null;
  private elapsed = 1;
  private frameVersion = 0;
  status = "Starting camera…";

  constructor() {
    super();
    this.name = "Localization camera preview";
    if (this.canvas) { this.canvas.width = 320; this.canvas.height = 208; }
    this.texture = this.canvas ? new THREE.CanvasTexture(this.canvas) : null;
    if (this.texture) this.texture.colorSpace = THREE.SRGBColorSpace;
    this.image = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.22), new THREE.MeshBasicMaterial({ color: 0xffffff, map: this.texture, toneMapped: false, transparent: true, depthWrite: false }));
    this.guide = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.014, -0.014, 0), new THREE.Vector3(0.014, -0.014, 0),
      new THREE.Vector3(0.014, 0.014, 0), new THREE.Vector3(-0.014, 0.014, 0),
    ]), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, toneMapped: false }));
    this.guide.position.z = 0.002;
    this.add(this.image, this.guide);
    this.traverse(node => { node.raycast = () => {}; node.renderOrder = 8; });
  }

  update(frame: CameraPreviewFrame, deltaS: number, markerGuide: boolean): void {
    this.guide.visible = markerGuide;
    this.elapsed += Math.max(0, deltaS);
    if (!frame) {
      this.image.visible = false;
      this.status = "Starting camera…";
      return;
    }
    if (this.elapsed < 0.2) return;
    this.elapsed = 0;
    const context = this.canvas?.getContext("2d");
    if (!context || !this.canvas || !this.texture) { this.status = "Preview unavailable"; return; }
    try {
      const width = this.canvas.width, height = this.canvas.height;
      const scale = Math.min(width / frame.width, height / frame.height);
      context.clearRect(0, 0, width, height);
      context.drawImage(frame.video, (width - frame.width * scale) / 2, (height - frame.height * scale) / 2, frame.width * scale, frame.height * scale);
      this.texture.needsUpdate = true;
      this.image.visible = true;
      this.status = "Live";
      this.userData.frameVersion = ++this.frameVersion;
    } catch {
      this.image.visible = false;
      this.status = "Preview unavailable";
    }
  }

  dispose(): void {
    this.texture?.dispose();
    this.image.geometry.dispose(); this.image.material.dispose();
    this.guide.geometry.dispose(); (this.guide.material as THREE.Material).dispose();
  }
}
