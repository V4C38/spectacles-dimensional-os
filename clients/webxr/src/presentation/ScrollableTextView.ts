import * as THREE from "three";
import * as xb from "xrblocks";
import { GlassSurface } from "./GlassSurface";
import { DIMOS_AR_DESIGN } from "./DimOSARDesign";
import { disposeTextResources } from "./TextResources";
import { registerRayTarget } from "../input/XRBlocksRayInteraction";

type SDFText = THREE.Mesh & {
  anchorY: string; anchorX: string; maxWidth: number; overflowWrap: string;
  clipRect: number[]; textRenderInfo?: { blockBounds: number[] };
  sync(callback?: () => void): void;
};

/** Complete text in a fixed viewport. Scroll offsets are in this view's local units. */
export class ScrollableTextView extends xb.TextView {
  readonly scrollHit: THREE.Mesh;
  readonly bodyHit: THREE.Mesh;
  private readonly track: GlassSurface;
  private readonly thumb: GlassSurface;
  private offset = 0;
  private contentHeight = 0;
  private endFollowing = false;
  private resetOnSync = false;
  private readonly listeners = new Map<SDFText, () => void>();
  private disposed = false;

  constructor(options: ConstructorParameters<typeof xb.TextView>[0], bodyScrollable = true) {
    super(options);
    this.scrollHit = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ visible: false }));
    this.bodyHit = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ visible: false }));
    this.track = new GlassSurface({ width: 1, height: 1, radius: 0.5, tint: DIMOS_AR_DESIGN.colors.disabled, alpha: 0.3, rim: 0 });
    this.thumb = new GlassSurface({ width: 1, height: 1, radius: 0.5, tint: DIMOS_AR_DESIGN.colors.muted, alpha: 0.8, rim: 0 });
    this.track.material.depthWrite = this.thumb.material.depthWrite = false;
    for (const node of [this.scrollHit, this.bodyHit]) {
      node.userData.scrollView = this;
      node.userData.rayPriority = -1;
      registerRayTarget(node);
    }
    this.scrollHit.userData.scrollbar = true;
    this.bodyHit.userData.bodyScrollable = bodyScrollable;
    this.track.raycast = this.thumb.raycast = () => {};
    this.add(this.scrollHit, this.bodyHit, this.track, this.thumb);
    this.name = "Scrollable text";
  }

  color(value: string): void { this.fontColor = value; this.setTextColor(value); }

  get scrollOffset(): number { return this.offset; }
  get maxScroll(): number { return Math.max(0, this.contentHeight - this.rangeY); }
  setContent(value: string, followEnd = false, reset = false): void {
    this.endFollowing = followEnd;
    if (this.text === value) return;
    this.resetOnSync = reset;
    this.setText(value);
  }
  scrollTo(value: number): void {
    this.endFollowing = false;
    this.offset = THREE.MathUtils.clamp(value, 0, this.maxScroll);
    this.applyViewport();
  }
  scrollBy(value: number): void { this.scrollTo(this.offset + value); }

  override updateLayout(): void {
    super.updateLayout();
    this.maxWidth = Math.max(0.1, this.rangeX - this.scrollGutter);
    if (this.textObj) this.createTextSDF();
    this.applyViewport();
  }

  protected override createTextSDF(): void {
    if (this.disposed) return;
    this.maxWidth = Math.max(0.1, this.rangeX - this.scrollGutter);
    super.createTextSDF();
    const text = this.textObj as SDFText | undefined;
    if (!text) return;
    text.anchorX = "left"; text.anchorY = "top";
    text.maxWidth = this.maxWidth; text.overflowWrap = "break-word";
    text.raycast = () => {};
    if (!this.listeners.has(text)) {
      const listener = () => {
        if (this.disposed) return;
        const bounds = text.textRenderInfo?.blockBounds;
        this.contentHeight = bounds ? Math.max(0, bounds[3] - bounds[1]) : 0;
        this.offset = this.endFollowing ? this.maxScroll : this.resetOnSync ? 0 : Math.min(this.offset, this.maxScroll);
        this.resetOnSync = false;
        this.applyViewport();
      };
      this.listeners.set(text, listener);
      (text as unknown as { addEventListener: (name: string, fn: () => void) => void }).addEventListener("synccomplete", listener);
    }
    this.applyViewport();
    text.sync();
  }

  private get unitsPerMeter(): number { return this.scale.y > 0 ? 1 / (this.scale.y * DIMOS_AR_DESIGN.panel.height) : 1; }
  private get scrollGutter(): number { return (DIMOS_AR_DESIGN.scroll.hitWidth + DIMOS_AR_DESIGN.scroll.gap) * this.unitsPerMeter; }

  private applyViewport(): void {
    const text = this.textObj as SDFText | undefined;
    if (text) {
      text.position.set(-this.rangeX / 2, this.rangeY / 2 + this.offset, 0);
      text.clipRect = [0, -this.rangeY - this.offset, this.maxWidth, -this.offset];
    }
    if (!this.scrollHit) return;
    for (const node of [this.scrollHit, this.bodyHit, this.track, this.thumb]) node.renderOrder = this.renderOrder + 1;
    if (text) text.renderOrder = this.renderOrder + 1;
    const overflow = this.maxScroll > 0.001;
    this.scrollHit.visible = this.track.visible = this.thumb.visible = overflow;
    this.bodyHit.visible = this.bodyHit.userData.bodyScrollable === true;
    const units = this.unitsPerMeter;
    const { width, hitWidth, minimumThumb } = DIMOS_AR_DESIGN.scroll;
    const x = this.rangeX / 2 - hitWidth * units / 2;
    this.scrollHit.scale.set(hitWidth * units, this.rangeY, 1);
    this.scrollHit.position.set(x, 0, 0.01);
    this.bodyHit.scale.set(Math.max(0.1, this.rangeX - this.scrollGutter), this.rangeY, 1);
    this.bodyHit.position.set(-this.scrollGutter / 2, 0, 0.008);
    this.track.resize(width * units * 0.7, this.rangeY);
    this.track.material.uniforms.uRadius.value = width * units * 0.35;
    this.track.position.set(x, 0, 0.012);
    const thumbHeight = Math.min(this.rangeY, Math.max(minimumThumb * units, this.rangeY * Math.min(1, this.rangeY / Math.max(this.rangeY, this.contentHeight))));
    this.thumb.resize(width * units, thumbHeight);
    this.thumb.material.uniforms.uRadius.value = width * units / 2;
    this.thumb.position.set(x, (this.rangeY - thumbHeight) * (0.5 - (this.maxScroll ? this.offset / this.maxScroll : 0)), 0.014);
  }

  override dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [text, listener] of this.listeners) (text as unknown as { removeEventListener: (name: string, fn: () => void) => void }).removeEventListener("synccomplete", listener);
    this.listeners.clear();
    super.dispose();
    disposeTextResources(this.textObj as THREE.Mesh | undefined);
    for (const node of [this.scrollHit, this.bodyHit, this.track, this.thumb]) {
      node.geometry.dispose(); (node.material as THREE.Material).dispose(); node.removeFromParent();
    }
  }
}
