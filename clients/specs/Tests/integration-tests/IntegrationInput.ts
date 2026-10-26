import { InteractionManager } from "SpectaclesInteractionKit.lspkg/Core/InteractionManager/InteractionManager";
import { InteractorInputType, InteractorTriggerType, TargetingMode, type Interactor } from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor";
import { Interactable, type InteractableEventArgs } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
/** Test-only pose source around the real registered Mouse. SIK still handles events/manipulation. */
export class IntegrationInput {
  readonly actor: Interactor;
  active = true;
  held = false;
  target: Interactable | null = null;
  from = vec3.zero();
  direction = new vec3(0, -0.2, -1).normalize();
  point = new vec3(0, -20, -100);
  delta = vec3.zero();
  private previousHeld = false;
  private restored = false;
  private descriptors: [
    string,
    PropertyDescriptor | undefined
  ][] = [];
  private readonly isActive: () => boolean;
  private readonly isTargeting: () => boolean;
  constructor() {
    this.actor = InteractionManager.getInstance().getInteractorsByType(InteractorInputType.Mouse)[0];
    if (!this.actor)
      throw new Error("Native integration requires the registered editor Mouse interactor");
    this.isActive = this.actor.isActive;
    this.isTargeting = this.actor.isTargeting;
    const fields: Record<string, () => unknown> = {
      startPoint: () => this.from, endPoint: () => this.point, direction: () => this.direction,
      planecastPoint: () => this.point, targetHitPosition: () => this.point,
      orientation: () => quat.quatIdentity(), distanceToTarget: () => this.point.distance(this.from),
      currentInteractable: () => this.target, previousInteractable: () => this.target,
      isTriggering: () => this.held, wasTriggering: () => this.previousHeld,
      currentTrigger: () => this.held ? InteractorTriggerType.Pinch : InteractorTriggerType.None,
      previousTrigger: () => this.previousHeld ? InteractorTriggerType.Pinch : InteractorTriggerType.None,
      currentDragVector: () => this.delta, planecastDragVector: () => this.delta,
      deltaStartPosition: () => this.delta, activeTargetingMode: () => TargetingMode.Indirect,
      isHoveringCurrentInteractable: () => this.target !== null,
      targetHitInfo: () => this.target ? { interactable: this.target, hitPosition: this.point,
        localHitPosition: this.target.getSceneObject().getTransform().getInvertedWorldTransform().multiplyPoint(this.point),
        normal: vec3.forward(), distance: this.point.distance(this.from) } : null,
    };
    for (const key of Object.keys(fields)) {
      this.descriptors.push([key, Object.getOwnPropertyDescriptor(this.actor, key)]);
      Object.defineProperty(this.actor, key, { configurable: true, get: fields[key], set: () => { } });
    }
    this.actor.isActive = () => this.active;
    this.actor.isTargeting = () => this.active;
  }
  ray(from: vec3, point: vec3, target: Interactable | null = null): void {
    this.delta = from.sub(this.from);
    this.from = from;
    this.point = point;
    this.direction = point.sub(from).normalize();
    this.target = target;
  }
  private args(target: Interactable): InteractableEventArgs {
    return { interactor: this.actor, target, propagationPhase: "Target", connectionId: null,
      endedInsideInteractable: true, stopPropagation: () => { } };
  }
  hover(target: Interactable): void { this.target = target; target.hoverEnter(this.args(target)); target.hoverUpdate(this.args(target)); }
  unhover(): void { if (this.target)
    this.target.hoverExit(this.args(this.target)); this.target = null; }
  start(target: Interactable | null = this.target): void {
    this.previousHeld = this.held;
    this.held = true;
    this.target = target;
    target?.triggerStart(this.args(target));
  }
  update(): void { if (this.held && this.target)
    this.target.triggerUpdate(this.args(this.target)); this.previousHeld = this.held; }
  end(): void {
    const target = this.target;
    this.previousHeld = this.held;
    this.held = false;
    target?.triggerEnd(this.args(target));
  }
  press(button: {
    interactable: Interactable;
    inactive?: boolean;
  }): void { if (button.inactive || button.interactable.enabled === false)
    return; this.hover(button.interactable); this.start(); this.end(); this.unhover(); }
  cancel(): void {
    const target = this.target;
    this.held = false;
    target?.triggerCanceled(this.args(target));
    this.unhover();
    this.previousHeld = false;
  }
  restore(): void {
    if (this.restored)
      return;
    this.restored = true;
    try {
      this.cancel();
    }
    catch { /* Scene teardown can retire a native target first. */ }
    for (const [key, descriptor] of this.descriptors) {
      if (descriptor)
        Object.defineProperty(this.actor, key, descriptor);
      else
        delete (this.actor as any)[key];
    }
    this.actor.isActive = this.isActive;
    this.actor.isTargeting = this.isTargeting;
  }
}
