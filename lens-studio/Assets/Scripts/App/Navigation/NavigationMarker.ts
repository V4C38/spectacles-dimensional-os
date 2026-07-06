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
  setButtonStyle,
  SnapOS2Styles,
} from "../UI/UIKit";
import { yawRotationFromWorldRotation } from "../Utilities/Utilities";
import type {
  NavGoalConfig,
  NavMarkerViewState,
} from "../../ARBridge/Navigation/NavigationModel";

const MARKER_VISIBILITY_DURATION_SECONDS = 0.18;
const OUTCOME_CIRCLE_COLLAPSE_DURATION_SECONDS =
  MARKER_VISIBILITY_DURATION_SECONDS / 0.5;
const OUTCOME_DOTS_TEXT_COLLAPSE_DELAY_SECONDS = 1.5;
const VISIBILITY_ANIMATION_VERSION_KEY = "__navMarkerVisibilityVersion";
const CIRCLE_SCALE_ANIMATION_VERSION_KEY = "__navMarkerCircleScaleVersion";
const OUTCOME_RESET_ANIMATION_VERSION_KEY = "__navMarkerOutcomeResetVersion";

function setMaterialPassProp(
  object: SceneObject | null,
  prop: string,
  value: unknown,
  altProp?: string,
): boolean {
  if (!object) {
    return false;
  }
  const visual = object.getComponent(
    "Component.RenderMeshVisual",
  ) as RenderMeshVisual | null;
  if (!visual?.mainMaterial?.mainPass) {
    return false;
  }
  const pass = visual.mainMaterial.mainPass as any;
  if (prop in pass) {
    pass[prop] = value;
    return true;
  }
  if (altProp && altProp in pass) {
    pass[altProp] = value;
    return true;
  }
  return false;
}

function applyDotsMaterialMode(
  dots: SceneObject | null,
  seeking: boolean,
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
    pass.YellowColor = seeking ? DOTS_WHITE : DOTS_YELLOW;
  }
  if ("AnimationSwitch" in pass) {
    pass.AnimationSwitch = !seeking;
  } else if ("animationSwitch" in pass) {
    pass.animationSwitch = !seeking;
  }
}

export class MarkerViewCore {
  private readonly root: SceneObject;
  private readonly headingRoot: SceneObject | null;
  private readonly rotationRoot: SceneObject | null;
  private readonly portalCircle: SceneObject;
  private readonly circleNavigating: SceneObject | null;
  private readonly confirmButtonObject: SceneObject;
  private readonly confirmButton: RoundButton;
  private readonly confirmVfx: SceneObject | null;
  private readonly cancelVfx: SceneObject | null;
  private readonly confirmLabel: Text;
  private readonly stateText: Text | null;
  private readonly arrow: SceneObject | null;
  private readonly moveDirectionArrow: SceneObject | null;
  private readonly dots: SceneObject | null;
  private readonly portalBaseScale: vec3;
  private readonly navigatingBaseScale: vec3 | null;
  private readonly rootBaseScale: vec3;
  private readonly headingBaseScale: vec3 | null;
  private readonly dotsBaseScale: vec3 | null;
  private readonly stateTextBaseScale: vec3 | null;
  private readonly rotationLookAt: Component | null;
  private readonly circleAnimation: any;

  private _config: NavGoalConfig = { mode: "single", source: "user", interactive: true };
  private _appliedStyle: NavMarkerViewState["style"] | "hidden" = "hidden";
  private _confirmEnabled = false;
  private _placementAnchor: SceneObject | null = null;
  private _preAnchorParent: SceneObject | null = null;
  private _cancelActionAvailable = true;
  private _rotation = quat.quatIdentity();
  private _outcomeResetCompleteCallback: (() => void) | null = null;

