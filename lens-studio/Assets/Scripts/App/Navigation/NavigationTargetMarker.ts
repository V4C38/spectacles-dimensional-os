import {
  NavigationMarkerApplyOptions,
  NavigationMarkerView,
} from "./NavigationMarkerView";
import type {
  MarkerPresentationKind,
  NavGoalConfig,
  NavigationMarkerPreset,
} from "../../ARBridge/Navigation/NavigationModel";

export type NavigationMarkerEvents = {
  onOutcomeResetComplete?: () => void;
  onDragTriggerStart?: (interactor: any) => void;
  onDragTriggerEnd?: () => void;
  onDragTriggerCanceled?: (interactor: any) => void;
  onConfirmTriggerUp?: () => void;
};

export type { NavigationMarkerApplyOptions };

/** Prefab-root component: marker visuals, pose, and interaction wiring. */
@component
export class NavigationTargetMarker extends BaseScriptComponent {
  private _view: NavigationMarkerView | null = null;
  private _events: NavigationMarkerEvents = {};
  private _interactionsBound = false;

  public onAwake(): void {
    this.ensureReady();
    this._bindInteractions();
  }

  /** Prefab instantiate may run attach/start before onAwake; init view eagerly. */
  public ensureReady(): void {
    if (this._view) {
      return;
    }
    this._view = new NavigationMarkerView(this.getSceneObject());
    this._interactionsBound = false;
  }

  public get worldPosition(): vec3 {
    this.ensureReady();
    return this._view!.worldPosition;
  }

  public get localPosition(): vec3 {
    this.ensureReady();
    return this._view!.localPosition;
  }

  public getRotation(): quat {
    this.ensureReady();
    return this._view!.getRotation();
  }

  public applyPreset(
    config: NavGoalConfig,
    kind: MarkerPresentationKind | "hidden",
    preset: NavigationMarkerPreset,
    opts: NavigationMarkerApplyOptions = {},
  ): void {
    this.ensureReady();
    this._view?.applyPreset(config, kind, preset, opts);
  }

  public showOutcomeReset(
    config: NavGoalConfig,
    label: "Cancelled" | "Failed",
    opts: NavigationMarkerApplyOptions = {},
  ): void {
    this.ensureReady();
    this._view?.showOutcomeReset(config, label, opts, this._events.onOutcomeResetComplete);
  }

  public hide(): void {
    this._view?.hide();
  }

  public hideAndThen(callback: () => void): void {
    this._view?.hideAndThen(callback);
  }

  public setPose(position: vec3, rotation: quat): void {
    this.ensureReady();
    this._view?.setPose(position, rotation);
  }

  public interpolatePose(
    position: vec3,
    rotation: quat,
    lerpSpeed: number,
    rotationLerpSpeed?: number,
  ): void {
    this._view?.interpolatePose(position, rotation, lerpSpeed, rotationLerpSpeed);
  }

  public setDragEnabled(enabled: boolean): void {
    this.ensureReady();
    this._bindInteractions();
    const dragInteractable = this._view?.dragInteractable as any;
    if (!dragInteractable) {
      return;
    }
    dragInteractable.enabled = enabled;
  }

  public setCancelActionAvailability(available: boolean): void {
    this._view?.setCancelActionAvailability(available);
  }

  public bindPlacementAnchor(anchor: SceneObject, initialWorldPosition: vec3): void {
    this.ensureReady();
    this._view?.bindPlacementAnchor(anchor, initialWorldPosition);
  }

  public releasePlacementAnchor(): void {
    this._view?.releasePlacementAnchor();
  }

  public rebasePlacementAnchor(): void {
    this._view?.rebasePlacementAnchor();
  }

  public bindEvents(events: Partial<NavigationMarkerEvents>): void {
    this.ensureReady();
    this._events = { ...this._events, ...events };
    this._bindInteractions();
  }

  public unbindEvents(): void {
    this._events = {};
  }

  public destroy(): void {
    this._view?.teardownImmediate();
    this._view = null;
    this._events = {};
    this._interactionsBound = false;
    this.getSceneObject().destroy();
  }

  private _bindInteractions(): void {
    if (this._interactionsBound || !this._view) {
      return;
    }

    const dragInteractable = this._view.dragInteractable as any;
    if (!dragInteractable?.onTriggerStart?.add) {
      return;
    }

    this._interactionsBound = true;
    dragInteractable.onTriggerStart.add((args: any) => {
      this._events.onDragTriggerStart?.(args?.interactor ?? null);
    });
    if (dragInteractable.onTriggerEnd?.add) {
      dragInteractable.onTriggerEnd.add(() => {
        this._events.onDragTriggerEnd?.();
      });
    }
    if (dragInteractable.onTriggerCanceled?.add) {
      dragInteractable.onTriggerCanceled.add((args: any) => {
        args?.interactor?.clearCurrentInteractable?.();
        this._events.onDragTriggerCanceled?.(args?.interactor ?? null);
      });
    }

    const confirmButton = this._view.confirmActionButton as any;
    if (confirmButton?.onTriggerUp?.add) {
      confirmButton.onTriggerUp.add(() => {
        this._events.onConfirmTriggerUp?.();
      });
    }
  }
}
