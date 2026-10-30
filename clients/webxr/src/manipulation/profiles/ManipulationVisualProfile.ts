import type { Vec3 } from "@dimos-ar-client/websocket/protocolTypes";
import type { ManipulationModel } from "@dimos-ar-client/manipulation/ManipulationTypes";
import { OPENYAM_FOREARM_BOXES } from "./OpenYAMVisualProfile";

interface ManipulationVisualProfile {
  rootBoundsRotationY: number;
  rootMeshRotationY: number;
  linkBounds: Readonly<Record<string, readonly { center: Vec3; size: Vec3 }[]>>;
}
const GENERIC: ManipulationVisualProfile = {
  rootBoundsRotationY: 0,
  // Retain the authored GLB root mesh convention independently of bounds corrections.
  rootMeshRotationY: Math.PI / 2,
  linkBounds: {},
};
const OPENYAM: ManipulationVisualProfile = {
  rootBoundsRotationY: Math.PI / 2,
  rootMeshRotationY: Math.PI / 2,
  linkBounds: { link3: OPENYAM_FOREARM_BOXES },
};
export function visualProfile(
  model: ManipulationModel,
): ManipulationVisualProfile {
  switch (model.visual_profile) {
    case undefined:
      return GENERIC;
    case "openyam":
      return OPENYAM;
    default:
      throw new Error(
        `Unsupported manipulation visual profile: ${model.visual_profile}`,
      );
  }
}
