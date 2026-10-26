import * as THREE from "three";
import * as xb from "xrblocks";
import { glassMaterial } from "./GlassSurface";
import { DIMOS_AR_DESIGN } from "./DimOSARDesign";
import { registerRayTarget } from "../input/XRBlocksRayInteraction";
const C = DIMOS_AR_DESIGN.colors;
const HEIGHT = DIMOS_AR_DESIGN.panel.height;
export type ButtonVariant = "default" | "primary" | "danger" | "field" | "tab";

export class SurfaceButton extends xb.TextButton {
  private disposed = false;
  override dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    super.dispose();
  }
  override async init(): Promise<void> { await super.init(); if (!this.disposed) this.positionText(); }
  protected override createTextSDF(): void {
    if (this.disposed) return;
    super.createTextSDF(); this.positionText();
  }
  private positionText(): void {
    const text = this.textObj as (typeof this.textObj & { depthOffset?: number });
    if (!text) return;
    // SDK gaps are local units; normalize to a physical half millimeter at every control size.
    text.position.z = DIMOS_AR_DESIGN.depth.labelOffset / Math.max(1e-6, this.getWorldScale(new THREE.Vector3()).z);
    text.depthOffset = -1;
    text.renderOrder = this.renderOrder + 1;
    for (const material of Array.isArray(text.material) ? text.material : [text.material]) material.depthWrite = false;
  }
  feedbackPressed = false;
  enabled = true;
  private variant: ButtonVariant = "default";
  private active = false;
  private hover = 0;
  private baseZ = 0;
  private lastUpdate = 0;
  private readonly targetTint = new THREE.Color();

  setSurface(variant: ButtonVariant, radius = variant === "field" ? DIMOS_AR_DESIGN.corners.field / (this.scale.y * HEIGHT) : Math.min(this.rangeX, this.rangeY) * DIMOS_AR_DESIGN.corners.controlRatio): void {
    this.variant = variant;
    const mesh = this.mesh!;
    (mesh.material as THREE.Material).dispose();
    mesh.geometry.dispose();
    mesh.geometry = new THREE.PlaneGeometry(this.rangeX, this.rangeY);
    mesh.material = glassMaterial({ width: this.rangeX, height: this.rangeY, radius, tint: C.control, alpha: 1, rim: 0.08, rimWidth: 0.002 / HEIGHT });
    mesh.material.depthWrite = false;
    mesh.renderOrder = this.renderOrder;
    mesh.name = `Button: ${this.text}`;
    registerRayTarget(mesh);
    mesh.userData.touchButton = true;
    this.baseZ = this.position.z;
    mesh.userData.styled = false;
    this.setEnabled(true);
  }

  override updateLayout(): void {
    super.updateLayout();
    // Physical geometry avoids the package's shared button shader state.
    this.mesh?.scale.set(1, 1, 1);
    this.maxWidth = this.rangeX * 0.86;
    if (this.textObj) this.createTextSDF();
  }

  override update(): void {
    const uniforms = (this.mesh?.material as THREE.ShaderMaterial | undefined)?.uniforms;
    if (!uniforms?.uHover) return;
    const target = this.feedbackPressed ? 1.6 : !this.enabled || !this.ux.isHovered() ? 0 : this.ux.isSelected() ? 1.6 : 1;
    const now = performance.now() / 1000;
    const deltaS = this.lastUpdate ? Math.min(0.1, now - this.lastUpdate) : 1 / 60;
    this.lastUpdate = now;
    this.hover += (target - this.hover) * (1 - Math.exp(-18 * deltaS));
    uniforms.uTint.value.lerp(this.targetTint, 1 - Math.exp(-20 * deltaS));
    uniforms.uHover.value = this.hover;
    const primary = this.variant === "primary" || this.active && this.variant !== "field";
    const depth = primary ? DIMOS_AR_DESIGN.depth.primary : DIMOS_AR_DESIGN.depth.secondary;
    const lift = Math.min(1, this.hover) * DIMOS_AR_DESIGN.depth.hover - Math.max(0, this.hover - 1) * 0.003;
    const parentScale = this.parent?.getWorldScale(new THREE.Vector3()).z ?? 1;
    this.position.z = this.variant === "field" ? this.baseZ : (depth + lift) / Math.max(1e-6, parentScale);
    this.positionText();
    this.setTextColor(this.fontColor);
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled && this.mesh?.userData.styled) return;
    this.enabled = enabled;
    if (this.mesh) this.mesh.userData.interactionEnabled = enabled;
    this.restyle();
  }

  setVariant(variant: ButtonVariant): void {
    if (this.variant !== variant) { this.variant = variant; this.restyle(); }
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.restyle();
  }

  private restyle(): void {
    const uniforms = (this.mesh?.material as THREE.ShaderMaterial | undefined)?.uniforms;
    const primary = this.variant === "primary" || this.active && this.variant !== "field";
    const surface = !this.enabled ? C.fill : this.variant === "danger" ? C.danger :
      this.variant === "field" ? C.field : primary ? C.primary : C.secondary;
    if (uniforms?.uTint) {
      this.targetTint.set(surface);
      uniforms.uAlpha.value = this.variant === "tab" && !this.active ? 0 : 1;
      if (!this.mesh!.userData.styled) uniforms.uTint.value.copy(this.targetTint);
      this.mesh!.userData.styled = true;
    }
    this.fontColor = !this.enabled ? C.disabled : this.variant === "danger" ? C.ink : primary ? C.primaryText : this.variant === "tab" ? C.muted : C.ink;
  }
}
