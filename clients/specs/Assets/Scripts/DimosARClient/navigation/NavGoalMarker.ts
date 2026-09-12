import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { RoundButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton";
import animate from "SpectaclesInteractionKit.lspkg/Utils/animate";

const CIRCLE_WHITE_MATERIAL = requireAsset("../../../Materials/Circle_White.mat") as Material;
const CIRCLE_YELLOW_MATERIAL = requireAsset("../../../Materials/Circle_Yellow.mat") as Material;

const MARKER_VISIBILITY_DURATION_SECONDS = 0.18;
const FLASH_CIRCLE_COLLAPSE_DURATION_SECONDS = MARKER_VISIBILITY_DURATION_SECONDS / 0.5;
const FLASH_TEXT_COLLAPSE_DELAY_SECONDS = 1.5;

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
  private circleVisual: RenderMeshVisual | null = null;
  private arrowMaterial: Material | null = null;
  private dotsMaterial: Material | null = null;
  private dragBaseScale = vec3.one();
  private headingBaseScale: vec3 | null = null;
  private stateTextBaseScale: vec3 | null = null;
  private cancelButton: RoundButton | null = null;
  private cancelObject: SceneObject | null = null;
  private cancelLabel: Text | null = null;
  private vfxActive: SceneObject | null = null;
  private vfxInactive: SceneObject | null = null;
  private stateText: Text | null = null;
  private stateTextObject: SceneObject | null = null;
  private flashPlaying = false;
  private flashVersion = 0;
  private flashDone: (() => void) | null = null;
  private rotation = quat.quatIdentity();
  private events: NavGoalMarkerEvents = {};
  private interactionsBound = false;

  onAwake(): void {
    this.ensureReady();
    this.hide();
  }

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
    this.dragBaseScale = dragObject.getTransform().getLocalScale();
    this.headingBaseScale = this.headingRoot?.getTransform().getLocalScale() ?? null;
    this.dragInteractable = dragObject.getComponent(Interactable.getTypeName()) as Interactable;
    if (!this.dragInteractable) {
      throw new Error("DragInteractable is required");
    }
    this.hintAnchor = findChild(dragObject, "HintAnchor");
    const cancelObject = findChild(this.root, "CancelButton");
    if (!cancelObject) {
      throw new Error("CancelButton is required");
    }
    this.cancelObject = cancelObject;
    this.cancelButton = cancelObject.getComponent(RoundButton.getTypeName()) as RoundButton;
    if (!this.cancelButton) {
      throw new Error("CancelButton is required");
    }
    this.vfxActive = findChild(cancelObject, "ButtonVFX_Active");
    this.vfxInactive = findChild(cancelObject, "ButtonVFX_Inactive");
    if (!this.vfxActive) {
      throw new Error("ButtonVFX_Active is required");
    }
    if (!this.vfxInactive) {
      throw new Error("ButtonVFX_Inactive is required");
    }
    const cancelLabelObject = findChild(cancelObject, "Text_Title");
    this.cancelLabel = cancelLabelObject
      ? (cancelLabelObject.getComponent("Component.Text") as Text)
      : null;
    const stateTextObject = findChild(this.root, "State_Text");
    this.stateTextObject = stateTextObject;
    this.stateText = stateTextObject
      ? (stateTextObject.getComponent("Component.Text") as Text)
      : null;
    this.stateTextBaseScale = stateTextObject?.getTransform().getLocalScale() ?? null;
    this.bindLookObjects();
    this.setStateText("", false);
    this.setCancelVisible(false);
    this.bindInteractions();
  }

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
      const next = active ? CIRCLE_YELLOW_MATERIAL : CIRCLE_WHITE_MATERIAL;
      if (this.circleVisual.mainMaterial !== next) {
        this.circleVisual.mainMaterial = next;
      }
    }
    const arrowPass = this.arrowMaterial?.mainPass as (Pass & {
      Opacity_Override?: number;
      ArrowSpeed?: number;
    }) | undefined;
    if (arrowPass) {
      arrowPass.Opacity_Override = active ? 0.6 : 0.2;
      arrowPass.ArrowSpeed = active ? 1.0 : 0;
    }
    const dotsPass = this.dotsMaterial?.mainPass as (Pass & { Opacity_Override?: number }) | undefined;
    if (dotsPass) {
      dotsPass.Opacity_Override = active ? 0.75 : 0.4;
    }
  }

  setCancelVisible(visible: boolean, estopAvailable: boolean = true): void {
    this.ensureReady();
    this.bindInteractions();
    if (this.cancelObject) {
      this.cancelObject.enabled = visible;
    }
    const button = this.cancelButton as (RoundButton & { enabled: boolean }) | null;
    if (button) {
      button.enabled = visible;
    }
    if (this.cancelLabel) {
      this.cancelLabel.text = estopAvailable ? "Cancel" : "Cancel\nUnavailable";
    }
    this.setCancelVfx(visible && estopAvailable, visible && !estopAvailable);
  }

  showFlash(flash: "cancelled" | "failed", onDone: () => void): void {
    this.ensureReady();
    if (this.flashPlaying) {
      return;
    }
    this.flashPlaying = true;
    this.flashDone = onDone;
    this.setCancelVisible(false);
    if (this.cancelObject) {
      this.cancelObject.enabled = true;
    }
    const button = this.cancelButton as (RoundButton & { enabled: boolean }) | null;
    if (button) {
      button.enabled = false;
    }
    this.setCancelVfx(false, true);
    this.setStateText(flash === "cancelled" ? "Navigation\nCancelled" : "Navigation\nFailed", true);
    const version = this.nextFlashVersion();
    if (this.dragObject) {
      this.animateLocalScale(this.dragObject, vec3.zero(), FLASH_CIRCLE_COLLAPSE_DURATION_SECONDS, version);
    }
    if (this.headingRoot) {
      this.animateLocalScale(this.headingRoot, vec3.zero(), FLASH_CIRCLE_COLLAPSE_DURATION_SECONDS, version);
    }
    if (!this.stateText || !this.stateTextObject) {
      this.finishFlash(version);
      return;
    }
    const stateTextTransform = this.stateTextObject.getTransform();
    const stateTextStart = stateTextTransform.getLocalScale();
    const totalDuration = FLASH_TEXT_COLLAPSE_DELAY_SECONDS + MARKER_VISIBILITY_DURATION_SECONDS;
    animate({
      duration: totalDuration,
      easing: "linear",
      update: (t: number) => {
        if (this.flashVersion !== version) {
          return;
        }
        const elapsed = t * totalDuration;
        if (elapsed < FLASH_TEXT_COLLAPSE_DELAY_SECONDS) {
          stateTextTransform.setLocalScale(stateTextStart);
          return;
        }
        const collapseT = Math.min(
          1,
          (elapsed - FLASH_TEXT_COLLAPSE_DELAY_SECONDS) / MARKER_VISIBILITY_DURATION_SECONDS,
        );
        stateTextTransform.setLocalScale(vec3.lerp(stateTextStart, vec3.zero(), collapseT));
      },
      ended: () => {
        if (this.flashVersion !== version) {
          return;
        }
        stateTextTransform.setLocalScale(vec3.zero());
        this.finishFlash(version);
      },
    });
  }

  show(): void {
    this.ensureReady();
    this.clearFlash();
    this.root!.enabled = true;
  }

  hide(): void {
    this.ensureReady();
    this.clearFlash();
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
    if (!CIRCLE_WHITE_MATERIAL || !CIRCLE_YELLOW_MATERIAL) {
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

  private nextFlashVersion(): number {
    this.flashVersion += 1;
    return this.flashVersion;
  }

  private animateLocalScale(
    object: SceneObject,
    target: vec3,
    duration: number,
    version: number,
  ): void {
    const transform = object.getTransform();
    const start = transform.getLocalScale();
    animate({
      duration,
      easing: "ease-in-out-quad",
      update: (t: number) => {
        if (this.flashVersion !== version) {
          return;
        }
        transform.setLocalScale(vec3.lerp(start, target, t));
      },
      ended: () => {
        if (this.flashVersion !== version) {
          return;
        }
        transform.setLocalScale(target);
      },
    });
  }

  private finishFlash(version: number): void {
    if (this.flashVersion !== version) {
      return;
    }
    this.restoreFlashScales();
    this.clearFlash();
    this.flashPlaying = false;
    const done = this.flashDone;
    this.flashDone = null;
    done?.();
  }

  private restoreFlashScales(): void {
    this.dragObject?.getTransform().setLocalScale(this.dragBaseScale);
    if (this.headingRoot && this.headingBaseScale) {
      this.headingRoot.getTransform().setLocalScale(this.headingBaseScale);
    }
    if (this.stateTextObject && this.stateTextBaseScale) {
      this.stateTextObject.getTransform().setLocalScale(this.stateTextBaseScale);
    }
  }

  private clearFlash(): void {
    this.nextFlashVersion();
    this.flashPlaying = false;
    this.flashDone = null;
    this.restoreFlashScales();
    this.setStateText("", false);
    this.setCancelVfx(false, false);
  }

  private setCancelVfx(active: boolean, inactive: boolean): void {
    if (this.vfxActive) {
      this.vfxActive.enabled = active;
    }
    if (this.vfxInactive) {
      this.vfxInactive.enabled = inactive;
    }
  }

  private setStateText(text: string, visible: boolean): void {
    if (this.stateText) {
      this.stateText.text = text;
    }
    if (this.stateTextObject) {
      this.stateTextObject.enabled = visible;
    }
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
      onTriggerUp?: { add: (fn: () => void) => void };
    };
    cancel.onTriggerUp?.add(() => {
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
