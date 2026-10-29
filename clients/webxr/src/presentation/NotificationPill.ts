import * as THREE from "three";
import { Text } from "troika-three-text";
import type { ClientNotification } from "@dimos-ar-client/presentation/NotificationCenter";
import { GlassSurface } from "./GlassSurface";
import { syncText, UI_FONT_REGULAR } from "./UIFonts";
import { disposeTextResources } from "./TextResources";
export class NotificationPill {
  readonly object = new THREE.Group();
  private readonly plate = new GlassSurface({
    width: 0.3,
    height: 0.065,
    radius: 0.0325,
    tint: "#202022",
    alpha: 0.94,
  });
  private readonly text = new Text();
  private readonly ring = new THREE.Mesh(
    new THREE.RingGeometry(0.012, 0.015, 64),
    new THREE.MeshBasicMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  private readonly strokes = [0, 1].map(
    () =>
      new THREE.Mesh(
        new THREE.PlaneGeometry(1, 0.003),
        new THREE.MeshBasicMaterial({
          transparent: true,
          depthTest: false,
          depthWrite: false,
        }),
      ),
  );
  private lastText = "";
  private readonly triangle = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.012, -0.01, 0),
      new THREE.Vector3(0, 0.013, 0),
      new THREE.Vector3(0.012, -0.01, 0),
      new THREE.Vector3(-0.012, -0.01, 0),
    ]),
    new THREE.LineBasicMaterial({
      color: 0xff9f0a,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  private readonly bang = new Text();
  constructor() {
    this.object.name = "Viewer notification";
    this.object.add(
      this.plate,
      this.text,
      this.ring,
      ...this.strokes,
      this.triangle,
      this.bang,
    );
    this.triangle.position.set(-0.116, 0, 0.009);
    this.bang.text = "!";
    this.bang.font = UI_FONT_REGULAR;
    this.bang.fontSize = 0.017;
    this.bang.anchorX = "center";
    this.bang.anchorY = "middle";
    this.bang.position.set(-0.116, 0, 0.01);
    this.bang.color = 0xff9f0a;
    syncText(this.bang);
    this.text.font = UI_FONT_REGULAR;
    this.text.fontSize = 0.017;
    this.text.anchorX = "left";
    this.text.anchorY = "middle";
    this.text.color = 0xffffff;
    this.text.position.set(-0.087, 0, 0.006);
    this.text.maxWidth = 0.22;
    this.ring.position.set(-0.116, 0, 0.009);
    this.object.traverse((node) => {
      node.raycast = () => {};
      node.renderOrder = 1000;
      if (node instanceof THREE.Mesh)
        for (const material of Array.isArray(node.material)
          ? node.material
          : [node.material]) {
          material.depthTest = material.depthWrite = false;
        }
    });
    this.object.visible = false;
  }
  draw(current: ClientNotification, elapsed: number, opacity: number): void {
    this.object.visible = true;
    if (this.lastText !== current.text) {
      this.lastText = current.text;
      this.text.text = current.text;
      syncText(this.text);
    }
    this.plate.setOpacity(opacity);
    for (const material of Array.isArray(this.text.material)
      ? this.text.material
      : [this.text.material])
      material.opacity = opacity;
    this.triangle.visible = this.bang.visible = current.glyph === "warning";
    this.triangle.geometry.setDrawRange(
      0,
      Math.min(4, 1 + Math.floor(elapsed / 0.06)),
    );
    this.triangle.material.opacity = opacity;
    for (const m of Array.isArray(this.bang.material)
      ? this.bang.material
      : [this.bang.material])
      m.opacity = opacity;
    const color =
      current.tone === "success"
        ? 0x30d158
        : current.tone === "danger"
          ? 0xff453a
          : current.tone === "warning"
            ? 0xff9f0a
            : 0xffffff;
    this.ring.visible = current.glyph === "stop";
    this.ring.geometry.setDrawRange(
      0,
      Math.floor(Math.min(1, elapsed / 0.18) * 64) * 6,
    );
    this.ring.material.color.setHex(color);
    this.ring.material.opacity = opacity;
    const segments =
      current.glyph === "stop"
        ? [[-0.01, 0.01, 0.01, -0.01]]
        : current.glyph === "check"
          ? [
              [-0.012, 0, -0.003, -0.009],
              [-0.003, -0.009, 0.014, 0.012],
            ]
          : [
              [-0.011, -0.011, 0.011, 0.011],
              [-0.011, 0.011, 0.011, -0.011],
            ];
    this.strokes.forEach((stroke, i) => {
      stroke.visible =
        current.glyph !== "warning" && !!current.glyph && i < segments.length;
      if (!stroke.visible) return;
      const [x, y, ex, ey] = segments[i];
      const progress = THREE.MathUtils.clamp(
        current.glyph === "stop"
          ? (elapsed - 0.18) / 0.12
          : elapsed / 0.125 - i,
        0,
        1,
      );
      stroke.scale.x = Math.hypot(ex - x, ey - y) * progress;
      stroke.rotation.z = Math.atan2(ey - y, ex - x);
      stroke.position.set(
        -0.116 + x + ((ex - x) * progress) / 2,
        y + ((ey - y) * progress) / 2,
        0.009,
      );
      stroke.material.color.setHex(color);
      stroke.material.opacity = opacity;
    });
  }
  dispose(): void {
    this.object.removeFromParent();
    this.triangle.geometry.dispose();
    this.triangle.material.dispose();
    this.bang.dispose();
    this.plate.dispose();
    disposeTextResources(this.text);
    for (const mesh of [this.ring, ...this.strokes]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
}
