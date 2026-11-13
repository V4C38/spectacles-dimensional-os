import { CursorControllerProvider } from "SpectaclesInteractionKit.lspkg/Providers/CursorControllerProvider/CursorControllerProvider";
import { InteractionManager } from "SpectaclesInteractionKit.lspkg/Core/InteractionManager/InteractionManager";
import { InteractorInputType } from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor";
import { ManipulationInputCapture, ManipulationPressEdges } from "DimOSARClient.lspkg/Scripts/DimOSARClient/manipulation/ManipulationInputCapture";
import type { ManipulationPose } from "DimOSARClient.lspkg/Scripts/DimOSARClient/manipulation/ManipulationTypes";
import { specsToClientTrackingPose } from "../utilities/SpecsCoordinates";

export interface ManipulationInputPort {
  begin(pose: ManipulationPose): boolean;
  hold(pose: ManipulationPose): void;
  end(): void;
  interrupt(): void;
  pressTarget(object: SceneObject, sourceId: string): boolean;
  ownsHandle(object: SceneObject): boolean;
}

/** SIK owns hit testing; capture survives leaving the end-effector collider. */
export class SpecsManipulationInput {
  private readonly pressEdges = new ManipulationPressEdges();
  private pin: { object: SceneObject; localPoint: vec3; cursor: { cursorPosition: vec3 | null } } | null = null;
  updateCursor(): void {
    if (this.pin) this.pin.cursor.cursorPosition = this.pin.object.getTransform().getWorldTransform().multiplyPoint(this.pin.localPoint);
  }
  private clearCursor(): void {
    if (this.pin) this.pin.cursor.cursorPosition = null;
    this.pin = null;
  }
  constructor(private readonly port: ManipulationInputPort, readonly capture = new ManipulationInputCapture()) {}
  tick(enabled: boolean): void {
    if (!enabled) { this.reset(); return; }
    const seen = new Set<string>();
    const mask = InteractorInputType.BothHands | (global.deviceInfoSystem.isEditor() ? InteractorInputType.Mouse : 0);
    for (const source of InteractionManager.getInstance().getInteractorsByType(mask)) {
      const id = String(source.inputType); seen.add(id);
      const p = source.startPoint, q = source.orientation;
      if (!source.isActive() || !p || !q) {
        this.pressEdges.observe(id, source.isTriggering);
        if (this.capture.release(id, "tracking lost")) { this.clearCursor(); this.port.interrupt(); }
        continue;
      }
      const pose = specsToClientTrackingPose({ position: [p.x, p.y, p.z], orientation: [q.x, q.y, q.z, q.w] });
      const target = source.currentInteractable?.getSceneObject();
      const pressed = this.pressEdges.observe(id, source.isTriggering);
      if (source.isTriggering) {
        if (pressed && target && this.port.pressTarget(target, id)) continue;
        if (pressed && target && this.port.ownsHandle(target) && this.capture.begin(id)) {
          if (!this.port.begin(pose)) this.capture.release(id);
          else {
            const cursor = CursorControllerProvider.getInstance().getCursorByInteractor(source);
            if (cursor && source.targetHitPosition) {
              this.pin = { object: target, cursor, localPoint: target.getTransform().getWorldTransform().inverse().multiplyPoint(source.targetHitPosition) };
            }
          }
        }
        if (this.capture.owner === id) this.port.hold(pose);
      } else {
        if (this.capture.release(id)) { this.clearCursor(); this.port.end(); }
      }
    }
    if (this.capture.owner !== null && !seen.has(this.capture.owner)) { this.clearCursor(); this.port.interrupt(); this.capture.reset("input source removed"); }

  }
  reset(): void {
    const mask = InteractorInputType.BothHands | (global.deviceInfoSystem.isEditor() ? InteractorInputType.Mouse : 0);
    for (const source of InteractionManager.getInstance().getInteractorsByType(mask)) {
      if (source.isTriggering) this.pressEdges.observe(String(source.inputType), true);
    }
    this.clearCursor(); this.port.interrupt(); this.capture.reset();
  }
}
