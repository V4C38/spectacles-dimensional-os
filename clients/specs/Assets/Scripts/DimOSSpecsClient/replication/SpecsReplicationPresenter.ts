import { NAVIGATION_OUTCOME_STYLE } from "../../DimOSARClient/presentation/WorldVisualStyle";
import { strokeMesh2D, type WorldColor } from "../presentation/WorldMeshRenderer";

/** Convert portable blocked facts into Lens marker geometry, without owning authority. */
export class SpecsReplicationPresenter {
  static color(opacity: number): WorldColor { return [0.557, 0.588, 0.620, opacity]; }

  static cross(scale: number): ReturnType<typeof strokeMesh2D> {
    const points = NAVIGATION_OUTCOME_STYLE.cross;
    const segments = [[...points[0], ...points[1]], [...points[2], ...points[3]]];
    return strokeMesh2D(segments.map(row => row.map(value => value * 100)), [1, 1],
      NAVIGATION_OUTCOME_STYLE.glyphWidthM * 100, "xz", scale);
  }
}