  constructor(root: SceneObject) {
    this.root = root;
    this.headingRoot = findChildRecursive(this.root, "NavigationHeadingRoot");
    this.rotationRoot = findChildRecursive(this.root, "RotationRoot");
    this.portalCircle =
      findChildRecursive(this.root, "Circle_Seeking") ??
      requireChild(this.root, "PortalCircle", "MarkerViewCore");
    this.circleNavigating = findChildRecursive(this.root, "Circle_Navigating");
    this.confirmButtonObject = requireChild(this.root, "ConfirmButton", "MarkerViewCore");
    this.confirmButton = this.confirmButtonObject.getComponent(
      RoundButton.getTypeName(),
    ) as RoundButton;
    this.confirmVfx = findChildRecursive(this.confirmButtonObject, "ButtonVFX_Confirm");
    this.cancelVfx = findChildRecursive(this.confirmButtonObject, "ButtonVFX_Cancel");
    this.confirmLabel = requireFirstText(this.confirmButtonObject, "MarkerViewCore");
    this.stateText = findText(this.root, "State_Text");
    this.arrow = findChildRecursive(this.root, "Arrow");
    this.moveDirectionArrow = findChildRecursive(this.root, "MoveDirectionArrow");
    this.dots = findChildRecursive(this.root, "Dots");
    if (this.moveDirectionArrow && !this.headingRoot) {
      throw new Error(
        "MarkerViewCore: MoveDirectionArrow requires NavigationHeadingRoot",
      );
    }
    this.portalBaseScale = this.portalCircle.getTransform().getLocalScale();
    this.navigatingBaseScale =
      this.circleNavigating?.getTransform().getLocalScale() ?? null;
    this.rootBaseScale = this.root.getTransform().getLocalScale();
    this.headingBaseScale = this.headingRoot?.getTransform().getLocalScale() ?? null;
    this.dotsBaseScale = this.dots?.getTransform().getLocalScale() ?? null;
    this.stateTextBaseScale =
      this.stateText?.getSceneObject().getTransform().getLocalScale() ?? null;
    this.rotationLookAt = (this.rotationRoot ?? this.root).getComponent(
      "Component.LookAtComponent",
    ) as Component | null;
    this.circleAnimation = this._findScriptComponent(
      this.portalCircle,
      "reset",
      "enableScanAnimation",
    );
    if (!this.confirmButton) {
      throw new Error(
        "MarkerViewCore: NavigationTargetMarker is missing ConfirmButton RoundButton",
      );
    }
    if (this.rotationLookAt) {
      this.rotationLookAt.enabled = false;
    }
    this._initializeHidden();
    this.setRotation(this._rotation);
  }

  public get config(): NavGoalConfig {
    return this._config;
  }

  public get appliedStyle(): NavMarkerViewState["style"] | "hidden" {
    return this._appliedStyle;
  }

  public get confirmActionButton(): RoundButton {
    return this.confirmButton;
  }

