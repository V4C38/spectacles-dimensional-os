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
const CIRCLE_SCALE_ANIMATION_VERSION_KEY = "__navMarkerCircleScaleVersion";

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
  private readonly moveDirectionArrow: SceneObject | null;
  private readonly moveDirectionArrowBaseRotation: quat;
  private readonly portalBaseScale: vec3;
  private readonly rootBaseScale: vec3;
  private readonly calibrationLookAt: Component | null;
  private readonly circleAnimation: any;

  private _state: NavigationMarkerVisualState = "disabled";
  private _confirmEnabled = false;
  private _placementAnchor: SceneObject | null = null;
  private _preAnchorParent: SceneObject | null = null;

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
    this.moveDirectionArrow = this._findChild(this.portalCircle, "MoveDirectionArrow");
    this.moveDirectionArrowBaseRotation = this.moveDirectionArrow
      ? this.moveDirectionArrow.getTransform().getLocalRotation()
      : quat.quatIdentity();
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

  public get localPosition(): vec3 {
    return this.root.getTransform().getLocalPosition();
  }

  public get worldRotation(): quat {
    return this.root.getTransform().getWorldRotation();
  }

  public setMoveDirectionFromRotation(rotation: quat): void {
    const forward = rotation.multiplyVec3(vec3.right().uniformScale(-1));
    const distance = Math.sqrt(forward.x * forward.x + forward.z * forward.z);
    if (distance < 0.001) {
      return;
    }
    const fx = forward.x / distance;
    const fz = forward.z / distance;
    // The authored arrow faces -Z when yaw=0, so convert the robot forward
    // direction into a yaw whose zero heading points along -Z.
    this.setMoveDirectionYaw(Math.atan2(-fx, -fz));
  }

  public setMoveDirectionYaw(yawRadians: number): void {
    if (!this.moveDirectionArrow) {
      return;
    }
    // Compose q_yaw (Y-axis, world space) with the scene base rotation so the
    // arrow stays flat on the ground while rotating to point in the drag direction.
    // Lens Studio quat constructor is (w, x, y, z).
    // q_yaw = (cos(h), 0, sin(h), 0) for a Y-axis rotation by yawRadians.
    // q_result = q_yaw * q_base  (apply base tilt first, then yaw in world space)
    // The authored flat plane turns with the opposite yaw sign from the
    // drag-space heading we compute, so invert the final applied yaw here.
    const h = -yawRadians * 0.5;
    const cw = Math.cos(h);
    const sy = Math.sin(h);
    const b = this.moveDirectionArrowBaseRotation;
    this.moveDirectionArrow.getTransform().setLocalRotation(
      new quat(
        cw * b.w - sy * b.y,
        cw * b.x + sy * b.z,
        cw * b.y + sy * b.w,
        cw * b.z - sy * b.x,
      ),
    );
    this._syncMoveDirectionArrowVisibility();
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
      return;
    }
    transform.setWorldPosition(position);
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
      return;
    }
    transform.setWorldPosition(
      vec3.lerp(transform.getWorldPosition(), desiredPosition, alpha),
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
    this._setMoveDirectionArrowSpeed(0);
    this._syncMoveDirectionArrowVisibility();
    this._setPortalSaturation(0);  // Desaturate during placing
    this._animateVisibility(true);
    this._animateCircleScale(true);
  }

  public showExecuting(): void {
    this._state = "executing";
    this.calibrationSceneVisual.enabled = true;
    if (this.calibrationLookAt) {
      this.calibrationLookAt.enabled = false;
    }
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
    this._setMoveDirectionArrowSpeed(1);
    this._syncMoveDirectionArrowVisibility();
    this._setPortalSaturation(1);  // Full saturation during execution
    this._animateVisibility(true);
    this._animateCircleScale(false);
  }

  public hide(): void {
    this._state = "disabled";
    this.placeText.getSceneObject().enabled = false;
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
    this._animateVisibility(false);
  }

  public hideAndThen(callback: () => void): void {
    this._state = "disabled";
    this.placeText.getSceneObject().enabled = false;
    this.setScanAnimationEnabled(false);
    this._setConfirmVfxState(true, true);
    if (this.arrow) {
      this.arrow.enabled = false;
    }
    this._setMoveDirectionArrowSpeed(0);
    this._syncMoveDirectionArrowVisibility();
    this._nextCircleAnimationVersion();
    this.portalCircle.enabled = true;
    this.portalCircle.getTransform().setLocalScale(this.portalBaseScale);
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
    this._setMoveDirectionArrowSpeed(0);
    this._syncMoveDirectionArrowVisibility();
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
