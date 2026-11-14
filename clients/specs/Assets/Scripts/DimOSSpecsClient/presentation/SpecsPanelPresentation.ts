import type { Frame } from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame";
import { layoutPanelRows, type PanelProfile, type LayoutRow, CONTROL_PANEL_SCALE } from "DimOSARClient.lspkg/Scripts/DimOSARClient/presentation/ControlPanelPresentation";
export type { PanelProfile, LayoutRow } from "DimOSARClient.lspkg/Scripts/DimOSARClient/presentation/ControlPanelPresentation";


/** Scale each native frame and its descendants together. */
export const SETUP_PANEL_SCALE = CONTROL_PANEL_SCALE.setup * 0.75;
export const RUNTIME_PANEL_SCALE = CONTROL_PANEL_SCALE.runtime * 0.75;

/** Specs-only design centimetres. Native content keeps its calibrated scale. */
export const PANEL_GEOMETRY = { width: 90, maximumHeight: 76, top: 38, gap: 2, sectionGap: 3, bottom: 5, action: 6.4 } as const;

export function panelProfile(startY: number, rows: readonly LayoutRow[], footer = true): PanelProfile {
  return layoutPanelRows(startY, rows, { ...PANEL_GEOMETRY, quantum: 1 }, footer);
}
export function panelContentOffset(height: number): number { return (height - PANEL_GEOMETRY.maximumHeight) / 2; }
export function panelFooterY(height: number): number {
  return PANEL_GEOMETRY.top - height + PANEL_GEOMETRY.bottom + PANEL_GEOMETRY.action / 2;
}
export function easePanel(t: number): number { const p = Math.max(0, Math.min(1, t)); return p * p * (3 - 2 * p); }

export const RUNTIME_LAYOUTS = {
  manual: panelProfile(14.6, [["guidance", 18], ["status", 1.8]]),
  agent: panelProfile(14.6, [["draft", 12], ["actions", 6.4], ["reply", 12], ["status", 1.8]]),
  settings: panelProfile(23, [["robotActions",6.4],["headset",3],["debug",6.4,1],["diagnostics",6.4],["sound",6.4]]),
  sensors: panelProfile(11.2, [["range", 6.4], ["points", 6.4], ["statistics", 10, 3]]),
  diagnostics: panelProfile(23, [["logs", 26], ["statistics", 10]]),
  alignment: panelProfile(23, [["guidance", 7], ["actions", 6.4]]),
} as const;
export const SETUP_LAYOUTS = {
  entry: panelProfile(14.5, [["status", 4], ["entry", 6.4]]),
  error: panelProfile(14.5, [["status", 6.5], ["entry", 6.4]]),
  connected: panelProfile(14.5, [["status", 4], ["entry", 6.4], ["details", 11.5]]),
  capture: panelProfile(14.5, [["provider", 3], ["camera", 22], ["previewLabel", 2.2, 1.2]]),
  message: panelProfile(14.5, [["provider", 3], ["status", 4], ["details", 10]]),
  success: panelProfile(23, [["glyph", 18.8], ["title", 5], ["detail", 4]], false),
} as const;

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
    transform.setWorldPosition(transform.getWorldPosition().add(up.uniformScale((76 - this.height) * this.scale * this.contentScale() / 2)));
    this.anchor = null;
    this.frame.smoothFollow?.resize(90 * this.scale * this.contentScale());
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
  private contentScale(): number { return this.frame?.content?.getTransform().getLocalScale().x ?? 1; }
  private begin(): void {
    this.start = this.height; this.elapsed = 0;
    if (!this.frame) return;
    this.restoreFollowing ||= this.frame.following;
    this.frame.setFollowing(false);
    const transform = this.frame.transform;
    this.anchor = transform.getWorldPosition().add(transform.getWorldRotation().multiplyVec3(new vec3(0, this.height * this.scale * this.contentScale() / 2, 0)));
  }
  private apply(height: number): void {
    const previous = this.height;
    this.height = height;
    this.root.getTransform().setLocalPosition(new vec3(0, panelContentOffset(height), 0));
    if (!this.frame) return;
    const transform = this.frame.transform, up = transform.getWorldRotation().multiplyVec3(vec3.up());
    if (this.anchor) transform.setWorldPosition(this.anchor.sub(up.uniformScale(height * this.scale * this.contentScale() / 2)));
    else if (this.visible) transform.setWorldPosition(transform.getWorldPosition().add(up.uniformScale((previous - height) * this.scale * this.contentScale() / 2)));
    const ratio = this.contentScale(), autoScale = this.frame.autoScaleContent;
    this.frame.autoScaleContent = false;
    this.frame.innerSize = new vec2(90*ratio - this.frame.border*2 - this.frame.padding.x, height*ratio - this.frame.border*2 - this.frame.padding.y);
    this.frame.autoScaleContent = autoScale;
    this.frame.smoothFollow?.resize(90 * this.scale * this.contentScale());
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
