import type { RoundedRectangle } from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle";
import { NotificationCenter, notificationGlyph, type ClientNotification } from "DimOSARClient.lspkg/Scripts/DimOSARClient/presentation/NotificationCenter";
import { VIEWER_NOTIFICATION_STYLE } from "DimOSARClient.lspkg/Scripts/DimOSARClient/presentation/WorldVisualStyle";
import { WorldMeshRenderer } from "./WorldMeshRenderer";
import { createRoundedSurface, createText, uiMaterialLayer, COLOR_WHITE } from "./UIKit";

/** Non-interactive viewer-relative feedback, driven only by visible-frame time. */
export class ViewerNotificationPresenter {
  private disposed = false;
  private readonly center = new NotificationCenter();
  readonly root: SceneObject;
  private readonly text: Text;
  private readonly icon: WorldMeshRenderer;
  private readonly plate: RoundedRectangle;

  constructor(private readonly camera: SceneObject, layout = {
    widthM: 0.24, heightM: 0.05, fontSize: 42,
  }, parent?: SceneObject) {
    this.root = global.scene.createSceneObject("ViewerNotification");
    if (parent) this.root.setParent(parent);
    const iconX = -layout.widthM * 50 + 2;
    const textWidth = layout.widthM * 100 - 6;
    this.text = createText({ parent: this.root, name: "NotificationText", fontSize: layout.fontSize, color: COLOR_WHITE,
      position: new vec3(1.8, 0, 0.2), horizontalAlignment: HorizontalAlignment.Center,
      worldSpaceRect: Rect.create(-textWidth / 2, textWidth / 2, -2, 2) });
    this.plate = createRoundedSurface(this.root, "NotificationPlate", layout.widthM * 100, layout.heightM * 100, vec3.zero(), new vec4(0.05, 0.05, 0.06, 0.9), layout.heightM * 50, 100);
    this.icon = new WorldMeshRenderer(this.root, "NotificationIcon");
    this.icon.object.getTransform().setLocalPosition(new vec3(iconX, 0, 0.3));
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
    this.draw(notification, snap.elapsedS);
    if (!notification) return;
    const transform = this.camera.getTransform(), rotation = transform.getWorldRotation();
    const target = transform.getWorldPosition().add(rotation.multiplyVec3(new vec3(0, -15, -65)));
    const alpha = 1 - Math.exp(-12 * Math.max(0, deltaS));
    const current = this.root.getTransform();
    current.setWorldPosition(vec3.lerp(current.getWorldPosition(), target, alpha));
    const tilted = rotation.multiply(quat.angleAxis(-VIEWER_NOTIFICATION_STYLE.upwardTiltRad, vec3.right()));
    current.setWorldRotation(quat.slerp(current.getWorldRotation(), tilted, alpha));
  }
  draw(notification: ClientNotification | null, elapsedS: number, opacity = 1, appearance: {
    plateAlpha?: number; warningColor?: [number, number, number]; neutralColor?: [number, number, number];
  } = {}): void {
    this.root.enabled = notification !== null;
    if (!notification) return;
    this.text.text = notification.text;
    this.text.textFill.color = new vec4(1, 1, 1, opacity);
    this.plate.backgroundColor = new vec4(0.05, 0.05, 0.06, (appearance.plateAlpha ?? 0.9) * opacity);
    const positions: number[] = [], indices: number[] = [];
    for (const [x, y, ex, ey] of notificationGlyph(notification.glyph, elapsedS)) {
      const length = Math.hypot(ex - x, ey - y);
      if (length < 0.00001) continue;
      const dx = -(ey - y) / length * 0.11, dy = (ex - x) / length * 0.11;
      const base = positions.length / 3;
      positions.push(x + dx, 0.05, -y - dy, x - dx, 0.05, -y + dy,
        ex + dx, 0.05, -ey - dy, ex - dx, 0.05, -ey + dy);
      indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
    const color: [number, number, number, number] = notification.tone === "warning" ? [...(appearance.warningColor ?? [1, 0.84, 0.04]), opacity]
      : notification.tone === "success" ? [0.19, 0.82, 0.35, opacity] : notification.tone === "neutral" ? [...(appearance.neutralColor ?? [1, 0.27, 0.23]), opacity] : [1, 0.27, 0.23, opacity];
    this.icon.triangles(positions, indices, color);
  }
  dispose(): void { if (!this.disposed) { this.disposed = true; this.root.destroy(); } }
}
