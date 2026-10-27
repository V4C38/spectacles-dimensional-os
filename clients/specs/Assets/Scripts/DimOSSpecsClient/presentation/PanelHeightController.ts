import type { Frame } from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame";
import { easePanel, panelContentOffset, PANEL_GEOMETRY } from "./PanelLayout";

/** Application-driven height changes; SUK continues to own grabbing and following. */
export class PanelHeightController {
  private disposed = false;
  private readonly subscriptions: (() => void)[] = [];
  private retain(subscription: unknown): void {
    if (typeof subscription === "function") this.subscriptions.push(subscription as () => void);
  }
  height = PANEL_GEOMETRY.maximumHeight as number;
  target = this.height;
  private start = this.height;
  private elapsed = 0.28;
  private visible = false;
  private dragging = false;
  private restoreFollowing = false;
  private anchor: vec3 | null = null;

  constructor(private readonly frame: Frame | null, private readonly root: SceneObject, private readonly scale: number) {
    this.retain(frame?.onTranslationStart.add(() => { this.dragging = true; this.restoreFollowing = false; }));
    this.retain(frame?.onTranslationEnd.add(() => {
      this.dragging = false;
      if (this.height !== this.target) this.begin();
    }));
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.visible = false; this.anchor = null;
    for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe();
  }
  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!visible) { this.restoreFollowing = false; this.apply(this.target); this.elapsed = 0.28; }
  }
  request(height: number): void {
    if (height === this.target) return;
    this.target = height;
    if (!this.visible || !this.frame) { this.apply(height); return; }
    this.begin();
  }
  /** Placement uses the original full-height reference, retaining its top edge. */
  placed(): void {
    if (!this.frame) return;
    const transform = this.frame.transform;
    const up = transform.getWorldRotation().multiplyVec3(vec3.up());
    transform.setWorldPosition(transform.getWorldPosition().add(up.uniformScale((76 - this.height) * this.scale / 2)));
    this.anchor = null;
    this.frame.smoothFollow?.resize(90 * this.scale);
  }
  tick(deltaS: number): void {
    if (this.disposed || !this.visible || this.dragging || this.height === this.target) return;
    this.elapsed = Math.min(0.28, this.elapsed + Math.max(0, deltaS));
    this.apply(this.start + (this.target - this.start) * easePanel(this.elapsed / 0.28));
    if (this.elapsed === 0.28) {
      this.apply(this.target);
      if (this.restoreFollowing) this.frame?.setFollowing(true);
      this.restoreFollowing = false; this.anchor = null;
    }
  }
  private begin(): void {
    this.start = this.height; this.elapsed = 0;
    if (!this.frame) return;
    this.restoreFollowing ||= this.frame.following;
    this.frame.setFollowing(false);
    const transform = this.frame.transform;
    this.anchor = transform.getWorldPosition().add(transform.getWorldRotation().multiplyVec3(new vec3(0, this.height * this.scale / 2, 0)));
  }
  private apply(height: number): void {
    const previous = this.height;
    this.height = height;
    this.root.getTransform().setLocalPosition(new vec3(0, panelContentOffset(height), 0));
    if (!this.frame) return;
    const transform = this.frame.transform, up = transform.getWorldRotation().multiplyVec3(vec3.up());
    if (this.anchor) transform.setWorldPosition(this.anchor.sub(up.uniformScale(height * this.scale / 2)));
    else if (this.visible) transform.setWorldPosition(transform.getWorldPosition().add(up.uniformScale((previous - height) * this.scale / 2)));
    this.frame.innerSize = new vec2(90 - this.frame.border * 2 - this.frame.padding.x, height - this.frame.border * 2 - this.frame.padding.y);
    this.frame.smoothFollow?.resize(90 * this.scale);
    this.sizeFollowButton();
  }
  private sizeFollowButton(): void {
    const button = this.frame?.showFollowButton ? this.frame.followButton : null;
    if (!button || !this.frame) return;
    // SUK resets native width during Frame.resize(). Scale its existing control,
    // icon and collider together to match our other 7.2 cm icon buttons.
    const diameter = 7.2, inset = 2;
    const ratio = diameter / button.width;
    const transform = button.getSceneObject().getTransform();
    transform.setLocalScale(new vec3(ratio, ratio, 1));
    transform.setLocalPosition(new vec3((90 - diameter) / 2 - inset, (this.height - diameter) / 2 - inset, 2));
  }
}
