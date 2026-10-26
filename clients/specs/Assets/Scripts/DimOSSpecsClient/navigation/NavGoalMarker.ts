import { NAVIGATION_CANCEL_STYLE, navigationCancelReveal } from "../../DimOSARClient/presentation/WorldVisualStyle";
import { NavigationMarkerRenderer, type NavigationMarkerStyle } from "./NavigationMarkerRenderer";
import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { RoundButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton";

const CIRCLE_INACTIVE_MATERIAL = requireAsset("../../../Materials/Circle_Inactive.mat") as Material;
const CIRCLE_ACTIVE_MATERIAL = requireAsset("../../../Materials/Circle_Active.mat") as Material;

type ArrowPass = Pass & {
  Opacity_Override?: number;
  AnimatedArrow?: boolean;
  ArrowSpeed?: number;
};

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
  private hintAnchor: SceneObject | null = null;
  private dragObject: SceneObject | null = null;
  private dragInteractable: Interactable | null = null;
  private dragCollider: ColliderComponent | null = null;
  private circleVisual: RenderMeshVisual | null = null;
  private arrowMaterial: Material | null = null;
  private dotsMaterial: Material | null = null;
  private cancelButton: RoundButton | null = null;
  private cancelObject: SceneObject | null = null;
  private cancelLabel: Text | null = null;
  private cancelBaseScale: vec3 | null = null;
  private cancelVisible = false;
  private cancelProgress = 0;
  private cancelConfirmationId = 0;
  private rotation = quat.quatIdentity();
  private events: NavGoalMarkerEvents = {};
  private interactionsBound = false;
  private hovered = false;
  private worldVisuals: NavigationMarkerRenderer | null = null;

  // NavigationController initializes this after ObjectPrefab.instantiate()
  // returns. Hiding the hierarchy in onAwake interrupts construction of its
  // UIKit/Interactable children on device.
  ensureReady(): void {
    if (this.root) {
      return;
    }
    this.root = this.getSceneObject();
    this.headingRoot = findChild(this.root, "NavigationHeadingRoot");
    const dragObject = findChild(this.root, "DragInteractable");
    if (!dragObject) {
      throw new Error("DragInteractable is required");
    }
    this.dragObject = dragObject;
    this.dragCollider = dragObject.getComponent("Physics.ColliderComponent") as ColliderComponent;
    this.dragInteractable = dragObject.getComponent(Interactable.getTypeName()) as Interactable;
    if (!this.dragInteractable) {
      throw new Error("DragInteractable is required");
    }
    this.hintAnchor = findChild(dragObject, "HintAnchor");
    const cancelObject = findChild(this.root, "button_cancel");
    if (!cancelObject) {
      throw new Error("NavigationTargetMarker.button_cancel is required");
    }
    this.cancelObject = cancelObject;
    this.cancelBaseScale = cancelObject.getTransform().getLocalScale();
    this.cancelButton = cancelObject.getComponent(RoundButton.getTypeName()) as RoundButton;
    if (!this.cancelButton) {
      throw new Error("CancelButton is required");
    }
    const cancelLabelObject = findChild(cancelObject, "Text_Title");
    this.cancelLabel = cancelLabelObject
      ? (cancelLabelObject.getComponent("Component.Text") as Text)
      : null;
    this.bindLookObjects();
    this.setCancelVisible(false);
    this.bindInteractions();
  }

  applyWorldStyle(style: NavigationMarkerStyle, dt: number, viewportHeight: number, radiusCm = 21.44): void {
    this.ensureReady();
    if (!this.worldVisuals) {
      this.worldVisuals = new NavigationMarkerRenderer(this.headingRoot ?? this.root!, radiusCm);
      for (const name of ["Visual", "MoveDirectionArrow", "Dots"]) {
        const visual = findChild(this.root!, name)?.getComponent("Component.RenderMeshVisual") as RenderMeshVisual | null;
        if (visual) visual.enabled = false;
      }
    }
    this.worldVisuals.setRadius(radiusCm);
    if (this.cancelVisible) this.cancelProgress = Math.min(1, this.cancelProgress + Math.max(0, dt) / NAVIGATION_CANCEL_STYLE.revealS);
    this.worldVisuals.apply({ ...style, cancelProgress: this.cancelProgress, hovered: style.hovered ?? this.hovered }, dt, viewportHeight);
    this.applyCancelReveal();
    // Keep the native hit cylinder aligned with the rendered ring, including selected scaling.
    const radius = (this.dragCollider?.shape as CylinderShape | undefined)?.radius;
    if (radius && this.dragObject) {
      const transform = this.dragObject.getTransform(), scale = transform.getWorldScale();
      const horizontal = this.worldVisuals.circleBounds().radius / radius;
      if (Math.abs(scale.x - horizontal) > 0.0001 || Math.abs(scale.z - horizontal) > 0.0001)
        transform.setWorldScale(new vec3(horizontal, scale.y, horizontal));
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

  getRotation(): quat {
    this.ensureReady();
    return this.rotation;
  }

  setPose(position: vec3, rotation: quat): void {
    this.ensureReady();
    this.root!.getTransform().setWorldPosition(position);
    this.setRotation(rotation);
  }

  interpolatePose(position: vec3, rotation: quat, lerpSpeed: number): void {
    this.ensureReady();
    const transform = this.root!.getTransform();
    const alpha = 1 - Math.exp(-lerpSpeed * getDeltaTime());
    transform.setWorldPosition(vec3.lerp(transform.getWorldPosition(), position, alpha));
    this.setRotation(quat.slerp(this.rotation, rotation, alpha));
  }

  setDragProbeWorldPosition(position: vec3): void {
    this.ensureReady();
    this.hintAnchor?.getTransform().setWorldPosition(position);
  }

  setDragEnabled(enabled: boolean): void {
    this.ensureReady();
    this.bindInteractions();
    const drag = this.dragInteractable as Interactable & { enabled: boolean };
    drag.enabled = enabled;
  }

  setGoalActive(active: boolean): void {
    this.ensureReady();
    if (this.circleVisual) {
      const next = active ? CIRCLE_ACTIVE_MATERIAL : CIRCLE_INACTIVE_MATERIAL;
      if (this.circleVisual.mainMaterial !== next) {
        this.circleVisual.mainMaterial = next;
      }
    }
    const arrowPass = this.arrowPass();
    if (arrowPass) {
      arrowPass.Opacity_Override = active ? 0.6 : 0.2;
    }
    const dotsPass = this.dotsMaterial?.mainPass as (Pass & { Opacity_Override?: number }) | undefined;
    if (dotsPass) {
      dotsPass.Opacity_Override = active ? 0.75 : 0.4;
    }
  }

  setArrowAnimating(animating: boolean): void {
    this.ensureReady();
    const arrowPass = this.arrowPass();
    if (!arrowPass) {
      return;
    }
    arrowPass.AnimatedArrow = animating;
    arrowPass.ArrowSpeed = animating ? 1.0 : 0;
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
    if (this.cancelLabel) {
      this.cancelLabel.text = estopAvailable ? "Cancel" : "Cancel\nUnavailable";
    }
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

  private bindLookObjects(): void {
    if (!CIRCLE_INACTIVE_MATERIAL || !CIRCLE_ACTIVE_MATERIAL) {
      throw new Error("Circle materials are required");
    }
    const visual = findChild(this.root!, "Visual");
    const arrow = findChild(this.root!, "MoveDirectionArrow");
    const dots = findChild(this.root!, "Dots");
    if (!visual) {
      throw new Error("Visual is required");
    }
    if (!arrow) {
      throw new Error("MoveDirectionArrow is required");
    }
    if (!dots) {
      throw new Error("Dots is required");
    }
    this.circleVisual = visual.getComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    if (!this.circleVisual) {
      throw new Error("Visual is required");
    }
    const arrowVisual = arrow.getComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    const dotsVisual = dots.getComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    if (!arrowVisual) {
      throw new Error("MoveDirectionArrow is required");
    }
    if (!dotsVisual) {
      throw new Error("Dots is required");
    }
    this.arrowMaterial = arrowVisual.mainMaterial;
    this.dotsMaterial = dotsVisual.mainMaterial;
  }

  private arrowPass(): ArrowPass | null {
    return (this.arrowMaterial?.mainPass as ArrowPass | undefined) ?? null;
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

function findChild(parent: SceneObject, name: string): SceneObject | null {
  const count = parent.getChildrenCount();
  for (let i = 0; i < count; i++) {
    const child = parent.getChild(i);
    if (child.name === name) {
      return child;
    }
    const nested = findChild(child, name);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function yawRotationFromPlanarDirection(x: number, z: number): quat {
  const yaw = Math.atan2(-z, x);
  const halfYaw = yaw * 0.5;
  return new quat(Math.cos(halfYaw), 0, Math.sin(halfYaw), 0);
}

function yawRotationFromWorldRotation(rotation: quat): quat {
  const forward = rotation.multiplyVec3(new vec3(1, 0, 0));
  const planarLength = Math.sqrt(forward.x * forward.x + forward.z * forward.z);
  if (planarLength <= 1e-6) {
    return quat.quatIdentity();
  }
  return yawRotationFromPlanarDirection(forward.x, forward.z);
}
