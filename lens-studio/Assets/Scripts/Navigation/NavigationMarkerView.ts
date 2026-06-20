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
import { yawRotationFromWorldRotation } from "../Core/Utilities";
import {
  NavigationMarkerPhase,
  NavigationMarkerPreset,
  NavigationMarkerProfile,
  resolveMarkerPreset,
} from "./NavigationProfile";

// ================================================================
/** Scene-graph view for the navigation target marker (profile × phase presets). */
// ================================================================

const MARKER_VISIBILITY_DURATION_SECONDS = 0.18;
const OUTCOME_CIRCLE_COLLAPSE_DURATION_SECONDS =
  MARKER_VISIBILITY_DURATION_SECONDS / 0.5;
const OUTCOME_DOTS_TEXT_COLLAPSE_DELAY_SECONDS = 1.5;
const VISIBILITY_ANIMATION_VERSION_KEY = "__navMarkerVisibilityVersion";
const CIRCLE_SCALE_ANIMATION_VERSION_KEY = "__navMarkerCircleScaleVersion";
const OUTCOME_RESET_ANIMATION_VERSION_KEY = "__navMarkerOutcomeResetVersion";

export type NavigationMarkerApplyOptions = {
  confirmAvailable?: boolean;
  cancelAvailable?: boolean;
  showConfirmInPreview?: boolean;
};

function nextAnimationVersion(store: object, key: string): number {
  const storeAny = store as { [key: string]: number };
  const nextVersion = (storeAny[key] ?? 0) + 1;
  storeAny[key] = nextVersion;
  return nextVersion;
}

function isLatestAnimationVersion(
  store: object,
  key: string,
  version: number,
): boolean {
  const storeAny = store as { [key: string]: number };
  return storeAny[key] === version;
}

type AnimateEasing = NonNullable<Parameters<typeof animate>[0]["easing"]>;