  /** Drag collider lives on portalCircle — disabling that object revokes drag mid-gesture. */
  public get dragInteractable(): Interactable | null {
    return this.portalCircle.getComponent(
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
    config: NavGoalConfig,
    view: NavMarkerViewState,
    onOutcomeComplete?: () => void,
  ): void {
    if (view.style === "outcome") {
      this._outcomeResetCompleteCallback = onOutcomeComplete ?? null;
    }
    this._applyStandardOrOutcome(config, view);
  }

  private _applyStandardOrOutcome(config: NavGoalConfig, view: NavMarkerViewState): void {
    const samePresentation =
      this._config.mode === config.mode &&
      this._config.interactive === config.interactive &&
      this._appliedStyle === view.style &&
      view.visible;

    this._config = config;
    this._appliedStyle = view.visible ? view.style : "hidden";

    if (!view.visible) {
      this._beginHide();
      this._animateRootVisibility(false);
      return;
    }

    if (view.style === "outcome") {
      this._applyOutcomeView(view, !samePresentation);
      return;
    }

    this._applyStandardView(view, !samePresentation);
  }

  private _applyOutcomeView(view: NavMarkerViewState, animateEntrance: boolean): void {
    if (animateEntrance) {
      this._restoreOutcomeVisualState();
    }
    this._applyMarkerVisuals(view, animateEntrance);
    this.root.enabled = true;
    this.root.getTransform().setLocalScale(this.rootBaseScale);
    this._setDotsVisible(true);
    this._setStateText(view.outcomeLabel ?? "", true);
    const animationVersion = nextAnimationVersion(
      this.root,
      OUTCOME_RESET_ANIMATION_VERSION_KEY,
    );
    this._animateOutcomeResetCollapse(animationVersion);
    this._animateOutcomeResetDelayedContentCollapse(animationVersion);
  }

  private _applyStandardView(view: NavMarkerViewState, animateEntrance: boolean): void {
    if (animateEntrance && view.style === "seeking") {
      this._restoreOutcomeVisualState();
      this.resetCircleAnimation();
    }
    this._applyMarkerVisuals(view, animateEntrance);
    if (view.style === "seeking" && animateEntrance) {
      this._animateRootVisibility(true);
      if (view.navigatingCircleVisible && this.circleNavigating && this.navigatingBaseScale) {
        this._animateCircleScale(true, this.circleNavigating, this.navigatingBaseScale);
      } else {
        this._animateCircleScale(true);
      }
    }
  }

  private _applyMarkerVisuals(view: NavMarkerViewState, animateEntrance: boolean): void {
    const navigating = view.style === "navigating";
    const preview = view.style === "preview";
    const seeking = view.style === "seeking";

    if (this.circleNavigating) {
      this.circleNavigating.enabled = view.navigatingCircleVisible;
    }
    // Keep portalCircle enabled whenever portalCircleVisible — it hosts the drag Interactable.
    this.portalCircle.enabled = view.portalCircleVisible;
    this._setCircleMeshVisible(this.portalCircle, view.portalCircleVisible);
    if (this.rotationLookAt) {
      this.rotationLookAt.enabled = false;
    }

    const button = view.button;
    this.setConfirmVisible(button !== null);
    if (button?.role === "cancel") {
      this._cancelActionAvailable = button.enabled;
      this._applyNavigatingButtonPresentation();
    } else if (preview && button) {
      this.confirmLabel.text = button.label;
      setButtonStyle(this.confirmButton, SnapOS2Styles.Primary);
      this._setConfirmInteractable(button.enabled);
    }

    this.setScanAnimationEnabled(view.scanAnimation);
    this._setConfirmVfxState(
      button?.role === "confirm",
      button === null,
    );

    if (this.arrow) {
      this.arrow.enabled = navigating;
    }
    this._setMoveDirectionArrowSpeed(view.arrowSpeed);
    this._syncMoveDirectionArrowVisibility();

    if (view.navigatingCircleVisible) {
      setMaterialPassProp(this.circleNavigating, "Saturation", navigating ? 1 : 0);
    } else if (seeking || preview || view.style === "outcome") {
      setMaterialPassProp(this.portalCircle, "Saturation", 0);
    }

    applyDotsMaterialMode(this.dots, seeking || view.style === "outcome");
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

  public resetCircleAnimation(): void {
    this.circleAnimation?.reset?.();
  }

  public setScanAnimationEnabled(enabled: boolean): void {
    this.circleAnimation?.enableScanAnimation?.(enabled);
  }

  public setConfirmVisible(visible: boolean): void {
    this.confirmButtonObject.enabled = visible;
    this._setConfirmInteractable(visible);
  }

  public setCancelActionAvailability(available: boolean): void {
    this._cancelActionAvailable = available;
    if (this._appliedStyle === "navigating") {
      this._applyNavigatingButtonPresentation();
    }
  }

  public hide(): void {
    this.apply(this._config, {
      visible: false,
      style: "seeking",
      heading: this._rotation,
      button: null,
      outcomeLabel: null,
      scanAnimation: false,
      arrowSpeed: 0,
      portalCircleVisible: false,
      navigatingCircleVisible: false,
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
          this._appliedStyle = "hidden";
          callback();
        },
      },
    );
  }

  /** Cancel animations and disable interaction before scene-object destroy. */
  public teardownImmediate(): void {
    nextAnimationVersion(this.root, VISIBILITY_ANIMATION_VERSION_KEY);
    nextAnimationVersion(this.portalCircle, CIRCLE_SCALE_ANIMATION_VERSION_KEY);
    if (this.circleNavigating) {
      nextAnimationVersion(this.circleNavigating, CIRCLE_SCALE_ANIMATION_VERSION_KEY);
    }
    nextAnimationVersion(this.root, OUTCOME_RESET_ANIMATION_VERSION_KEY);
    const dragInteractable = this.dragInteractable as any;
    if (dragInteractable) {
      dragInteractable.enabled = false;
    }
    this.setConfirmVisible(false);
    this.setScanAnimationEnabled(false);
    this.releasePlacementAnchor();
    this._appliedStyle = "hidden";
    this.root.enabled = false;
    this.root.getTransform().setLocalScale(vec3.zero());
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

  private _findScriptComponent(
    root: SceneObject,
    ...methodNames: string[]
  ): any | null {
    const scripts = root.getComponents("ScriptComponent") ?? [];
    for (let index = 0; index < scripts.length; index++) {
      const script = scripts[index] as any;
      const hasAllMethods = methodNames.every(
        (methodName) => typeof script?.[methodName] === "function",
      );
      if (hasAllMethods) {
        return script;
      }
    }
    return null;
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

  private _restoreOutcomeVisualState(): void {
    nextAnimationVersion(this.root, OUTCOME_RESET_ANIMATION_VERSION_KEY);
    this.portalCircle.enabled = true;
    this._setCircleMeshVisible(this.portalCircle, true);
    this.portalCircle.getTransform().setLocalScale(this.portalBaseScale);
    if (this.headingRoot && this.headingBaseScale) {
      this.headingRoot.getTransform().setLocalScale(this.headingBaseScale);
    }
    if (this.dots && this.dotsBaseScale) {
      this.dots.getTransform().setLocalScale(this.dotsBaseScale);
    }
    if (this.stateText && this.stateTextBaseScale) {
      this.stateText.getSceneObject().getTransform().setLocalScale(this.stateTextBaseScale);
    }
    this._setDotsVisible(true);
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
    this._appliedStyle = "hidden";
    this._restoreOutcomeVisualState();
    nextAnimationVersion(this.portalCircle, CIRCLE_SCALE_ANIMATION_VERSION_KEY);
    this.portalCircle.enabled = true;
    this._setCircleMeshVisible(this.portalCircle, true);
    this.portalCircle.getTransform().setLocalScale(this.portalBaseScale);
    this.setConfirmVisible(false);
    this.setScanAnimationEnabled(false);
    this._setConfirmVfxState(true, true);
  }

  private _initializeHidden(): void {
    this.root.enabled = false;
    this.root.getTransform().setLocalScale(vec3.zero());
    this._restoreOutcomeVisualState();
    this.setScanAnimationEnabled(false);
    this._setConfirmVfxState(true, true);
    this.confirmButtonObject.enabled = false;
    this._confirmEnabled = false;
    if (this.arrow) {
      this.arrow.enabled = false;
    }
    this._setMoveDirectionArrowSpeed(0);
    this._syncMoveDirectionArrowVisibility();
  }

  private _applyNavigatingButtonPresentation(): void {
    applyCapabilityButtonPresentation(this.confirmButton, this.confirmLabel, {
      available: this._cancelActionAvailable,
      availableLabel: "Cancel",
      unavailableLabel: "Cancel\nUnavailable",
      availableStyle: SnapOS2Styles.Special,
      unavailableStyle: SnapOS2Styles.Special,
    });
  }

  private _setMoveDirectionArrowSpeed(speed: number): void {
    setMaterialPassProp(this.moveDirectionArrow, "ArrowSpeed", speed);
  }

  private _syncMoveDirectionArrowVisibility(): void {
    if (!this.moveDirectionArrow) {
      return;
    }
    this.moveDirectionArrow.enabled = this._appliedStyle !== "outcome";
  }

  private _applyHeadingRootRotation(): void {
    if (!this.headingRoot) {
      return;
    }
    this.headingRoot.getTransform().setLocalRotation(this._rotation);
    this._syncMoveDirectionArrowVisibility();
  }

  private _setCircleMeshVisible(circle: SceneObject, visible: boolean): void {
    const visual = circle.getComponent(
      "Component.RenderMeshVisual",
    ) as RenderMeshVisual | null;
    if (visual) {
      visual.enabled = visible;
    }
  }

  private _animateCircleScale(
    visible: boolean,
    target: SceneObject = this.portalCircle,
    baseScale: vec3 = this.portalBaseScale,
  ): void {
    animateLocalScale(
      target,
      visible ? baseScale : vec3.zero(),
      MARKER_VISIBILITY_DURATION_SECONDS,
      target,
      CIRCLE_SCALE_ANIMATION_VERSION_KEY,
      {
        enableOnStart: true,
        disableOnEnd: !visible,
      },
    );
  }

  private _animateOutcomeResetCollapse(version: number): void {
    animateLocalScale(
      this.portalCircle,
      vec3.zero(),
      OUTCOME_CIRCLE_COLLAPSE_DURATION_SECONDS,
      this.root,
      OUTCOME_RESET_ANIMATION_VERSION_KEY,
      { fixedVersion: version },
    );
  }

  private _animateOutcomeResetDelayedContentCollapse(version: number): void {
    if (!this.dots && !this.stateText && !this.headingRoot) {
      this._outcomeResetCompleteCallback?.();
      this._outcomeResetCompleteCallback = null;
      return;
    }
    const dotsTransform = this.dots?.getTransform() ?? null;
    const dotsStart = dotsTransform?.getLocalScale() ?? null;
    const stateTextTransform = this.stateText?.getSceneObject().getTransform() ?? null;
    const stateTextStart = stateTextTransform?.getLocalScale() ?? null;
    const headingTransform = this.headingRoot?.getTransform() ?? null;
    const headingStart = headingTransform?.getLocalScale() ?? null;
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
          if (headingTransform && headingStart) {
            headingTransform.setLocalScale(headingStart);
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
        if (headingTransform && headingStart) {
          headingTransform.setLocalScale(lerpVec3(headingStart, target, easedT));
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
        if (headingTransform) {
          headingTransform.setLocalScale(target);
        }
        this._outcomeResetCompleteCallback?.();
        this._outcomeResetCompleteCallback = null;
      },
    });
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
    this._view = new MarkerViewCore(this.getSceneObject());
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
    config: NavGoalConfig,
    view: NavMarkerViewState,
    onOutcomeComplete?: () => void,
  ): void {
    this.ensureReady();
    this._view?.apply(config, view, onOutcomeComplete ?? this._events.onOutcomeResetComplete);
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
