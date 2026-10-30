import { ARM_FRESNEL_STYLE as STYLE, WORLD_DASH_STYLE } from "../../DimOSARClient/presentation/WorldVisualStyle";
export const ARM_MATERIAL = requireAsset("../../../Materials/ArmFresnel.mat") as Material;

export function configureArmMaterial(material: Material, thin = false): void {
  const pass = material.mainPass as Pass & { fill: number; edgeOpacity: number; power: number; dashM: number; gapM: number; twoSided: boolean };
  pass.fill = thin ? STYLE.toolFill : STYLE.fill;
  pass.edgeOpacity = thin ? STYLE.toolEdgeOpacity : STYLE.edgeOpacity;
  pass.power = STYLE.power;
  pass.dashM = WORLD_DASH_STYLE.dashM;
  pass.gapM = WORLD_DASH_STYLE.gapM;
  pass.twoSided = false;
}
