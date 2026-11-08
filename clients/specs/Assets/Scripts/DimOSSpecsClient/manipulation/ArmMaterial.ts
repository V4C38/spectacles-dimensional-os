import { ARM_VISUAL_STYLE } from "../../DimOSARClient/manipulation/ManipulationVisuals";
export const ARM_MATERIAL = requireAsset("../../../Materials/ArmFresnel.mat") as Material;

export function configureArmMaterial(material: Material, opacity = 1): void {
  const pass = material.mainPass as Pass & { fill: number; edgeOpacity: number; power: number; twoSided: boolean };
  pass.fill = pass.edgeOpacity = ARM_VISUAL_STYLE.fill * opacity;
  // Negative power selects the flat surface branch; the measured sphere retains Fresnel.
  pass.power = -1;
  pass.twoSided = false;
}

export const ARM_SURFACE_MATERIAL = requireAsset("../../../Materials/ArmSurface.mat") as Material;
const surfaceValues = new WeakMap<Material, string>();
export function configureArmSurface(material: Material, opacity: number, color: number): void {
  const key = `${opacity}:${color}`;
  if (surfaceValues.get(material) === key) return;
  const pass = material.mainPass as any;
  pass.opacityScale = ARM_VISUAL_STYLE.fill * opacity;
  pass.colorR = ((color >> 16) & 255) / 255;
  pass.colorG = ((color >> 8) & 255) / 255;
  pass.colorB = (color & 255) / 255;
  surfaceValues.set(material, key);
}
