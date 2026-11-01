import { InteractionManager } from "SpectaclesInteractionKit.lspkg/Core/InteractionManager/InteractionManager";
import { InteractorInputType } from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor";
import { ManipulationInputCapture } from "../../DimOSARClient/manipulation/ManipulationInputCapture";
import type { ManipulationPose } from "../../DimOSARClient/manipulation/ManipulationTypes";
import { specsToClientTrackingPose } from "../utilities/SpecsCoordinates";

export interface ManipulationInputPort {
  begin(pose: ManipulationPose): boolean;
  hold(pose: ManipulationPose): void;
  end(): void;
  ownsHandle(object: SceneObject): boolean;
}

/** SIK owns hit testing; capture survives leaving the end-effector collider. */
export class SpecsManipulationInput {
  private readonly held = new Set<string>();
  constructor(private readonly port: ManipulationInputPort, readonly capture = new ManipulationInputCapture()) {}
  tick(enabled: boolean): void {
    if (!enabled) { this.reset(); return; }
    const seen = new Set<string>();
    const mask = InteractorInputType.BothHands | (global.deviceInfoSystem.isEditor() ? InteractorInputType.Mouse : 0);
    for (const source of InteractionManager.getInstance().getInteractorsByType(mask)) {
      const id = String(source.inputType); seen.add(id);
      const p = source.startPoint, q = source.orientation;
      if (!source.isActive() || !p || !q) {
        if (this.capture.release(id)) this.port.end();
        continue;
      }
      const pose = specsToClientTrackingPose({ position: [p.x, p.y, p.z], orientation: [q.x, q.y, q.z, q.w] });
      const target = source.currentInteractable?.getSceneObject();
      if (source.isTriggering) {
        if (!this.held.has(id) && target && this.port.ownsHandle(target) && this.capture.begin(id)) {
          if (!this.port.begin(pose)) this.capture.release(id);
        }
        if (this.capture.owner === id) this.port.hold(pose);
        this.held.add(id);
      } else {
        if (this.capture.release(id)) this.port.end();
        this.held.delete(id);
      }
    }
    if (this.capture.owner !== null && !seen.has(this.capture.owner)) { this.port.end(); this.capture.reset(); }
    for (const id of this.held) if (!seen.has(id)) this.held.delete(id);
  }
  reset(): void { this.port.end(); this.capture.reset(); }
}
