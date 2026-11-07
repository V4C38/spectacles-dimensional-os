import type { RoundedRectangle } from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle";
import { NotificationCenter, notificationGlyph, type ClientNotification } from "../../DimOSARClient/presentation/NotificationCenter";
import { VIEWER_NOTIFICATION_STYLE } from "../../DimOSARClient/presentation/WorldVisualStyle";
import { WorldMeshRenderer } from "./WorldMeshRenderer";
import { createRoundedSurface, createText, uiMaterialLayer, COLOR_WHITE } from "./UIKit";

/** Non-interactive viewer-relative feedback, driven only by visible-frame time. */
export class ViewerNotificationPresenter {
  private disposed = false;
  private readonly center = new NotificationCenter();
  private readonly root: SceneObject;
  private readonly text: Text;
  private readonly icon: WorldMeshRenderer;
  private readonly plate: RoundedRectangle;

  constructor(private readonly camera: SceneObject) {
    this.root = global.scene.createSceneObject("ViewerNotification");
    this.text = createText({ parent: this.root, name: "NotificationText", fontSize: 42, color: COLOR_WHITE,
      position: new vec3(1.8, 0, 0.2), horizontalAlignment: HorizontalAlignment.Center,
      worldSpaceRect: Rect.create(-9, 9, -2, 2) });
    this.plate = createRoundedSurface(this.root, "NotificationPlate", 24, 5, vec3.zero(), new vec4(0.05, 0.05, 0.06, 0.9), 2.5, 100);
    this.icon = new WorldMeshRenderer(this.root, "NotificationIcon");
    this.icon.object.getTransform().setLocalPosition(new vec3(-10, 0, 0.3));
    this.icon.object.getTransform().setLocalRotation(quat.angleAxis(Math.PI / 2, vec3.right()));
    this.text.setRenderOrder(102);
    uiMaterialLayer(this.icon.visual, 101);
    this.root.enabled = false;
  }
  show(notification: ClientNotification): void { if (!this.disposed) this.center.show(notification); }
  clear(key: string): void { this.center.clear(key); }
  tick(deltaS: number): void {
    if (this.disposed) return;
    this.center.tick(Math.min(0.1, Math.max(0, deltaS)));
    const snap = this.center.snapshot(), notification = snap.notification;
    this.root.enabled = notification !== null;
    if (!notification) return;
    this.text.text = notification.text;
    const positions: number[] = [], indices: number[] = [];
    for (const [x, y, ex, ey] of notificationGlyph(notification.glyph, snap.elapsedS)) {
      const length = Math.hypot(ex - x, ey - y);
      if (length < 0.00001) continue;
      const dx = -(ey - y) / length * 0.11, dy = (ex - x) / length * 0.11;
      const base = positions.length / 3;
      positions.push(x + dx, 0.05, -y - dy, x - dx, 0.05, -y + dy,
        ex + dx, 0.05, -ey - dy, ex - dx, 0.05, -ey + dy);
      indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
    const color: [number, number, number, number] = notification.tone === "warning" ? [1, 0.84, 0.04, 1]
      : notification.tone === "success" ? [0.19, 0.82, 0.35, 1] : [1, 0.27, 0.23, 1];
    this.icon.triangles(positions, indices, color);
    const transform = this.camera.getTransform(), rotation = transform.getWorldRotation();
    const target = transform.getWorldPosition().add(rotation.multiplyVec3(new vec3(0, -15, -65)));
    const alpha = 1 - Math.exp(-12 * Math.max(0, deltaS));
    const current = this.root.getTransform();
    current.setWorldPosition(vec3.lerp(current.getWorldPosition(), target, alpha));
    const tilted = rotation.multiply(quat.angleAxis(-VIEWER_NOTIFICATION_STYLE.upwardTiltRad, vec3.right()));
    current.setWorldRotation(quat.slerp(current.getWorldRotation(), tilted, alpha));
  }
  dispose(): void { if (!this.disposed) { this.disposed = true; this.root.destroy(); } }
}
