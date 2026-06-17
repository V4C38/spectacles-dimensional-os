import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { RoundButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton";
import animate from "SpectaclesInteractionKit.lspkg/Utils/animate";
import {
  applyCapabilityButtonPresentation,
  findChildRecursive,
  findText,
  requireChild,
  requireFirstText,
  setButtonStyle,
  SnapOS2Styles,
} from "../UI/kit/UIKit";
import { yawRotationFromWorldRotation } from "./HeadingRotation";

// ================================================================
/** Scene-graph view for the navigation target marker with confirm/cancel and visibility animations. */
// ================================================================

export type NavigationMarkerVisualState =
  | "disabled"
  | "placing"
  | "executing"
  | "resettingOutcome";

const MARKER_VISIBILITY_DURATION_SECONDS = 0.18;
const OUTCOME_CIRCLE_COLLAPSE_DURATION_SECONDS =
  MARKER_VISIBILITY_DURATION_SECONDS / 0.5;
const OUTCOME_DOTS_TEXT_COLLAPSE_DELAY_SECONDS = 1.5;
const VISIBILITY_ANIMATION_VERSION_KEY = "__navMarkerVisibilityVersion";
const CIRCLE_SCALE_ANIMATION_VERSION_KEY = "__navMarkerCircleScaleVersion";
const OUTCOME_RESET_ANIMATION_VERSION_KEY = "__navMarkerOutcomeResetVersion";
const DOTS_WHITE = new vec4(1, 1, 1, 0.457359);
const DOTS_YELLOW = new vec4(0.976471, 0.929412, 0.423529, 0.500008);

export class NavigationMarkerView {
  private readonly root: SceneObject;
  private readonly headingRoot: SceneObject | null;
  private readonly rotationRoot: SceneObject | null;
  private readonly portalCircle: SceneObject;
  private readonly circleExecuting: SceneObject | null;
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
  private readonly rootBaseScale: vec3;
  private readonly headingBaseScale: vec3 | null;
  private readonly dotsBaseScale: vec3 | null;
  private readonly stateTextBaseScale: vec3 | null;
  private readonly rotationLookAt: Component | null;
  private readonly circleAnimation: any;

  private _state: NavigationMarkerVisualState = "disabled";
  private _confirmEnabled = false;
  private _placementAnchor: SceneObject | null = null;
  private _preAnchorParent: SceneObject | null = null;
  private _cancelActionAvailable = true;
  private _rotation = quat.quatIdentity();

  constructor(root: SceneObject) {
    this.root = root;
    this.headingRoot = findChildRecursive(this.root, "NavigationHeadingRoot");
    this.rotationRoot = findChildRecursive(this.root, "RotationRoot");
    this.portalCircle =
      findChildRecursive(this.root, "Circle_Seeking") ??
      requireChild(this.root, "PortalCircle", "NavigationMarkerView");
    this.circleExecuting = findChildRecursive(this.root, "Circle_Executing");
    this.confirmButtonObject = requireChild(this.root, "ConfirmButton", "NavigationMarkerView");
    this.confirmButton = this.confirmButtonObject.getComponent(
      RoundButton.getTypeName(),
    ) as RoundButton;
    this.confirmVfx = findChildRecursive(this.confirmButtonObject, "ButtonVFX_Confirm");
    this.cancelVfx = findChildRecursive(this.confirmButtonObject, "ButtonVFX_Cancel");
    this.confirmLabel = requireFirstText(this.confirmButtonObject, "NavigationMarkerView");
    this.stateText = findText(this.root, "State_Text");
    this.arrow = findChildRecursive(this.root, "Arrow");
    this.moveDirectionArrow = findChildRecursive(this.root, "MoveDirectionArrow");
    this.dots = findChildRecursive(this.root, "Dots");
    if (this.moveDirectionArrow && !this.headingRoot) {
      throw new Error(
        "NavigationMarkerView: MoveDirectionArrow requires NavigationHeadingRoot",
      );
    }
    this.portalBaseScale = this.portalCircle.getTransform().getLocalScale();
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
        "NavigationMarkerView: NavigationTargetMarker is missing ConfirmButton RoundButton",
      );
    }
    if (this.rotationLookAt) {
      this.rotationLookAt.enabled = false;
    }
    this._initializeHidden();
    this.setRotation(this._rotation);
  }

  public get confirmActionButton(): RoundButton {
    return this.confirmButton;
  }

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
    // Heading pivot is yaw-only so the flat arrow stays ground-parallel.
    this._rotation = yawRotationFromWorldRotation(rotation);
    this._applyHeadingRootRotation();
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
  ): void {
    const transform = this.root.getTransform();
    const dt = getDeltaTime();
    const alpha = dt > 0 ? 1.0 - Math.exp(-lerpSpeed * dt) : 1.0;
    const rotationAlpha =
      dt > 0 ? 1.0 - Math.exp(-rotationLerpSpeed * dt) : 1.0;
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
    this.setRotation(quat.slerp(this._rotation, desiredRotation, rotationAlpha));
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

  private _setConfirmInteractable(enabled: boolean): void {
    if (this._confirmEnabled === enabled) {
      return;
    }
    this._confirmEnabled = enabled;
    (this.confirmButton as any).enabled = enabled;
  }

  public setCancelActionAvailability(available: boolean): void {
    this._cancelActionAvailable = available;
    if (this._state === "executing") {
      this._applyExecutingButtonPresentation();
    }
  }

  public setConfirmAvailability(available: boolean): void {
    if (this._state !== "placing") {
      return;
    }
    this._setConfirmInteractable(available);
    if (this.confirmButtonObject.enabled) {
      this.confirmLabel.text = available ? "Confirm" : "Confirm\nUnavailable";
    }
  }

  public showPlacing(showConfirm: boolean = false): void {
    this._state = "placing";
    this._restoreOutcomeVisualState();
    if (this.circleExecuting) {
      this.circleExecuting.enabled = false;
    }
    if (this.rotationLookAt) {
      this.rotationLookAt.enabled = false;
    }
    this.setConfirmVisible(showConfirm);
    this.confirmLabel.text = "Confirm";
    setButtonStyle(this.confirmButton, SnapOS2Styles.Primary);
    this.resetCircleAnimation();
    this.setScanAnimationEnabled(false);
    this._setConfirmVfxState(true);
    if (this.arrow) {
      this.arrow.enabled = false;
    }
    this._setMoveDirectionArrowSpeed(0);
    this._syncMoveDirectionArrowVisibility();
    this._setCircleSaturation(this.portalCircle, 0);
    this._applyDotsVisual(true);
    this._animateVisibility(true);
    this._animateCircleScale(true);
  }

  public showExecuting(): void {
    this._state = "executing";
    this._restoreOutcomeVisualState();
    if (this.circleExecuting) {
      this.circleExecuting.enabled = true;
    }
    if (this.rotationLookAt) {
      this.rotationLookAt.enabled = false;
    }
    this.setConfirmVisible(true);
    this._applyExecutingButtonPresentation();
    this.setScanAnimationEnabled(true);
    this._setConfirmVfxState(false);
    if (this.arrow) {
      this.arrow.enabled = true;
    }
    this._setMoveDirectionArrowSpeed(1);
    this._syncMoveDirectionArrowVisibility();
    this._setCircleSaturation(this.circleExecuting, 1);
    this._applyDotsVisual(false);
    this._animateVisibility(true);
    this._animateCircleScale(false);
  }

  public showOutcomeReset(label: "Cancelled" | "Failed"): void {
    this._state = "resettingOutcome";
    this._restoreOutcomeVisualState();
    if (this.rotationLookAt) {
      this.rotationLookAt.enabled = false;
    }
    if (this.circleExecuting) {
      this.circleExecuting.enabled = false;
    }
    this.root.enabled = true;
    this.root.getTransform().setLocalScale(this.rootBaseScale);
    this.setConfirmVisible(false);
    this.setScanAnimationEnabled(false);
    this._setConfirmVfxState(true, true);
    if (this.arrow) {
      this.arrow.enabled = false;
    }
    this._setDotsVisible(true);
    this._applyDotsVisual(true);
    this._setStateText(label, true);
    this._setMoveDirectionArrowSpeed(0);
    this._syncMoveDirectionArrowVisibility();
    const animationVersion = this._nextOutcomeResetAnimationVersion();
    this._animateOutcomeResetCollapse(animationVersion);
    this._animateOutcomeResetDelayedContentCollapse(animationVersion);
  }

  public hide(): void {
    this._beginHide();
    this._animateVisibility(false);
  }

  public hideAndThen(callback: () => void): void {
    this._beginHide();
    const transform = this.root.getTransform();
    const start = transform.getLocalScale();
    const target = vec3.zero();
    const version = this._nextVisibilityAnimationVersion();
    animate({
      duration: MARKER_VISIBILITY_DURATION_SECONDS,
      easing: "ease-in-out-quad",
      update: (t: number) => {
        if (!this._isLatestVisibilityAnimationVersion(version)) {
          return;
        }
        transform.setLocalScale(
          new vec3(
            start.x + (target.x - start.x) * t,
            start.y + (target.y - start.y) * t,
            start.z + (target.z - start.z) * t,
          ),
        );
      },
      ended: () => {
        if (!this._isLatestVisibilityAnimationVersion(version)) {
          return;
        }
        transform.setLocalScale(target);
        this.root.enabled = false;
        callback();
      },
    });
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

  private _applyDotsVisual(seeking: boolean): void {
    if (!this.dots) {
      return;
    }
    const visual = this.dots.getComponent(
      "Component.RenderMeshVisual",
    ) as RenderMeshVisual | null;
    if (!visual?.mainMaterial) {
      return;
    }
    const pass = visual.mainMaterial.mainPass as any;
    if (!pass) {
      return;
    }
    if (seeking) {
      if ("WhiteColor" in pass) {
        pass.WhiteColor = DOTS_WHITE;
      }
      if ("YellowColor" in pass) {
        pass.YellowColor = DOTS_WHITE;
      }
      if ("AnimationSwitch" in pass) {
        pass.AnimationSwitch = false;
      } else if ("animationSwitch" in pass) {
        pass.animationSwitch = false;
      }
      return;
    }
    if ("WhiteColor" in pass) {
      pass.WhiteColor = DOTS_WHITE;
    }
    if ("YellowColor" in pass) {
      pass.YellowColor = DOTS_YELLOW;
    }
    if ("AnimationSwitch" in pass) {
      pass.AnimationSwitch = true;
    } else if ("animationSwitch" in pass) {
      pass.animationSwitch = true;
    }
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
    this._nextOutcomeResetAnimationVersion();
    this.portalCircle.enabled = true;
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

  private _setCircleSaturation(
    circle: SceneObject | null,
    value: number,
  ): void {
    if (!circle) {
      return;
    }
    const visual = circle.getComponent(
      "Component.RenderMeshVisual",
    ) as RenderMeshVisual | null;
    if (!visual || !visual.mainMaterial) {
      return;
    }
    const pass = visual.mainMaterial.mainPass;
    if (pass && "Saturation" in pass) {
      (pass as any).Saturation = value;
    }
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
    this._state = "disabled";
    this._restoreOutcomeVisualState();
    this.setConfirmVisible(false);
    this.setScanAnimationEnabled(false);
    this._setConfirmVfxState(true, true);
    if (this.arrow) {
      this.arrow.enabled = false;
    }
    this._setMoveDirectionArrowSpeed(0);
    this._syncMoveDirectionArrowVisibility();
    // Cancel any in-progress circle animation and restore the circle to full
    // scale so it is ready for the next showPlacing(). The root is about to
    // scale to zero so this is invisible.
    this._nextCircleAnimationVersion();
    this.portalCircle.enabled = true;
    this.portalCircle.getTransform().setLocalScale(this.portalBaseScale);
    if (this.circleExecuting) {
      this.circleExecuting.enabled = false;
    }
    this._applyDotsVisual(true);
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

  private _applyExecutingButtonPresentation(): void {
    applyCapabilityButtonPresentation(this.confirmButton, this.confirmLabel, {
      available: this._cancelActionAvailable,
      availableLabel: "Cancel",
      unavailableLabel: "Cancel\nUnavailable",
      availableStyle: SnapOS2Styles.Special,
      unavailableStyle: SnapOS2Styles.Special,
    });
  }

  private _setMoveDirectionArrowSpeed(speed: number): void {
    if (!this.moveDirectionArrow) {
      return;
    }
    const visual = this.moveDirectionArrow.getComponent(
      "Component.RenderMeshVisual",
    ) as RenderMeshVisual | null;
    if (!visual?.mainMaterial) {
      return;
    }
    const pass = visual.mainMaterial.mainPass;
    if (pass && "ArrowSpeed" in pass) {
      (pass as any).ArrowSpeed = speed;
    }
  }

  private _syncMoveDirectionArrowVisibility(): void {
    if (!this.moveDirectionArrow) {
      return;
    }
    this.moveDirectionArrow.enabled = this._state !== "resettingOutcome";
  }

  private _applyHeadingRootRotation(): void {
    if (!this.headingRoot) {
      return;
    }
    // The root stays unrotated so circles and billboarded UI remain stable.
    // Semantic heading is applied only to the dedicated nav heading pivot.
    this.headingRoot.getTransform().setLocalRotation(this._rotation);
    this._syncMoveDirectionArrowVisibility();
  }

  private _animateCircleScale(visible: boolean): void {
    const transform = this.portalCircle.getTransform();
    const start = transform.getLocalScale();
    const target = visible ? this.portalBaseScale : vec3.zero();
    const version = this._nextCircleAnimationVersion();
    this.portalCircle.enabled = true;
    animate({
      duration: MARKER_VISIBILITY_DURATION_SECONDS,
      easing: "ease-in-out-quad",
      update: (t: number) => {
        if (!this._isLatestCircleAnimationVersion(version)) {
          return;
        }
        transform.setLocalScale(
          new vec3(
            start.x + (target.x - start.x) * t,
            start.y + (target.y - start.y) * t,
            start.z + (target.z - start.z) * t,
          ),
        );
      },
      ended: () => {
        if (!this._isLatestCircleAnimationVersion(version)) {
          return;
        }
        transform.setLocalScale(target);
        if (!visible) {
          this.portalCircle.enabled = false;
        }
      },
    });
  }

  private _animateOutcomeResetCollapse(version: number): void {
    const portalTransform = this.portalCircle.getTransform();
    const portalStart = portalTransform.getLocalScale();
    const target = vec3.zero();
    animate({
      duration: OUTCOME_CIRCLE_COLLAPSE_DURATION_SECONDS,
      easing: "ease-in-out-quad",
      update: (t: number) => {
        if (!this._isLatestOutcomeResetAnimationVersion(version)) {
          return;
        }
        portalTransform.setLocalScale(
          new vec3(
            portalStart.x + (target.x - portalStart.x) * t,
            portalStart.y + (target.y - portalStart.y) * t,
            portalStart.z + (target.z - portalStart.z) * t,
          ),
        );
      },
      ended: () => {
        if (!this._isLatestOutcomeResetAnimationVersion(version)) {
          return;
        }
        portalTransform.setLocalScale(target);
      },
    });
  }

  private _animateOutcomeResetDelayedContentCollapse(version: number): void {
    if (!this.dots && !this.stateText && !this.headingRoot) {
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
        if (!this._isLatestOutcomeResetAnimationVersion(version)) {
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
          dotsTransform.setLocalScale(
            new vec3(
              dotsStart.x + (target.x - dotsStart.x) * easedT,
              dotsStart.y + (target.y - dotsStart.y) * easedT,
              dotsStart.z + (target.z - dotsStart.z) * easedT,
            ),
          );
        }
        if (stateTextTransform && stateTextStart) {
          stateTextTransform.setLocalScale(
            new vec3(
              stateTextStart.x + (target.x - stateTextStart.x) * easedT,
              stateTextStart.y + (target.y - stateTextStart.y) * easedT,
              stateTextStart.z + (target.z - stateTextStart.z) * easedT,
            ),
          );
        }
        if (headingTransform && headingStart) {
          headingTransform.setLocalScale(
            new vec3(
              headingStart.x + (target.x - headingStart.x) * easedT,
              headingStart.y + (target.y - headingStart.y) * easedT,
              headingStart.z + (target.z - headingStart.z) * easedT,
            ),
          );
        }
      },
      ended: () => {
        if (!this._isLatestOutcomeResetAnimationVersion(version)) {
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
      },
    });
  }

  private _nextCircleAnimationVersion(): number {
    const circleAny = this.portalCircle as unknown as { [key: string]: number };
    const nextVersion = (circleAny[CIRCLE_SCALE_ANIMATION_VERSION_KEY] ?? 0) + 1;
    circleAny[CIRCLE_SCALE_ANIMATION_VERSION_KEY] = nextVersion;
    return nextVersion;
  }

  private _isLatestCircleAnimationVersion(version: number): boolean {
    const circleAny = this.portalCircle as unknown as { [key: string]: number };
    return circleAny[CIRCLE_SCALE_ANIMATION_VERSION_KEY] === version;
  }

  private _nextOutcomeResetAnimationVersion(): number {
    const rootAny = this.root as unknown as { [key: string]: number };
    const nextVersion = (rootAny[OUTCOME_RESET_ANIMATION_VERSION_KEY] ?? 0) + 1;
    rootAny[OUTCOME_RESET_ANIMATION_VERSION_KEY] = nextVersion;
    return nextVersion;
  }

  private _isLatestOutcomeResetAnimationVersion(version: number): boolean {
    const rootAny = this.root as unknown as { [key: string]: number };
    return rootAny[OUTCOME_RESET_ANIMATION_VERSION_KEY] === version;
  }

  private _animateVisibility(visible: boolean): void {
    const transform = this.root.getTransform();
    const start = transform.getLocalScale();
    const target = visible ? this.rootBaseScale : vec3.zero();
    const version = this._nextVisibilityAnimationVersion();
    if (visible) {
      this.root.enabled = true;
    }
    animate({
      duration: MARKER_VISIBILITY_DURATION_SECONDS,
      easing: "ease-in-out-quad",
      update: (t: number) => {
        transform.setLocalScale(
          new vec3(
            start.x + (target.x - start.x) * t,
            start.y + (target.y - start.y) * t,
            start.z + (target.z - start.z) * t,
          ),
        );
      },
      ended: () => {
        if (!this._isLatestVisibilityAnimationVersion(version)) {
          return;
        }
        transform.setLocalScale(target);
        this.root.enabled = visible;
      },
    });
  }

  private _nextVisibilityAnimationVersion(): number {
    const rootAny = this.root as unknown as { [key: string]: number };
    const nextVersion = (rootAny[VISIBILITY_ANIMATION_VERSION_KEY] ?? 0) + 1;
    rootAny[VISIBILITY_ANIMATION_VERSION_KEY] = nextVersion;
    return nextVersion;
  }

  private _isLatestVisibilityAnimationVersion(version: number): boolean {
    const rootAny = this.root as unknown as { [key: string]: number };
    return rootAny[VISIBILITY_ANIMATION_VERSION_KEY] === version;
  }
}
