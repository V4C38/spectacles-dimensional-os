import type { ClientTrackingOrigin } from "DimOSARClient.lspkg/Scripts/DimOSARClient/localization/ClientTracking";
import { MarkerCorrectionTrail } from "DimOSARClient.lspkg/Scripts/DimOSARClient/presentation/WorldPresentation";
import { AdaptiveStrokeRenderer, WorldMeshRenderer } from "./WorldMeshRenderer";

/** Reused visual meshes only; no interaction components or localization writes. */
export class MarkerCorrectionRenderer {
  private readonly trail = new MarkerCorrectionTrail(100);
  private readonly sphere: WorldMeshRenderer;
  private readonly stem: AdaptiveStrokeRenderer | null;

  constructor(parent: SceneObject, private readonly source: WorldMeshRenderer, withStem = false) {
    this.sphere = source.visualCopy(parent, "MarkerCorrectionTrail", 0.3);
    this.stem = withStem ? new AdaptiveStrokeRenderer(this.sphere.object, "CorrectionFloorConnector") : null;
    this.reset();
  }

  update(origin: ClientTrackingOrigin | null, now: number, floorY?: number, viewportHeight = 1024): void {
    this.source.object.getTransform().setLocalPosition(vec3.zero());
    const p = this.source.object.getTransform().getWorldPosition();
    const ghost = this.trail.update(origin, [p.x, p.y, p.z], now);
    if (this.trail.displayedPosition) this.source.object.getTransform().setWorldPosition(new vec3(...this.trail.displayedPosition));
    this.sphere.object.getTransform().setLocalScale(new vec3(1, 1, 1).uniformScale(this.trail.scale));
    this.sphere.object.enabled = ghost !== null;
    if (!ghost) return;
    const color = this.source.color;
    if (color) this.sphere.setColor([color[0], color[1], color[2], color[3] * 0.3]);
    this.sphere.object.getTransform().setWorldPosition(new vec3(...ghost));
    this.sphere.object.getTransform().setWorldRotation(quat.quatIdentity());
    if (this.stem) {
      this.stem.setViewportHeight(viewportHeight);
      const bottom = floorY === undefined ? 3 : Math.max(3, ghost[1] - floorY - 2);
      if (bottom > 3) this.stem.segments([[0, -3, 0], [0, -bottom, 0]], 0.275, 0.8 * 0.3);
      else this.stem.hide();
    }
  }

  reset(): void { this.trail.reset(); this.sphere.hide(); this.source.object.getTransform().setLocalPosition(vec3.zero()); }
}
