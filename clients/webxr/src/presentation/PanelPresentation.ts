import { layoutPanelRows, type PanelProfile, type LayoutRow, CONTROL_PANEL_LAYOUT, CONTROL_PANEL_CONTROLS } from "@dimos-ar-client/presentation/ControlPanelPresentation";

import * as THREE from "three";

export type { PanelProfile, LayoutRow } from "@dimos-ar-client/presentation/ControlPanelPresentation";

/** Metre-space profiles; controls keep their calibrated physical size. */
export const PANEL_TOP = CONTROL_PANEL_LAYOUT.height / 2;
export const PANEL_BOTTOM_PADDING = 0.05;
/** Keep Emergency Stop visually separate from the runtime page content. */
export const RUNTIME_FOOTER_GAP = 0.04;

export function panelProfile(startY: number, rows: readonly LayoutRow[], footer = true, footerGap: number = CONTROL_PANEL_CONTROLS.gap): PanelProfile {
  return layoutPanelRows(startY, rows, { top: PANEL_TOP, gap: CONTROL_PANEL_CONTROLS.gap, bottom: PANEL_BOTTOM_PADDING, action: CONTROL_PANEL_CONTROLS.height, maximumHeight: CONTROL_PANEL_LAYOUT.height, quantum: 0.01 }, footer, footerGap);
}

export function panelFooterY(height: number): number {
  return PANEL_TOP - height + PANEL_BOTTOM_PADDING + CONTROL_PANEL_CONTROLS.height / 2;
}

function runtimeProfile(startY: number, rows: readonly LayoutRow[]): PanelProfile {
  return panelProfile(startY, rows, true, RUNTIME_FOOTER_GAP);
}

export const RUNTIME_LAYOUTS = {
  manual: runtimeProfile(0.146, [["guidance", 0.18], ["status", 0.018]]),
  agent: runtimeProfile(0.146, [["reply", 0.12], ["draft", 0.12], ["actions", 0.064], ["status", 0.018, 0.01]]),
  settings: runtimeProfile(.23, [["robotActions",.064],["headset",.03],["debug",.064,.01],["diagnostics",.064],["sound",.064]]),
  sensors: runtimeProfile(0.112, [["range", 0.064], ["points", 0.064], ["statistics", 0.1, 0.03]]),
  diagnostics: runtimeProfile(0.23, [["logs", 0.26], ["statistics", .1]]),
  alignment: runtimeProfile(0.23, [["guidance", 0.07], ["actions", 0.064]]),
} as const;

// WebXR connects through the launcher, so it has no PIN/IP entry row.
export const SETUP_LAYOUTS = {
  entry: panelProfile(0.145, [["intro", 0.03], ["status", 0.04], ["details", 0.04]]),
  error: panelProfile(0.145, [["intro", 0.03], ["status", 0.065], ["details", 0.1]]),
  connected: panelProfile(0.145, [["intro", 0.03], ["status", 0.04], ["details", 0.115]]),
  capture: panelProfile(0.145, [["provider", 0.03], ["camera", 0.22], ["previewLabel", 0.022, 0.012]]),
  message: panelProfile(0.145, [["provider", 0.03], ["status", 0.04], ["details", 0.1]]),
  success: panelProfile(0.23, [["glyph", 0.188], ["title", 0.05], ["detail", 0.04]], false),
} as const;

/** Page fade history is independent of the selected page and panel height. */
export class PanelPageTransitions {
  readonly pages = new Map<THREE.Group, { progress: number; target: boolean }>();
  private readonly lastOpacity = new WeakMap<THREE.Object3D, number>();
  private readonly materials = new WeakMap<THREE.Material, { opacity: number; alpha: number | null }>();
  clear(): void { this.pages.clear(); }
  request(page: THREE.Group, height: number): void {
    const target = page.visible;
    const state = this.pages.get(page) ?? { progress: 0, target };
    state.target = target; this.pages.set(page, state);
    const fits = (page.userData.panelHeight ?? 0) <= height + 1e-8;
    page.userData.rayDisabled = !target || !fits;
    page.visible = (target || state.progress > 0) && fits;
  }
  update(root: THREE.Object3D, panel: THREE.Object3D, plate: THREE.Object3D,
    rootOpacity: number, height: number, step: number): void {
    const ease = (t: number) => t * t * (3 - 2 * t);
    for (const child of root.children)
      if (child !== plate && !this.pages.has(child as THREE.Group)) this.fade(child, rootOpacity);
    for (const [page, state] of this.pages) {
      state.progress = THREE.MathUtils.clamp(state.progress + (state.target ? step : -step), 0, 1);
      const fits = (page.userData.panelHeight ?? 0) <= height + 1e-8;
      page.userData.rayDisabled = !state.target || !fits;
      page.visible = (state.target || state.progress > 0) && fits;
      page.scale.setScalar(1);
    }
    for (const [page, state] of this.pages) {
      let opacity = rootOpacity * ease(state.progress);
      for (let parent = page.parent; parent && parent !== panel; parent = parent.parent) {
        const ancestor = parent instanceof THREE.Group ? this.pages.get(parent) : undefined;
        if (ancestor) opacity *= ease(ancestor.progress);
      }
      this.fade(page, opacity);
    }
  }
  private fade(page: THREE.Object3D, opacity: number): void {
    if (this.lastOpacity.get(page) === opacity) return;
    this.lastOpacity.set(page, opacity);
    const visit = (node: THREE.Object3D) => {
      if (node !== page && node instanceof THREE.Group && this.pages.has(node)) return;
      const material = (node as THREE.Mesh).material;
      for (const item of Array.isArray(material) ? material : material ? [material] : []) {
        const alpha = (item as THREE.ShaderMaterial).uniforms?.uOpacity ?? (item as THREE.ShaderMaterial).uniforms?.uAlpha;
        const base = this.materials.get(item) ?? { opacity: item.opacity, alpha: alpha?.value ?? null };
        this.materials.set(item, base);
        if (!item.transparent) { item.transparent = true; item.needsUpdate = true; }
        if (alpha && base.alpha !== null) alpha.value = base.alpha * opacity;
        else item.opacity = base.opacity * opacity;
      }
      for (const child of node.children) visit(child);
    };
    visit(page);
  }
}
