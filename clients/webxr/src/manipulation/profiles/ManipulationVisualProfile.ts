import type { ManipulationModel } from "@dimos-ar-client/manipulation/ManipulationTypes";

export function visualProfile(model: ManipulationModel): { rootMeshRotationY: number } {
  if (model.visual_profile !== undefined && model.visual_profile !== "openyam")
    throw new Error(`Unsupported manipulation visual profile: ${model.visual_profile}`);
  return { rootMeshRotationY: Math.PI / 2 };
}
