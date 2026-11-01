import { ARM_VISUAL_STYLE } from "../../DimOSARClient/manipulation/ManipulationVisuals";
export const ARM_MATERIAL = requireAsset("../../../Materials/ArmFresnel.mat") as Material;

export function configureArmMaterial(material: Material, opacity = 1): void {
  const pass = material.mainPass as Pass & { fill: number; edgeOpacity: number; power: number; twoSided: boolean };
  pass.fill = pass.edgeOpacity = ARM_VISUAL_STYLE.fill * opacity;
  // Negative power selects the flat surface branch; the measured sphere retains Fresnel.
  pass.power = -1;
  pass.twoSided = false;
}
