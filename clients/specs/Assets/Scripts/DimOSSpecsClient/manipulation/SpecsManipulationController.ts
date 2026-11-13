import { CursorControllerProvider } from "SpectaclesInteractionKit.lspkg/Providers/CursorControllerProvider/CursorControllerProvider";
import { InteractionManager } from "SpectaclesInteractionKit.lspkg/Core/InteractionManager/InteractionManager";
import { InteractorInputType } from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor";
import { ManipulationInputCapture, ManipulationPressEdges, ManipulationGesture } from "DimOSARClient.lspkg/Scripts/DimOSARClient/manipulation/ManipulationInput";
import type { ManipulationPose } from "DimOSARClient.lspkg/Scripts/DimOSARClient/manipulation/ManipulationTypes";
import { specsToClientTrackingPose } from "../utilities/SpecsCoordinates";
import { sameTrackingReference, type ClientTrackingOrigin, clientTrackingToOdomPose } from "DimOSARClient.lspkg/Scripts/DimOSARClient/localization/ClientTracking";


import { ManipulationController } from "DimOSARClient.lspkg/Scripts/DimOSARClient/manipulation/ManipulationController";

import type { ARModuleSession } from "DimOSARClient.lspkg/Scripts/DimOSARClient/websocket/ARModuleSession";
import { ManipulationRenderer } from "./ManipulationRenderer";

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


export class SpecsManipulationController {
  readonly core: ManipulationController;
  readonly renderer: ManipulationRenderer;
  readonly input: SpecsManipulationInput;
  private readonly gesture = new ManipulationGesture();
  private lastOrigin: ClientTrackingOrigin | null = null;
  private selected = false;
  constructor(private readonly session: ARModuleSession,
    private readonly origin: () => ClientTrackingOrigin | null, parent: SceneObject,
    private readonly camera: SceneObject, private readonly select: () => void, stop: () => void, recalibrate: () => void = () => {}) {
    this.core = new ManipulationController(session, () => getTime(), stop);
    const capture = new ManipulationInputCapture();
    this.renderer = new ManipulationRenderer(parent, this.core, capture, recalibrate);
    this.input = new SpecsManipulationInput(this, capture);
  }
  setSelected(selected: boolean): void {
    if (selected !== this.selected) this.interrupt();
    this.selected = selected; this.core.setSelected(selected);
  }
  pressTarget(object: SceneObject, sourceId: string): boolean {
    if (this.renderer.pressEndEffectorAction(object, sourceId)) return true;
    if (!this.renderer.ownsMesh(object)) return false;
    this.select(); return true;
  }
  ownsHandle(object: SceneObject): boolean { return this.renderer.ownsHandle(object); }
  begin(pose: ManipulationPose): boolean {
    const origin = this.origin(), interaction = this.core.interaction;
    const observed = this.session.view().manipulation?.observations?.[interaction.groupId ?? ""]?.pose;
    if (!origin || !observed || !interaction.begin()) return false;
    const transform = this.renderer.handle.getTransform(), p = transform.getWorldPosition(), q = transform.getWorldRotation();
    this.gesture.begin(pose, specsToClientTrackingPose({ position: [p.x, p.y, p.z], orientation: [q.x, q.y, q.z, q.w] }), getTime());
    return true;
  }
  hold(pose: ManipulationPose): void {
    const origin = this.origin() ?? (this.core.interaction.retainingFeedback ? this.lastOrigin : null); if (!origin) { this.end(); return; }
    const target = this.gesture.hold(pose, getTime());
    if (target) this.core.interaction.aim(clientTrackingToOdomPose(target, origin));
  }
  end(): void { this.gesture.end(); this.core.interaction.end(); }
  interrupt(): void { this.gesture.end(); this.core.interaction.interrupt(); }
  suspend(): void { this.input.reset(); this.core.suspend(); }
  tick(enabled: boolean): void {
    const view = this.session.view();
    const supported = view.capabilities?.manipulation?.available === true ||
      view.connection !== "ready" && view.capabilities === null && this.core.interaction.retainingFeedback;
    const retained = supported && this.core.interaction.retainingFeedback;
    const origin = this.origin() ?? (retained ? this.lastOrigin : null);
    if (!supported || (!enabled && !retained) || !sameTrackingReference(origin, this.lastOrigin)) this.suspend();
    if (origin && this.lastOrigin && origin !== this.lastOrigin && sameTrackingReference(origin, this.lastOrigin)) this.gesture.rebase(this.lastOrigin, origin);
    this.lastOrigin = origin;
    const active = supported && (enabled || retained) && !!origin && this.core.interaction.available;
    this.core.tick(active);
    if (!this.core.interaction.dragging && this.input.capture.owner !== null) this.input.reset();
    this.input.tick(active);
    this.renderer.localizationAvailable = this.session.view().capabilities?.localization.available === true;
    this.renderer.apply(this.session.view().manipulation, supported ? origin : null, this.selected, active, getTime(), this.camera,
      this.session.view().hello?.robot.display_name ?? "Arm");
    this.input.updateCursor();
  }
  dispose(): void { this.suspend(); this.core.dispose(); this.renderer.dispose(); }
}
