import * as THREE from "three";
import * as xb from "xrblocks";
import { ButtonFootprint } from "./ButtonFootprint";
import { glassMaterial } from "./GlassSurface";
import { buttonSurfaceBacking, tintButtonBacking } from "./RoundedSurfaceGeometry";
import { DIMOS_AR_DESIGN } from "./DimOSARDesign";
import { registerRayTarget, UI_CONTROL_RAY_PRIORITY } from "../input/XRBlocksRayInteraction";
const C = DIMOS_AR_DESIGN.colors;
const HEIGHT = DIMOS_AR_DESIGN.panel.height;
export type ButtonVariant = "default" | "primary" | "danger" | "field" | "tab";

export class SurfaceButton extends xb.TextButton {
  private disposed = false;
  override dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeBacking();
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
  private backing: ReturnType<typeof buttonSurfaceBacking> | null = null;
  private footprint: ButtonFootprint | null = null;
  private supportSurface: THREE.Object3D | null = null;
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
    mesh.userData.rayPriority = UI_CONTROL_RAY_PRIORITY;
    registerRayTarget(mesh);
    mesh.userData.touchButton = true;
    this.disposeBacking();
    // A unit-depth body is scaled to physical metres independently of panel scale.
    this.backing = buttonSurfaceBacking(this.rangeX, this.rangeY, radius, 1);
    this.backing.renderOrder = mesh.renderOrder - 1;
    mesh.add(this.backing);
    this.footprint = new ButtonFootprint(this.rangeX, this.rangeY, radius);
    this.footprint.renderOrder = mesh.renderOrder - 2;
    this.add(this.footprint);
    this.positionSurface(0);
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
    if (this.backing) tintButtonBacking(this.backing, uniforms.uTint.value, this.hover);
    this.syncSurfaceDepth();
    this.setTextColor(this.fontColor);
  }

  syncSurfaceDepth(): void {
    const lift = Math.min(1, this.hover) * DIMOS_AR_DESIGN.depth.hover - Math.max(0, this.hover - 1) * 0.003;
    this.positionSurface(lift);
    this.positionText();
  }

  setSupportSurface(surface: THREE.Object3D): void {
    this.supportSurface = surface;
    this.positionSurface(0);
  }

  private positionSurface(lift: number): void {
    const restingDepth = this.variant === "primary" ? DIMOS_AR_DESIGN.depth.primary : DIMOS_AR_DESIGN.depth.secondary;
    const thickness = (restingDepth + DIMOS_AR_DESIGN.depth.controlOverlap) * DIMOS_AR_DESIGN.depth.controlThicknessScale;
    const activeLift = this.active && this.variant !== "field" && this.variant !== "primary" ? DIMOS_AR_DESIGN.depth.primary - DIMOS_AR_DESIGN.depth.secondary : 0;
    const parentScale = Math.max(1e-6, this.parent?.getWorldScale(new THREE.Vector3()).z ?? 1);
    const worldScale = this.getWorldScale(new THREE.Vector3());
    const scale = Math.max(1e-6, worldScale.z);
    const support = this.supportSurface?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();
    const supportZ = this.supportSurface && this.parent ? this.parent.worldToLocal(support).z : 0;
    const clearance = DIMOS_AR_DESIGN.depth.controlOverlap;
    const footprintZ = supportZ + clearance / parentScale;
    // Two tiny clearances separate the supporting surface, footprint, and resting back.
    const restingZ = supportZ + (thickness + clearance * 2) / parentScale;
    this.position.z = restingZ + (this.variant === "field" ? 0 : activeLift + lift) / parentScale;
    if (this.backing) this.backing.scale.z = thickness / scale;
    if (this.footprint) {
      this.footprint.setLift(this.variant === "field" ? 0 : activeLift + lift, worldScale);
      this.footprint.position.z = (footprintZ - this.position.z) * parentScale / scale;
    }
  }

  private disposeBacking(): void {
    this.footprint?.removeFromParent();
    this.footprint?.dispose();
    this.footprint = null;
    if (!this.backing) return;
    this.backing.removeFromParent();
    this.backing.geometry.dispose();
    this.backing.material.dispose();
    this.backing = null;
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
      uniforms.uAlpha.value = 1;
      if (!this.mesh!.userData.styled) uniforms.uTint.value.copy(this.targetTint);
      if (this.backing) tintButtonBacking(this.backing, uniforms.uTint.value, this.hover);
      this.mesh!.userData.styled = true;
    }
    this.fontColor = !this.enabled ? C.disabled : this.variant === "danger" ? C.ink : primary ? C.primaryText : this.variant === "tab" ? C.muted : C.ink;
  }
}
