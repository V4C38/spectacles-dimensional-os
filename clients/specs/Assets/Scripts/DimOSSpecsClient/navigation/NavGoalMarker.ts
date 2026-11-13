import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { RoundButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton";
import { NAVIGATION_CANCEL_STYLE, navigationCancelReveal } from "DimOSARClient.lspkg/Scripts/DimOSARClient/presentation/WorldPresentation";
import { findChildRecursive } from "../presentation/UIKit";
import { WorldMeshRenderer,strokeMesh2D } from "../presentation/WorldMeshRenderer";
import { yawRotationFromWorldRotation } from "../utilities/SpecsCoordinates";
import { NavigationMarkerRenderer, type NavigationMarkerStyle } from "./SpecsNavigationRenderer";

export type NavGoalMarkerEvents = {
  onDragTriggerStart?: (interactor: { startPoint?: vec3; endPoint?: vec3 } | null) => void;
  onDragTriggerEnd?: () => void;
  onDragTriggerCanceled?: () => void;
  onCancel?: () => void;
};

@component
export class NavGoalMarker extends BaseScriptComponent {
  private root: SceneObject | null = null;
  private headingRoot: SceneObject | null = null;
  private dragObject: SceneObject | null = null;
  private dragInteractable: Interactable | null = null;
  private dragCollider: ColliderComponent | null = null;
  private cancelButton: RoundButton | null = null;
  private cancelObject: SceneObject | null = null;
  private cancelIcon: WorldMeshRenderer | null = null;
  private cancelBaseScale: vec3 | null = null;
  private cancelVisible = false;
  private cancelProgress = 0;
  private cancelConfirmationId = 0;
  private rotation = quat.quatIdentity();
  private events: NavGoalMarkerEvents = {};
  private interactionsBound = false;
  private hovered = false;
  private worldVisuals: NavigationMarkerRenderer | null = null;

  // SpecsNavigationController initializes this after ObjectPrefab.instantiate()
  // returns. Hiding the hierarchy in onAwake interrupts construction of its
  // UIKit/Interactable children on device.
  ensureReady(): void {
    if (this.root) {
      return;
    }
    this.root = this.getSceneObject();
    this.headingRoot = findChildRecursive(this.root, "NavigationHeadingRoot");
    const dragObject = findChildRecursive(this.root, "DragInteractable");
    if (!dragObject) {
      throw new Error("DragInteractable is required");
    }
    this.dragObject = dragObject;
    this.dragCollider = dragObject.getComponent("Physics.ColliderComponent") as ColliderComponent;
    this.dragInteractable = dragObject.getComponent(Interactable.getTypeName()) as Interactable;
    if (!this.dragInteractable) {
      throw new Error("DragInteractable is required");
    }
    const cancelObject = findChildRecursive(this.root, "button_cancel");
    if (!cancelObject) {
      throw new Error("NavigationTargetMarker.button_cancel is required");
    }
    this.cancelObject = cancelObject;
    this.cancelBaseScale = vec3.one();
    this.cancelButton = cancelObject.getComponent(RoundButton.getTypeName()) as RoundButton;
    if (!this.cancelButton) {
      throw new Error("CancelButton is required");
    }
    // Prefab buttons defer SDK initialization to OnStart; resize its live visual and collider together.
    this.cancelButton.initialize();
    this.cancelButton.width = NAVIGATION_CANCEL_STYLE.diameterM * 100;
    const cancelLabelObject = findChildRecursive(cancelObject, "Text_Title");
    if (cancelLabelObject) {
      const label = cancelLabelObject.getComponent("Component.Text") as Text | null;
      if (label) { label.text = ""; label.enabled = false; }
      cancelLabelObject.enabled = false;
    }
    this.cancelIcon = new WorldMeshRenderer(cancelObject, "NavigationCancelCross");
    const half = NAVIGATION_CANCEL_STYLE.glyphLengthM / Math.sqrt(8);
    const geometry = strokeMesh2D([[-half, -half, half, half], [-half, half, half, -half]],
      [1, 1], NAVIGATION_CANCEL_STYLE.glyphWidthM, "xy", 100);
    this.cancelIcon.triangles(geometry.positions, geometry.indices, [1, 1, 1, 1]);
    this.cancelIcon.object.getTransform().setLocalPosition(new vec3(0, 0, 0.6));
    this.cancelIcon.visual.setRenderOrder(this.cancelButton.renderOrder + 1);
    this.setCancelVisible(false);
    this.bindInteractions();
  }

  applyWorldStyle(style: NavigationMarkerStyle, dt: number, viewportHeight: number, radiusCm = 21.44): void {
    this.ensureReady();
    if (!this.worldVisuals) {
      this.worldVisuals = new NavigationMarkerRenderer(this.headingRoot ?? this.root!, radiusCm);
    }
    this.worldVisuals.setRadius(radiusCm);
    if (this.cancelVisible) this.cancelProgress = Math.min(1, this.cancelProgress + Math.max(0, dt) / NAVIGATION_CANCEL_STYLE.revealS);
    this.worldVisuals.apply({ ...style, cancelProgress: this.cancelProgress, hovered: style.hovered ?? this.hovered }, dt, viewportHeight);
    this.applyCancelReveal();
    // Pick the filled disc, not a thin surface below the visible ring. All
    // dimensions are world centimetres, independent of prefab/ancestor scale.
    const shape = this.dragCollider?.shape as CylinderShape | undefined;
    if (shape?.radius && this.dragObject) {
      const bounds = this.worldVisuals.circleBounds();
      const transform = this.dragObject.getTransform();
      const scale = transform.getWorldScale();
      const horizontal = (bounds.radius + 2) / shape.radius;
      if (Math.abs(scale.x - horizontal) > 0.0001 || Math.abs(scale.z - horizontal) > 0.0001)
        transform.setWorldScale(new vec3(horizontal, scale.y, horizontal));
      const length = 4 / Math.max(0.0001, Math.abs(scale.y));
      if (Math.abs(shape.length - length) > 0.0001) shape.length = length;
      const center = new vec3(...bounds.center);
      if (transform.getWorldPosition().distance(center) > 0.0001) transform.setWorldPosition(center);
      if (transform.getWorldRotation().multiplyVec3(vec3.up()).y < 0.99999) transform.setWorldRotation(quat.quatIdentity());
    }
  }

  setHovered(value: boolean): void { this.hovered = value; }

  orientViewer(eye: vec3): void {
    this.worldVisuals?.orientGlyph(eye);
    if (this.cancelObject) {
      const p = this.cancelObject.getTransform().getWorldPosition();
      this.cancelObject.getTransform().setWorldRotation(quat.angleAxis(Math.atan2(eye.x - p.x, eye.z - p.z), vec3.up()));
    }
  }

  ownsDragTarget(object: SceneObject): boolean {
    for (let node: SceneObject | null = object; node; node = node.getParent()) {
      if (node === this.dragObject) return true;
      if (node === this.root) return false;
    }
    return false;
  }

  ownsInteractionTarget(object: SceneObject): boolean {
    if (!this.root?.isEnabledInHierarchy) return false;
    for (let node: SceneObject | null = object; node; node = node.getParent()) {
      if (node === this.root) return true;
    }
    return false;
  }

  circleBounds(): { center: [number, number, number]; radius: number } {
    if (this.worldVisuals) return this.worldVisuals.circleBounds();
    const p = this.worldPosition;
    return { center: [p.x, p.y + 1.5, p.z], radius: 21.44 };
  }

  circleOpacity(): number { return this.worldVisuals?.circleOpacity() ?? 0.35; }

  get worldPosition(): vec3 {
    this.ensureReady();
    return this.root!.getTransform().getWorldPosition();
  }

  setPose(position: vec3, rotation: quat): void {
    this.ensureReady();
    this.root!.getTransform().setWorldPosition(position);
    this.setRotation(rotation);
  }

  setDragEnabled(enabled: boolean): void {
    this.ensureReady();
    this.bindInteractions();
    const drag = this.dragInteractable as Interactable & { enabled: boolean };
    drag.enabled = enabled;
  }

  setCancelVisible(visible: boolean, estopAvailable: boolean = true, confirmationId = 0): void {
    this.ensureReady();
    this.bindInteractions();
    if (visible !== this.cancelVisible || confirmationId !== this.cancelConfirmationId) this.cancelProgress = 0;
    this.cancelConfirmationId = confirmationId;
    this.cancelVisible = visible;
    this.applyCancelReveal();
    if (this.cancelObject) {
      this.cancelObject.enabled = visible;
    }
    const button = this.cancelButton as (RoundButton & { enabled: boolean }) | null;
    if (button) {
      button.enabled = visible;
      button.inactive = !estopAvailable;
    }
    this.cancelIcon?.setColor([1, 1, 1, estopAvailable ? 1 : 0.4]);
  }

  private applyCancelReveal(): void {
    if (!this.cancelObject || !this.cancelBaseScale) return;
    const circleHeight = this.worldVisuals?.circleHeightCm() ?? 1.5;
    const reveal = navigationCancelReveal(this.cancelProgress, circleHeight / 100);
    const transform = this.cancelObject.getTransform();
    transform.setLocalPosition(new vec3(0, reveal.heightM * 100, 0));
    transform.setLocalScale(this.cancelBaseScale.uniformScale(reveal.scale));
  }

  show(): void {
    this.ensureReady();
    this.root!.enabled = true;
  }

  hide(): void {
    this.ensureReady();
    this.setCancelVisible(false);
    this.root!.enabled = false;
  }

  bindEvents(events: NavGoalMarkerEvents): void {
    this.ensureReady();
    this.events = { ...this.events, ...events };
    this.bindInteractions();
  }

  unbindEvents(): void {
    this.events = {};
  }

  destroy(): void {
    this.unbindEvents();
    this.getSceneObject().destroy();
  }

  private setRotation(rotation: quat): void {
    this.rotation = yawRotationFromWorldRotation(rotation);
    this.headingRoot?.getTransform().setLocalRotation(this.rotation);
  }

  private bindInteractions(): void {
    if (this.interactionsBound || !this.dragInteractable || !this.cancelButton) {
      return;
    }
    const drag = this.dragInteractable as Interactable & {
      onTriggerStart?: { add: (fn: (args: { interactor?: { startPoint?: vec3; endPoint?: vec3 } }) => void) => void };
      onTriggerEnd?: { add: (fn: () => void) => void };
      onTriggerCanceled?: { add: (fn: () => void) => void };
    };
    if (!drag.onTriggerStart?.add) {
      return;
    }
    this.interactionsBound = true;
    this.dragInteractable.onHoverEnter?.add(() => { this.hovered = true; });
    this.dragInteractable.onHoverExit?.add(() => { this.hovered = false; });
    drag.onTriggerStart.add((args) => {
      this.events.onDragTriggerStart?.(args?.interactor ?? null);
    });
    drag.onTriggerEnd?.add(() => {
      this.events.onDragTriggerEnd?.();
    });
    drag.onTriggerCanceled?.add(() => {
      this.events.onDragTriggerCanceled?.();
    });
    const cancel = this.cancelButton as RoundButton & {
      onTriggerDown?: { add: (fn: () => void) => void };
    };
    cancel.onTriggerDown?.add(() => {
      this.events.onCancel?.();
    });
  }
}