function animateLocalScale(
  object: SceneObject,
  targetScale: vec3,
  duration: number,
  versionStore: object,
  versionKey: string,
  options?: {
    easing?: AnimateEasing;
    onEnded?: () => void;
    enableOnStart?: boolean;
    disableOnEnd?: boolean;
    fixedVersion?: number;
  },
): void {
  const transform = object.getTransform();
  const start = transform.getLocalScale();
  const version =
    options?.fixedVersion ?? nextAnimationVersion(versionStore, versionKey);
  if (options?.enableOnStart) {
    object.enabled = true;
  }
  animate({
    duration,
    easing: options?.easing ?? "ease-in-out-quad",
    update: (t: number) => {
      if (!isLatestAnimationVersion(versionStore, versionKey, version)) {
        return;
      }
      transform.setLocalScale(
        new vec3(
          start.x + (targetScale.x - start.x) * t,
          start.y + (targetScale.y - start.y) * t,
          start.z + (targetScale.z - start.z) * t,
        ),
      );
    },
    ended: () => {
      if (!isLatestAnimationVersion(versionStore, versionKey, version)) {
        return;
      }
      transform.setLocalScale(targetScale);
      if (options?.disableOnEnd) {
        object.enabled = false;
      }
      options?.onEnded?.();
    },
  });
}

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

  private _profile: NavigationMarkerProfile = "manualSingle";
  private _phase: NavigationMarkerPhase = "hidden";
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

  public get profile(): NavigationMarkerProfile {
    return this._profile;
  }

  public get phase(): NavigationMarkerPhase {
    return this._phase;
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
    this._rotation = yawRotationFromWorldRotation(rotation);
    this._applyHeadingRootRotation();
  }

  public apply(
    profile: NavigationMarkerProfile,
    phase: NavigationMarkerPhase,
    opts: NavigationMarkerApplyOptions = {},
  ): void {
    if (phase === "outcomeReset") {
      return;
    }

    const samePresentation =
      this._profile === profile &&
      this._phase === phase &&
      phase !== "hidden";

    this._profile = profile;
    this._phase = phase;
    const preset = resolveMarkerPreset(profile, phase);
    const confirmVisible = this._resolveConfirmVisible(phase, preset.confirmVisible, opts);
    const resolvedPreset = { ...preset, confirmVisible };

    if (phase === "hidden") {
      this._beginHide();
      this._animateRootVisibility(false);
      return;
    }

    this._applyPresetVisuals(resolvedPreset, phase, opts, !samePresentation);
  }

  public showOutcomeReset(
    profile: NavigationMarkerProfile,
    label: "Cancelled" | "Failed",
    opts: NavigationMarkerApplyOptions = {},
  ): void {
    this._profile = profile;
    this._phase = "outcomeReset";
    const preset = resolveMarkerPreset(profile, "outcomeReset");
    if (preset.restoreOutcomeFirst) {
      this._restoreOutcomeVisualState();
    }
    this._applyPresetVisuals(preset, "outcomeReset", opts, true);
    this.root.enabled = true;
    this.root.getTransform().setLocalScale(this.rootBaseScale);
    this._setDotsVisible(true);
    this._setStateText(label, true);
    const animationVersion = nextAnimationVersion(
      this.root,
      OUTCOME_RESET_ANIMATION_VERSION_KEY,
    );
    this._animateOutcomeResetCollapse(animationVersion);
    this._animateOutcomeResetDelayedContentCollapse(animationVersion);
  }

  private _applyPresetVisuals(
    preset: NavigationMarkerPreset,
    phase: NavigationMarkerPhase,
    opts: NavigationMarkerApplyOptions,
    animateEntrance: boolean,
  ): void {
    if (preset.restoreOutcomeFirst && animateEntrance) {
      this._restoreOutcomeVisualState();
    }
    if (this.circleExecuting) {
      this.circleExecuting.enabled = preset.circleExecuting;
    }
    this.portalCircle.enabled = preset.portalCircleVisible;
    if (this.rotationLookAt) {
      this.rotationLookAt.enabled = preset.lookAtEnabled;
    }
    this.setConfirmVisible(preset.confirmVisible);
    if (preset.useExecutingButtonPresentation) {
      this._cancelActionAvailable = opts.cancelAvailable ?? this._cancelActionAvailable;
      this._applyExecutingButtonPresentation();
    } else if (phase === "preview") {
      this.confirmLabel.text = opts.confirmAvailable === false
        ? "Confirm\nUnavailable"
        : "Confirm";
      setButtonStyle(this.confirmButton, SnapOS2Styles.Primary);
      this._setConfirmInteractable(opts.confirmAvailable !== false);
    }
    if (preset.resetCircleBeforeShow && animateEntrance) {
      this.resetCircleAnimation();
    }
    this.setScanAnimationEnabled(preset.scanAnimation);
    this._setConfirmVfxState(
      preset.confirmVfx === "confirm",
      preset.confirmVfx === "hidden",
    );
    if (this.arrow) {
      this.arrow.enabled = preset.arrowEnabled;
    }
    this._setMoveDirectionArrowSpeed(preset.arrowSpeed);
    this._syncMoveDirectionArrowVisibility();
    if (preset.circleSaturation) {
      const circle =
        preset.circleSaturation.circle === "portal"
          ? this.portalCircle
          : this.circleExecuting;
      setMaterialPassProp(circle, "Saturation", preset.circleSaturation.value);
    }
    applyDotsMaterialMode(this.dots, preset.dotsMode === "seeking");
    if (preset.animateRootVisible !== null && animateEntrance) {
      this._animateRootVisibility(preset.animateRootVisible);
    }
    if (preset.animateCircleExpanded !== null && animateEntrance) {
      this._animateCircleScale(preset.animateCircleExpanded);
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

  public setCancelActionAvailability(available: boolean): void {
    this._cancelActionAvailable = available;
    if (this._phase === "navigating") {
      this._applyExecutingButtonPresentation();
    }
  }

  public hide(): void {
    this.apply(this._profile, "hidden");
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
          this._phase = "hidden";
          callback();
        },
      },
    );
  }

  private _resolveConfirmVisible(
    phase: NavigationMarkerPhase,
    presetConfirmVisible: boolean,
    opts: NavigationMarkerApplyOptions,
  ): boolean {
    if (phase === "preview") {
      return (opts.showConfirmInPreview ?? false) && presetConfirmVisible;
    }
    if (phase === "navigating") {
      return presetConfirmVisible;
    }
    return presetConfirmVisible;
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
    this._phase = "hidden";
    const preset = resolveMarkerPreset(this._profile, "hidden");
    if (preset.restoreOutcomeFirst) {
      this._restoreOutcomeVisualState();
    }
    nextAnimationVersion(this.portalCircle, CIRCLE_SCALE_ANIMATION_VERSION_KEY);
    this.portalCircle.enabled = true;
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
    setMaterialPassProp(this.moveDirectionArrow, "ArrowSpeed", speed);
  }

  private _syncMoveDirectionArrowVisibility(): void {
    if (!this.moveDirectionArrow) {
      return;
    }
    this.moveDirectionArrow.enabled = this._phase !== "outcomeReset";
  }

  private _applyHeadingRootRotation(): void {
    if (!this.headingRoot) {
      return;
    }
    this.headingRoot.getTransform().setLocalRotation(this._rotation);
    this._syncMoveDirectionArrowVisibility();
  }

  private _animateCircleScale(visible: boolean): void {
    animateLocalScale(
      this.portalCircle,
      visible ? this.portalBaseScale : vec3.zero(),
      MARKER_VISIBILITY_DURATION_SECONDS,
      this.portalCircle,
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
