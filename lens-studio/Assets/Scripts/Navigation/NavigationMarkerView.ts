import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { RoundButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton";
import animate from "SpectaclesInteractionKit.lspkg/Utils/animate";
import {
  applyCapabilityButtonPresentation,
  setButtonStyle,
  SnapOS2Styles,
} from "../UI/Shared/UIBuilders";
import { yawRotationFromWorldRotation } from "./HeadingRotation";

// ================================================================
/** Scene-graph view for the navigation target marker with confirm/cancel and visibility animations. */
// ================================================================

export type NavigationMarkerVisualState = "disabled" | "placing" | "executing";

const MARKER_VISIBILITY_DURATION_SECONDS = 0.18;
const VISIBILITY_ANIMATION_VERSION_KEY = "__navMarkerVisibilityVersion";
const CIRCLE_SCALE_ANIMATION_VERSION_KEY = "__navMarkerCircleScaleVersion";
const DOTS_WHITE = new vec4(1, 1, 1, 0.457359);
const DOTS_YELLOW = new vec4(0.976471, 0.929412, 0.423529, 0.500008);

export class NavigationMarkerView {
  private readonly root: SceneObject;
  private readonly screenTextParent: SceneObject | null;
  private readonly headingRoot: SceneObject | null;
  private readonly rotationRoot: SceneObject | null;
  private readonly portalCircle: SceneObject;
  private readonly circleExecuting: SceneObject | null;
  private readonly confirmButtonObject: SceneObject;
  private readonly confirmButton: RoundButton;
  private readonly confirmVfx: SceneObject | null;
  private readonly cancelVfx: SceneObject | null;
  private readonly confirmLabel: Text;
  private readonly arrow: SceneObject | null;
  private readonly moveDirectionArrow: SceneObject | null;
  private readonly dots: SceneObject | null;
  private readonly portalBaseScale: vec3;
  private readonly rootBaseScale: vec3;
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
    this.screenTextParent = this._findChild(this.root, "ScreenTextParent");
    this.headingRoot = this._findChild(this.root, "NavigationHeadingRoot");
    this.rotationRoot = this._findChild(this.root, "RotationRoot");
    this.portalCircle =
      this._findChild(this.root, "Circle_Seeking") ??
      this._requireChild(this.root, "PortalCircle");
    this.circleExecuting = this._findChild(this.root, "Circle_Executing");
    this.confirmButtonObject = this._requireChild(this.root, "ConfirmButton");
    this.confirmButton = this.confirmButtonObject.getComponent(
      RoundButton.getTypeName(),
    ) as RoundButton;
    this.confirmVfx = this._findChild(this.confirmButtonObject, "ButtonVFX_Confirm");
    this.cancelVfx = this._findChild(this.confirmButtonObject, "ButtonVFX_Cancel");
    this.confirmLabel = this._requireFirstText(this.confirmButtonObject);
    this.arrow = this._findChild(this.root, "Arrow");
    this.moveDirectionArrow = this._findChild(this.root, "MoveDirectionArrow");
    this.dots = this._findChild(this.root, "Dots");
    if (this.moveDirectionArrow && !this.headingRoot) {
      throw new Error(
        "NavigationMarkerView: MoveDirectionArrow requires NavigationHeadingRoot",
      );
    }
    this.portalBaseScale = this.portalCircle.getTransform().getLocalScale();
    this.rootBaseScale = this.root.getTransform().getLocalScale();
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

  public get visualState(): NavigationMarkerVisualState {
    return this._state;
  }

  public get confirmActionButton(): RoundButton {
    return this.confirmButton;
  }

  public get dragInteractable(): Interactable | null {
    return this.portalCircle.getComponent(
      Interactable.getTypeName(),
    ) as Interactable | null;
  }

  public get floatingUiParent(): SceneObject {
    return this.screenTextParent ?? this.rotationRoot ?? this.root;
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
  ): void {
    const transform = this.root.getTransform();
    const alpha = getDeltaTime() * lerpSpeed;
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
    this.setRotation(desiredRotation);
  }

  public setFloatingUiWorldPosition(position: vec3): void {
    if (!this.screenTextParent) {
      return;
    }
    this.screenTextParent.getTransform().setWorldPosition(position);
  }

  public resetCircleAnimation(): void {
    this.circleAnimation?.reset?.();
  }

  public setScanAnimationEnabled(enabled: boolean): void {
    this.circleAnimation?.enableScanAnimation?.(enabled);
  }

  public animateCircleOut(): void {
    this.circleAnimation?.animateCircleOut?.(null);
  }

  public animateCircleIn(): void {
    this.circleAnimation?.animateCircleIn?.(null);
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

  private _requireChild(root: SceneObject, name: string): SceneObject {
    const child = this._findChild(root, name);
    if (!child) {
      throw new Error(`NavigationMarkerView: Missing scene object ${name}`);
    }
    return child;
  }

  private _findChild(root: SceneObject, name: string): SceneObject | null {
    for (let index = 0; index < root.getChildrenCount(); index++) {
      const child = root.getChild(index);
      if (child.name === name) {
        return child;
      }
      const nested = this._findChild(child, name);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  private _requireFirstText(root: SceneObject): Text {
    const sceneObject = this._findFirstTextObject(root);
    if (!sceneObject) {
      throw new Error(
        "NavigationMarkerView: ConfirmButton subtree is missing a text label",
      );
    }
    return sceneObject.getComponent("Component.Text") as Text;
  }

  private _findFirstTextObject(root: SceneObject): SceneObject | null {
    const text = root.getComponent("Component.Text") as Text | null;
    if (text) {
      return root;
    }
    for (let index = 0; index < root.getChildrenCount(); index++) {
      const nested = this._findFirstTextObject(root.getChild(index));
      if (nested) {
        return nested;
      }
    }
    return null;
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
    this.moveDirectionArrow.enabled = true;
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
