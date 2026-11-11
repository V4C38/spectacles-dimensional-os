import * as THREE from "three";

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
