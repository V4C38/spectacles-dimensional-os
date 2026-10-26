import { InteractionManager } from "SpectaclesInteractionKit.lspkg/Core/InteractionManager/InteractionManager";
import { InteractorInputType, type Interactor } from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor";

/** Hand targeting only needs navigation commands, not the controller's render/session internals. */
export interface NavigationInputPort {
  ownsMarkerTarget(object: SceneObject): boolean;
  ownsDraft(sourceId: string): boolean;
  setHovered(hovered: boolean): void;
  clearAim(sourceId: string): void;
  cancelSource(sourceId: string): void;
  cancelDrag(): void;
  aim(sourceId: string, from: vec3, direction: vec3): void;
  hold(sourceId: string, from: vec3, direction: vec3, fromMarker: boolean): void;
  release(sourceId: string, from: vec3, direction: vec3): void;
}

type NavigationHand = Pick<Interactor, "inputType" | "startPoint" | "direction" | "isActive" | "currentInteractable" | "isTriggering">;

/** SIK owns targeting. This adapter captures each accepted navigation gesture until release. */
export class SpecsNavigationInput {
  private readonly gestures = new Map<string, { held: boolean; accepted: boolean; fromMarker: boolean }>();
  private readonly cancelledUntilRelease = new Set<string>();
  constructor(private readonly navigation: NavigationInputPort, private readonly robot?: {
    ownsTarget(object: SceneObject): boolean; setHovered(value: boolean): void;
  }, private readonly readInteractors?: () => readonly NavigationHand[]) {}

  tick(navigationEnabled = true, robotEnabled = true): void {
    const manager = InteractionManager.getInstance();
    const mask = InteractorInputType.BothHands | (global.deviceInfoSystem.isEditor() ? InteractorInputType.Mouse : 0);
    const seen = new Set<string>();
    let robotHovered = false;
    let markerHovered = false;
    for (const hand of this.readInteractors?.() ?? manager.getInteractorsByType(mask)) {
      const id = String(hand.inputType); seen.add(id);
      const previous = this.gestures.get(id) ?? { held: false, accepted: false, fromMarker: false };
      const from = hand.startPoint, direction = hand.direction;
      if (!hand.isActive() || !from || !direction) {
        this.navigation.clearAim(id);
        if (previous.held) this.cancelledUntilRelease.add(id);
        if (previous.accepted) this.navigation.cancelSource(id);
        this.gestures.delete(id); continue;
      }
      const target = hand.currentInteractable?.getSceneObject();
      const fromMarker = target ? navigationEnabled && this.navigation.ownsMarkerTarget(target) : false;
      const held = hand.isTriggering;
      if (!held) this.cancelledUntilRelease.delete(id);
      const hoverEligible = !this.cancelledUntilRelease.has(id);
      markerHovered ||= hoverEligible && fromMarker;
      robotHovered ||= Boolean(hoverEligible && target && robotEnabled && !this.navigation.ownsDraft(id) && this.robot?.ownsTarget(target));
      if (!navigationEnabled) {
        this.navigation.clearAim(id);
        if (previous.accepted) this.navigation.cancelSource(id);
        if (held) this.cancelledUntilRelease.add(id);
        this.gestures.delete(id); continue;
      }
      // The owner's moving draft may cross the selected robot's collider.
      // Other targets (including UI and walls) still consume the gesture.
      const ownedRobot = target && this.navigation.ownsDraft(id) && this.robot?.ownsTarget(target);
      const unobstructed = !target || fromMarker || ownedRobot === true;
      let accepted = held && !previous.held ? unobstructed : previous.accepted;
      if (!unobstructed || this.cancelledUntilRelease.has(id)) {
        if (previous.accepted) this.navigation.cancelSource(id);
        this.navigation.clearAim(id);
        if (held) this.cancelledUntilRelease.add(id);
        accepted = false;
      }
      if (unobstructed && !held && !this.cancelledUntilRelease.has(id)) this.navigation.aim(id, from, direction);
      else if (!held && !previous.accepted) this.navigation.clearAim(id);
      if (held && accepted) this.navigation.hold(id, from, direction, previous.held ? previous.fromMarker : fromMarker);
      if (!held && previous.held && previous.accepted) this.navigation.release(id, from, direction);
      this.gestures.set(id, { held, accepted: held && accepted, fromMarker: previous.held ? previous.fromMarker : fromMarker });
    }
    this.robot?.setHovered(robotHovered); this.navigation.setHovered(markerHovered);
    for (const [id, gesture] of this.gestures) if (!seen.has(id)) {
      this.navigation.clearAim(id);
      if (gesture.accepted) this.navigation.cancelSource(id);
      if (gesture.held) this.cancelledUntilRelease.add(id);
      this.gestures.delete(id);
    }
  }

  reset(): void { this.gestures.clear(); this.cancelledUntilRelease.clear(); this.navigation.cancelDrag(); this.navigation.setHovered(false); this.robot?.setHovered(false); }
}
