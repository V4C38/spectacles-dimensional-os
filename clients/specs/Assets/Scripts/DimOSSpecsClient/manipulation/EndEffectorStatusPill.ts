import type { RoundedRectangle } from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle";
import { EndEffectorStatus, END_EFFECTOR_STATUS_STYLE, type EndEffectorStatusInput } from "../../DimOSARClient/manipulation/EndEffectorStatus";
import { notificationGlyph } from "../../DimOSARClient/presentation/NotificationCenter";
import { WorldMeshRenderer } from "../presentation/WorldMeshRenderer";
import { createRoundedSurface, createText, uiMaterialLayer, COLOR_WHITE } from "../presentation/UIKit";

export class EndEffectorStatusPill {
  private readonly status = new EndEffectorStatus();
  private readonly root: SceneObject;
  private readonly text: Text;
  private readonly icon: WorldMeshRenderer;
  private readonly plate: RoundedRectangle;

  constructor(parent: SceneObject) {
    this.root = global.scene.createSceneObject("EndEffectorStatus");
    this.root.setParent(parent);
    this.plate = createRoundedSurface(this.root, "EndEffectorStatusPlate",
      END_EFFECTOR_STATUS_STYLE.widthM * 100, END_EFFECTOR_STATUS_STYLE.heightM * 100,
      vec3.zero(), new vec4(0.05, 0.05, 0.06, 0.94), 2.6, 100);
    this.text = createText({ parent: this.root, name: "EndEffectorStatusText",
      fontSize: 1.36 * 32 / 0.69492703, color: COLOR_WHITE, position: new vec3(1.8, 0, 0.2),
      horizontalAlignment: HorizontalAlignment.Center, worldSpaceRect: Rect.create(-9, 9, -2, 2) });
    this.text.setRenderOrder(102);
    this.icon = new WorldMeshRenderer(this.root, "EndEffectorStatusIcon");
    this.icon.object.getTransform().setLocalPosition(new vec3(-10, 0, 0.3));
    this.icon.object.getTransform().setLocalRotation(quat.angleAxis(Math.PI / 2, vec3.right()));
    uiMaterialLayer(this.icon.visual, 101);
    this.root.enabled = false;
  }

  apply(input: EndEffectorStatusInput, anchor: SceneObject, camera: SceneObject, now: number): void {
    const sample = this.status.sample(input, now), current = sample.notification;
    this.root.enabled = current !== null;
    if (!current) return;
    this.text.text = current.text;
    this.text.textFill.color = new vec4(1, 1, 1, sample.opacity);
    this.plate.backgroundColor = new vec4(0.05, 0.05, 0.06, 0.94 * sample.opacity);
    const positions: number[] = [], indices: number[] = [];
    for (const [x, y, ex, ey] of notificationGlyph(current.glyph, sample.elapsedS)) {
      const length = Math.hypot(ex - x, ey - y);
      if (length < 0.00001) continue;
      const dx = -(ey - y) / length * 0.11, dy = (ex - x) / length * 0.11;
      const base = positions.length / 3;
      positions.push(x + dx, 0.05, -y - dy, x - dx, 0.05, -y + dy,
        ex + dx, 0.05, -ey - dy, ex - dx, 0.05, -ey + dy);
      indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
    const color: [number, number, number, number] = current.tone === "warning"
      ? [1, 0.65, 0, sample.opacity] : [1, 1, 1, sample.opacity];
    this.icon.triangles(positions, indices, color);
    const rotation = camera.getTransform().getWorldRotation();
    const transform = this.root.getTransform();
    transform.setWorldPosition(anchor.getTransform().getWorldPosition().add(rotation.multiplyVec3(
      new vec3(END_EFFECTOR_STATUS_STYLE.rightM * 100, END_EFFECTOR_STATUS_STYLE.upM * 100, 0))));
    transform.setWorldRotation(rotation);
    transform.setLocalScale(vec3.one().uniformScale(sample.scale));
  }
}
