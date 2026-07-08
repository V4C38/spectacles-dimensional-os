import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { RoundButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton";
import animate from "SpectaclesInteractionKit.lspkg/Utils/animate";
import {
  animateLocalScale,
  exponentialSmoothAlpha,
  isLatestAnimationVersion,
  lerpVec3,
  nextAnimationVersion,
} from "../Utilities/AnimationUtilities";
import {
  applyCapabilityButtonPresentation,
  findChildRecursive,
  findText,
  requireChild,
  requireFirstText,
  SnapOS2Styles,
} from "../UI/UIKit";
import { yawRotationFromWorldRotation } from "../Utilities/Utilities";
import type { NavMarkerViewState } from "../../ARBridge/Navigation/NavigationModel";

const MARKER_VISIBILITY_DURATION_SECONDS = 0.18;
const OUTCOME_CIRCLE_COLLAPSE_DURATION_SECONDS =
  MARKER_VISIBILITY_DURATION_SECONDS / 0.5;
const OUTCOME_DOTS_TEXT_COLLAPSE_DELAY_SECONDS = 1.5;
const VISIBILITY_ANIMATION_VERSION_KEY = "__navMarkerVisibilityVersion";
const CIRCLE_SCALE_ANIMATION_VERSION_KEY = "__navMarkerCircleScaleVersion";
const OUTCOME_RESET_ANIMATION_VERSION_KEY = "__navMarkerOutcomeResetVersion";

function outcomeStateText(label: "Cancelled" | "Failed"): string {
  return label === "Cancelled"
    ? "Navigation\nCancelled"
    : "Navigation\nFailed";
}

function applyDotsMaterialMode(
  dots: SceneObject | null,
  idle: boolean,
): void {
  if (!dots) {
    return;
  }
  const visual = dots.getComponent(
    "Component.RenderMeshVisual",
  ) as RenderMeshVisual | null;
  if (!visual?.mainMaterial?.mainPass) {
    return;
  }
  const pass = visual.mainMaterial.mainPass as any;
  const DOTS_WHITE = new vec4(1, 1, 1, 0.457359);
  const DOTS_YELLOW = new vec4(0.976471, 0.929412, 0.423529, 0.500008);
  if ("WhiteColor" in pass) {
    pass.WhiteColor = DOTS_WHITE;
  }
  if ("YellowColor" in pass) {
    pass.YellowColor = idle ? DOTS_WHITE : DOTS_YELLOW;
  }
  if ("AnimationSwitch" in pass) {
    pass.AnimationSwitch = !idle;
  } else if ("animationSwitch" in pass) {
    pass.animationSwitch = !idle;
  }
}

export type MarkerMaterialAssets = {
  circleWhite: Material;
  circleYellow: Material;
};

export class MarkerViewCore {
  private readonly root: SceneObject;
  private readonly headingRoot: SceneObject | null;
  private readonly dragInteractableObject: SceneObject;
  private readonly circleVisual: RenderMeshVisual | null;
  private readonly circleWhiteMaterial: Material;
  private readonly circleYellowMaterial: Material;
  private readonly confirmButtonObject: SceneObject;
  private readonly confirmButton: RoundButton;
  private readonly confirmVfx: SceneObject | null;
  private readonly cancelVfx: SceneObject | null;
  private readonly confirmLabel: Text;
  private readonly stateText: Text | null;
  private readonly dots: SceneObject | null;
  private readonly dragInteractableBaseScale: vec3;
  private readonly rootBaseScale: vec3;
  private readonly headingBaseScale: vec3 | null;
  private readonly dotsBaseScale: vec3 | null;
  private readonly stateTextBaseScale: vec3 | null;

  private _visible = false;
  private _outcomeActive = false;
  private _confirmEnabled = false;
  private _placementAnchor: SceneObject | null = null;
  private _preAnchorParent: SceneObject | null = null;
  private _cancelActionAvailable = true;
  private _rotation = quat.quatIdentity();
  private _outcomeResetCompleteCallback: (() => void) | null = null;

  constructor(root: SceneObject, materials: MarkerMaterialAssets) {
    this.root = root;
    this.headingRoot = findChildRecursive(this.root, "NavigationHeadingRoot");
    this.dragInteractableObject = requireChild(this.root, "DragInteractable", "MarkerViewCore");
    const visualObject = findChildRecursive(this.dragInteractableObject, "Visual");
    this.circleVisual = visualObject
      ? (visualObject.getComponent("Component.RenderMeshVisual") as RenderMeshVisual | null)
      : null;
    this.circleWhiteMaterial = materials.circleWhite;
    this.circleYellowMaterial = materials.circleYellow;
    this.confirmButtonObject = requireChild(this.root, "ConfirmButton", "MarkerViewCore");
    this.confirmButton = this.confirmButtonObject.getComponent(
      RoundButton.getTypeName(),
    ) as RoundButton;
    this.confirmVfx = findChildRecursive(this.confirmButtonObject, "ButtonVFX_Confirm");
    this.cancelVfx = findChildRecursive(this.confirmButtonObject, "ButtonVFX_Cancel");
    this.confirmLabel = requireFirstText(this.confirmButtonObject, "MarkerViewCore");
    this.stateText = findText(this.root, "State_Text");
    this.dots = findChildRecursive(this.root, "Dots");
    this.dragInteractableBaseScale =
      this.dragInteractableObject.getTransform().getLocalScale();
    this.rootBaseScale = this.root.getTransform().getLocalScale();
    this.headingBaseScale = this.headingRoot?.getTransform().getLocalScale() ?? null;
    this.dotsBaseScale = this.dots?.getTransform().getLocalScale() ?? null;
    this.stateTextBaseScale =
      this.stateText?.getSceneObject().getTransform().getLocalScale() ?? null;
    if (!this.confirmButton) {
      throw new Error(
        "MarkerViewCore: NavigationTargetMarker is missing ConfirmButton RoundButton",
      );
    }
    this._initializeHidden();
    this.setRotation(this._rotation);
  }

  public get confirmActionButton(): RoundButton {
    return this.confirmButton;
  }

  /** Drag collider lives on DragInteractable — keep it enabled while visible. */
  public get dragInteractable(): Interactable | null {
    return this.dragInteractableObject.getComponent(
      Interactable.getTypeName(),
    ) as Interactable | null;
  }

  public get rootSceneObject(): SceneObject {
    return this.root;
  }

  public get worldPosition(): vec3 {
    return this.root.getTransform().getWorldPosition();
  }

  public get localPosition(): vec3 {
    return this.root.getTransform().getLocalPosition();
  }

  public getRotation(): quat {
    return this._rotation;
  }

  public setRotation(rotation: quat): void {
    this._rotation = yawRotationFromWorldRotation(rotation);
    this._applyHeadingRootRotation();
  }

  public apply(
    view: NavMarkerViewState,
    onOutcomeComplete?: () => void,
  ): void {
    if (view.outcomeLabel) {
      this._outcomeResetCompleteCallback = onOutcomeComplete ?? null;
      this._applyOutcomeView(view);
      return;
    }

    const leavingOutcome = this._outcomeActive;
    this._outcomeActive = false;
    const becameVisible = view.visible && !this._visible;
    this._visible = view.visible;

    if (!view.visible) {
      this._beginHide();
      this._animateRootVisibility(false);
      return;
    }

    if (!this._isVisuallyCollapsed() || leavingOutcome) {
      this._restoreStandardVisualState();
    }
    this.dragInteractableObject.enabled = true;
    this._applyCircleMaterial(view.circleIdle);
    applyDotsMaterialMode(this.dots, view.circleIdle);
    this._setDotsVisible(!view.circleIdle);
    this._setStateText("", false);
    this.setRotation(view.heading);

    const button = view.button;
    this.setConfirmVisible(button !== null);
    if (button?.role === "cancel") {
      applyCapabilityButtonPresentation(this.confirmButton, this.confirmLabel, {
        available: button.label === "Cancel",
        availableLabel: "Cancel",
        unavailableLabel: "Cancel\nUnavailable",
        availableStyle: SnapOS2Styles.Special,
        unavailableStyle: SnapOS2Styles.Special,
      });
      this._setConfirmInteractable(true);
    }
    this._setConfirmVfxState(false, button === null);

    if (becameVisible) {
      this._animateRootVisibility(true);
    } else {
      this.root.enabled = true;
      this.root.getTransform().setLocalScale(this.rootBaseScale);
    }
  }

  public bindPlacementAnchor(
    anchor: SceneObject,
    initialWorldPosition: vec3,
  ): void {
    if (this._placementAnchor !== anchor) {
      this._preAnchorParent = this.root.getParent();
      this.root.setParent(anchor);
      this._placementAnchor = anchor;
    }
    anchor.getTransform().setWorldPosition(initialWorldPosition);
    anchor.getTransform().setWorldRotation(quat.quatIdentity());
    this.root.getTransform().setLocalPosition(vec3.zero());
  }

  public releasePlacementAnchor(): void {
    if (!this._placementAnchor) {
      return;
    }
    const worldPosition = this.root.getTransform().getWorldPosition();
    const worldRotation = this.root.getTransform().getWorldRotation();
    const parent = this._preAnchorParent ?? this._placementAnchor.getParent();
    if (parent) {
      this.root.setParent(parent);
    }
    this.root.getTransform().setWorldPosition(worldPosition);
    this.root.getTransform().setWorldRotation(worldRotation);
    this._placementAnchor = null;
    this._preAnchorParent = null;
  }

  public rebasePlacementAnchor(): void {
    if (!this._placementAnchor) {
      return;
    }
    const worldPosition = this.root.getTransform().getWorldPosition();
    this._placementAnchor.getTransform().setWorldPosition(worldPosition);
    this.root.getTransform().setLocalPosition(vec3.zero());
  }

  public setPose(position: vec3, rotation: quat): void {
    const transform = this.root.getTransform();
    if (this._placementAnchor) {
      transform.setLocalPosition(this._worldToAnchorLocal(position));
    } else {
      transform.setWorldPosition(position);
    }
    this.setRotation(rotation);
  }

  public interpolatePose(
    desiredPosition: vec3,
    desiredRotation: quat,
    lerpSpeed: number,
    rotationLerpSpeed: number = lerpSpeed,
    exactRotation: boolean = false,
  ): void {
    const transform = this.root.getTransform();
    const dt = getDeltaTime();
    const alpha = exponentialSmoothAlpha(dt, lerpSpeed);
    const rotationAlpha = exponentialSmoothAlpha(dt, rotationLerpSpeed);
    if (this._placementAnchor) {
      const desiredLocal = this._worldToAnchorLocal(desiredPosition);
      transform.setLocalPosition(
        vec3.lerp(transform.getLocalPosition(), desiredLocal, alpha),
      );
    } else {
      transform.setWorldPosition(
        vec3.lerp(transform.getWorldPosition(), desiredPosition, alpha),
      );
    }
    if (exactRotation) {
      this.setRotation(desiredRotation);
    } else {
      this.setRotation(quat.slerp(this._rotation, desiredRotation, rotationAlpha));
    }
  }

  public setConfirmVisible(visible: boolean): void {
    this.confirmButtonObject.enabled = visible;
    this._setConfirmInteractable(visible);
  }

  public setCancelActionAvailability(available: boolean): void {
    this._cancelActionAvailable = available;
    this._applyCancelButtonPresentation();
  }

  public hide(): void {
    this.apply({
      visible: false,
      circleIdle: true,
      heading: this._rotation,
      button: null,
      outcomeLabel: null,
    });
  }

  public hideAndThen(callback: () => void): void {
    this._beginHide();
    animateLocalScale(
      this.root,
      vec3.zero(),
      MARKER_VISIBILITY_DURATION_SECONDS,
      this.root,
      VISIBILITY_ANIMATION_VERSION_KEY,
      {
        onEnded: () => {
          this.root.enabled = false;
          this._visible = false;
          callback();
        },
      },
    );
  }

  /** Cancel animations and disable interaction before scene-object destroy. */
  public teardownImmediate(): void {
    nextAnimationVersion(this.root, OUTCOME_RESET_ANIMATION_VERSION_KEY);
    const dragInteractable = this.dragInteractable as any;
    if (dragInteractable) {
      dragInteractable.enabled = false;
    }
    this.setConfirmVisible(false);
    this.releasePlacementAnchor();
    this._visible = false;
    this._outcomeActive = false;
    this.root.enabled = false;
    this.root.getTransform().setLocalScale(vec3.zero());
  }

  private _applyOutcomeView(view: NavMarkerViewState): void {
    const startingOutcome = !this._outcomeActive;
    this._outcomeActive = true;
    this._visible = view.visible;

    if (startingOutcome) {
      this._restoreStandardVisualState();
    }

    this.dragInteractableObject.enabled = true;
    this._applyCircleMaterial(false);
    applyDotsMaterialMode(this.dots, false);
    this.setConfirmVisible(false);
    this._setConfirmVfxState(true, true);
    this.root.enabled = true;
    this.root.getTransform().setLocalScale(this.rootBaseScale);
    this._setDotsVisible(true);
    const label: "Cancelled" | "Failed" =
      view.outcomeLabel === "Cancelled" ? "Cancelled" : "Failed";
    this._setStateText(outcomeStateText(label), true);

    if (startingOutcome) {
      const animationVersion = nextAnimationVersion(
        this.root,
        OUTCOME_RESET_ANIMATION_VERSION_KEY,
      );
      this._animateOutcomeResetCollapse(animationVersion);
      this._animateOutcomeResetDelayedContentCollapse(animationVersion);
    }
  }

  private _applyCircleMaterial(idle: boolean): void {
    if (!this.circleVisual) {
      return;
    }
    const nextMaterial = idle ? this.circleWhiteMaterial : this.circleYellowMaterial;
    if (this.circleVisual.mainMaterial !== nextMaterial) {
      this.circleVisual.mainMaterial = nextMaterial;
    }
  }

  private _setConfirmInteractable(enabled: boolean): void {
    if (this._confirmEnabled === enabled) {
      return;
    }
    this._confirmEnabled = enabled;
    (this.confirmButton as any).enabled = enabled;
  }

  private _worldToAnchorLocal(worldPosition: vec3): vec3 {
    if (!this._placementAnchor) {
      return worldPosition;
    }
    const anchorPosition = this._placementAnchor.getTransform().getWorldPosition();
    return new vec3(
      worldPosition.x - anchorPosition.x,
      worldPosition.y - anchorPosition.y,
      worldPosition.z - anchorPosition.z,
    );
  }

  private _setDotsVisible(visible: boolean): void {
    if (!this.dots) {
      return;
    }
    this.dots.enabled = visible;
  }

  private _setStateText(text: string, visible: boolean): void {
    if (!this.stateText) {
      return;
    }
    this.stateText.text = text;
    this.stateText.getSceneObject().enabled = visible;
  }

  private _isVisuallyCollapsed(): boolean {
    const scale = this.dragInteractableObject.getTransform().getLocalScale();
    return scale.x < 0.001 && scale.y < 0.001 && scale.z < 0.001;
  }

  private _restoreStandardVisualState(): void {
    nextAnimationVersion(this.root, OUTCOME_RESET_ANIMATION_VERSION_KEY);
    this.dragInteractableObject.enabled = true;
    this.dragInteractableObject
      .getTransform()
      .setLocalScale(this.dragInteractableBaseScale);
    if (this.headingRoot && this.headingBaseScale) {
      this.headingRoot.getTransform().setLocalScale(this.headingBaseScale);
    }
    if (this.dots && this.dotsBaseScale) {
      this.dots.getTransform().setLocalScale(this.dotsBaseScale);
    }
    if (this.stateText && this.stateTextBaseScale) {
      this.stateText.getSceneObject().getTransform().setLocalScale(this.stateTextBaseScale);
    }
    this._setStateText("", false);
  }

  private _setConfirmVfxState(
    confirmVisible: boolean,
    hideBoth: boolean = false,
  ): void {
    if (this.confirmVfx) {
      this.confirmVfx.enabled = hideBoth ? false : confirmVisible;
    }
    if (this.cancelVfx) {
      this.cancelVfx.enabled = hideBoth ? false : !confirmVisible;
    }
  }

  private _beginHide(): void {
    this._visible = false;
    this._outcomeActive = false;
    if (!this._isVisuallyCollapsed()) {
      this._restoreStandardVisualState();
    }
    this.setConfirmVisible(false);
    this._setDotsVisible(false);
    this._setConfirmVfxState(true, true);
  }

  private _initializeHidden(): void {
    this.root.enabled = false;
    this.root.getTransform().setLocalScale(vec3.zero());
    this.dragInteractableObject.enabled = false;
    this._restoreStandardVisualState();
    this._setDotsVisible(false);
    this._setConfirmVfxState(true, true);
    this.confirmButtonObject.enabled = false;
    this._confirmEnabled = false;
  }

  private _applyCancelButtonPresentation(): void {
    applyCapabilityButtonPresentation(this.confirmButton, this.confirmLabel, {
      available: this._cancelActionAvailable,
      availableLabel: "Cancel",
      unavailableLabel: "Cancel\nUnavailable",
      availableStyle: SnapOS2Styles.Special,
      unavailableStyle: SnapOS2Styles.Special,
    });
  }

  private _applyHeadingRootRotation(): void {
    if (!this.headingRoot) {
      return;
    }
    this.headingRoot.getTransform().setLocalRotation(this._rotation);
  }

  private _animateRootVisibility(visible: boolean): void {
    if (visible) {
      this.root.enabled = true;
    }
    animateLocalScale(
      this.root,
      visible ? this.rootBaseScale : vec3.zero(),
      MARKER_VISIBILITY_DURATION_SECONDS,
      this.root,
      VISIBILITY_ANIMATION_VERSION_KEY,
      {
        onEnded: () => {
          this.root.enabled = visible;
        },
      },
    );
  }

  private _animateOutcomeResetCollapse(version: number): void {
    animateLocalScale(
      this.dragInteractableObject,
      vec3.zero(),
      OUTCOME_CIRCLE_COLLAPSE_DURATION_SECONDS,
      this.root,
      OUTCOME_RESET_ANIMATION_VERSION_KEY,
      { fixedVersion: version },
    );
    if (this.headingRoot && this.headingBaseScale) {
      animateLocalScale(
        this.headingRoot,
        vec3.zero(),
        OUTCOME_CIRCLE_COLLAPSE_DURATION_SECONDS,
        this.root,
        OUTCOME_RESET_ANIMATION_VERSION_KEY,
        { fixedVersion: version },
      );
    }
  }

  private _animateOutcomeResetDelayedContentCollapse(version: number): void {
    if (!this.dots && !this.stateText) {
      this._outcomeResetCompleteCallback?.();
      this._outcomeResetCompleteCallback = null;
      return;
    }
    const dotsTransform = this.dots?.getTransform() ?? null;
    const dotsStart = dotsTransform?.getLocalScale() ?? null;
    const stateTextTransform = this.stateText?.getSceneObject().getTransform() ?? null;
    const stateTextStart = stateTextTransform?.getLocalScale() ?? null;
    const target = vec3.zero();
    const totalDuration =
      OUTCOME_DOTS_TEXT_COLLAPSE_DELAY_SECONDS + MARKER_VISIBILITY_DURATION_SECONDS;
    animate({
      duration: totalDuration,
      easing: "linear",
      update: (t: number) => {
        if (
          !isLatestAnimationVersion(
            this.root,
            OUTCOME_RESET_ANIMATION_VERSION_KEY,
            version,
          )
        ) {
          return;
        }
        const elapsed = t * totalDuration;
        if (elapsed < OUTCOME_DOTS_TEXT_COLLAPSE_DELAY_SECONDS) {
          if (dotsTransform && dotsStart) {
            dotsTransform.setLocalScale(dotsStart);
          }
          if (stateTextTransform && stateTextStart) {
            stateTextTransform.setLocalScale(stateTextStart);
          }
          return;
        }
        const collapseT =
          (elapsed - OUTCOME_DOTS_TEXT_COLLAPSE_DELAY_SECONDS) /
          MARKER_VISIBILITY_DURATION_SECONDS;
        const easedT = Math.min(1, collapseT);
        if (dotsTransform && dotsStart) {
          dotsTransform.setLocalScale(lerpVec3(dotsStart, target, easedT));
        }
        if (stateTextTransform && stateTextStart) {
          stateTextTransform.setLocalScale(lerpVec3(stateTextStart, target, easedT));
        }
      },
      ended: () => {
        if (
          !isLatestAnimationVersion(
            this.root,
            OUTCOME_RESET_ANIMATION_VERSION_KEY,
            version,
          )
        ) {
          return;
        }
        if (dotsTransform) {
          dotsTransform.setLocalScale(target);
        }
        if (stateTextTransform) {
          stateTextTransform.setLocalScale(target);
        }
        this._outcomeResetCompleteCallback?.();
        this._outcomeResetCompleteCallback = null;
      },
    });
  }
}

export type NavigationMarkerEvents = {
  onOutcomeResetComplete?: () => void;
  onDragTriggerStart?: (interactor: any) => void;
  onDragTriggerEnd?: () => void;
  onDragTriggerCanceled?: (interactor: any) => void;
  onConfirmTriggerUp?: () => void;
};

/** Prefab-root component: marker visuals, pose, and interaction wiring. */
@component
export class NavigationMarker extends BaseScriptComponent {
  @input
  private circleWhiteMaterial!: Material;

  @input
  private circleYellowMaterial!: Material;

  private _view: MarkerViewCore | null = null;
  private _events: NavigationMarkerEvents = {};
  private _interactionsBound = false;

  public onAwake(): void {
    this.ensureReady();
    this._bindInteractions();
  }

  public ensureReady(): void {
    if (this._view) {
      return;
    }
    this._view = new MarkerViewCore(this.getSceneObject(), {
      circleWhite: this.circleWhiteMaterial,
      circleYellow: this.circleYellowMaterial,
    });
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

  public apply(
    view: NavMarkerViewState,
    onOutcomeComplete?: () => void,
  ): void {
    this.ensureReady();
    this._view?.apply(view, onOutcomeComplete ?? this._events.onOutcomeResetComplete);
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
    exactRotation?: boolean,
  ): void {
    this._view?.interpolatePose(position, rotation, lerpSpeed, rotationLerpSpeed, exactRotation);
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
