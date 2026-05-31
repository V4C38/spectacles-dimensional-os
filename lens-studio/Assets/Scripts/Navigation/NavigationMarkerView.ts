import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { RoundButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton";
import animate from "SpectaclesInteractionKit.lspkg/Utils/animate";
import {
  setButtonStyle,
  SnapOS2Styles,
} from "../UI/Shared/UIBuilders";

export type NavigationMarkerVisualState = "disabled" | "placing" | "executing";

const MARKER_VISIBILITY_DURATION_SECONDS = 0.18;
const VISIBILITY_ANIMATION_VERSION_KEY = "__navMarkerVisibilityVersion";

export class NavigationMarkerView {
  private readonly root: SceneObject;
  private readonly calibrationSceneVisual: SceneObject;
  private readonly screenTextParent: SceneObject | null;
  private readonly portalCircle: SceneObject;
  private readonly dots: SceneObject;
  private readonly confirmButtonObject: SceneObject;
  private readonly confirmButton: RoundButton;
  private readonly confirmVfx: SceneObject | null;
  private readonly cancelVfx: SceneObject | null;
  private readonly confirmLabel: Text;
  private readonly placeText: Text;
  private readonly arrow: SceneObject | null;
  private readonly portalBaseScale: vec3;
  private readonly rootBaseScale: vec3;
  private readonly calibrationLookAt: Component | null;
  private readonly circleAnimation: any;

  private _state: NavigationMarkerVisualState = "disabled";
  private _confirmEnabled = false;

  constructor(root: SceneObject) {
    this.root = root;
    this.calibrationSceneVisual = this._requireChild(
      this.root,
      "CalibrationSceneVisual",
    );
    this.screenTextParent = this._findChild(this.root, "ScreenTextParent");
    this.portalCircle = this._requireChild(this.root, "PortalCircle");
    this.dots = this._requireChild(this.root, "Dots");
    this.confirmButtonObject = this._requireChild(this.root, "ConfirmButton");
    this.confirmButton = this.confirmButtonObject.getComponent(
      RoundButton.getTypeName(),
    ) as RoundButton;
    this.confirmVfx = this._findChild(this.confirmButtonObject, "ButtonVFX_Confirm");
    this.cancelVfx = this._findChild(this.confirmButtonObject, "ButtonVFX_Cancel");
    this.confirmLabel = this._requireFirstText(this.confirmButtonObject);
    this.placeText = this._requireText(this.root, "PlaceText");
    this.arrow = this._findChild(this.root, "Arrow");
    this.portalBaseScale = this.portalCircle.getTransform().getLocalScale();
    this.rootBaseScale = this.root.getTransform().getLocalScale();
    this.calibrationLookAt = this.calibrationSceneVisual.getComponent(
      "Component.LookAtComponent",
    ) as Component | null;
    this.circleAnimation = this._findScriptComponent(
      this.portalCircle,
      "reset",
      "enableScanAnimation",
    );
    if (!this.confirmButton) {
      throw new Error(
        "NavigationMarkerView: SurfacePlacementMarker is missing ConfirmButton RoundButton",
      );
    }
    if (this.calibrationLookAt) {
      this.calibrationLookAt.enabled = false;
    }
    this._initializeHidden();
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
    return this.screenTextParent ?? this.calibrationSceneVisual;
  }

  public get rootSceneObject(): SceneObject {
    return this.root;
  }

  public get worldPosition(): vec3 {
    return this.root.getTransform().getWorldPosition();
  }

  public get worldRotation(): quat {
    return this.root.getTransform().getWorldRotation();
  }

  public setPose(position: vec3, rotation: quat): void {
    const transform = this.root.getTransform();
    transform.setWorldPosition(position);
  }

  public interpolatePose(
    desiredPosition: vec3,
    desiredRotation: quat,
    lerpSpeed: number,
  ): void {
    const transform = this.root.getTransform();
    transform.setWorldPosition(
      vec3.lerp(
        transform.getWorldPosition(),
        desiredPosition,
        getDeltaTime() * lerpSpeed,
      ),
    );
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

  public setConfirmActionEnabled(enabled: boolean): void {
    if (this._confirmEnabled === enabled) {
      return;
    }
    this._confirmEnabled = enabled;
    (this.confirmButton as any).enabled = enabled;
  }

  public showPlacing(): void {
    this._state = "placing";
    this.calibrationSceneVisual.enabled = true;
    if (this.calibrationLookAt) {
      this.calibrationLookAt.enabled = false;
    }
    this.portalCircle.enabled = true;
    this.portalCircle.getTransform().setLocalScale(this.portalBaseScale);
    this.dots.enabled = true;
    this.confirmButtonObject.enabled = true;
    this.setConfirmActionEnabled(true);
    this.placeText.getSceneObject().enabled = true;
    this.confirmLabel.text = "Confirm";
    setButtonStyle(this.confirmButton, SnapOS2Styles.Primary);
    this.resetCircleAnimation();
    this.setScanAnimationEnabled(false);
    this._setConfirmVfxState(true);
    if (this.arrow) {
      this.arrow.enabled = false;
    }
    this._setPortalSaturation(0);  // Desaturate during placing
    this._animateVisibility(true);
  }

  public showExecuting(): void {
    this._state = "executing";
    this.calibrationSceneVisual.enabled = true;
    if (this.calibrationLookAt) {
      this.calibrationLookAt.enabled = false;
    }
    this.portalCircle.enabled = true;
    this.portalCircle.getTransform().setLocalScale(this.portalBaseScale);
    this.dots.enabled = true;
    this.confirmButtonObject.enabled = true;
    this.setConfirmActionEnabled(true);
    this.placeText.getSceneObject().enabled = false;
    this.confirmLabel.text = "Cancel";
    setButtonStyle(this.confirmButton, SnapOS2Styles.Special);
    this.setScanAnimationEnabled(true);
    this._setConfirmVfxState(false);
    if (this.arrow) {
      this.arrow.enabled = true;
    }
    this._setPortalSaturation(1);  // Full saturation during execution
    this._animateVisibility(true);
  }

  public hide(): void {
    this._state = "disabled";
    this.placeText.getSceneObject().enabled = false;
    this.setScanAnimationEnabled(false);
    this._setConfirmVfxState(true, true);
    if (this.arrow) {
      this.arrow.enabled = false;
    }
    this._animateVisibility(false);
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

  private _requireText(root: SceneObject, objectName: string): Text {
    const sceneObject = this._requireChild(root, objectName);
    const text = sceneObject.getComponent("Component.Text") as Text;
    if (!text) {
      throw new Error(`NavigationMarkerView: Missing Text on ${objectName}`);
    }
    return text;
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

  private _setPortalSaturation(value: number): void {
    const visual = this.portalCircle.getComponent("Component.RenderMeshVisual") as RenderMeshVisual | null;
    if (!visual || !visual.mainMaterial) {
      return;
    }
    const material = visual.mainMaterial;
    const pass = material.mainPass;
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

  private _initializeHidden(): void {
    this.root.enabled = false;
    this.root.getTransform().setLocalScale(vec3.zero());
    this.placeText.getSceneObject().enabled = false;
    this.setScanAnimationEnabled(false);
    this._setConfirmVfxState(true, true);
    this._confirmEnabled = false;
    if (this.arrow) {
      this.arrow.enabled = false;
    }
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
