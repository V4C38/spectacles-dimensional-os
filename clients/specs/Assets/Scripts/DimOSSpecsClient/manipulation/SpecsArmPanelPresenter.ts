import { Frame } from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame";
import { ARM_PANEL_STYLE, clampArmPanelScale } from "../../DimOSARClient/presentation/PanelFrameStyle";
import { configureControlPanelFrame, isFrameInitialized } from "../presentation/UIKit";

/** Native Frame owns manipulation; this presenter owns attached versus pinned placement. */
export class SpecsArmPanelPresenter {
  readonly root: SceneObject;
  readonly frame: Frame;
  readonly content: SceneObject;
  private pinned = false;
  private configuring = false;
  private configured = false;
  private height = -1;
  private readonly subscriptions: (() => void)[] = [];

  constructor(parent: SceneObject) {
    this.root = global.scene.createSceneObject("ArmControlFrame"); this.root.setParent(parent);
    this.frame = this.root.createComponent(Frame.getTypeName()) as Frame;
    // Disable SDK hover hiding before initialize schedules its initial opacity tween.
    this.frame.autoShowHide = false;
    // Native initialization creates enabled SDK children and emits scaling events synchronously.
    this.frame.initialize();
    this.frame.showCloseButton = false; this.frame.showFollowButton = false;
    this.content = global.scene.createSceneObject("ManipulationMenu"); this.content.setParent(this.frame.content);
    this.configure(); this.reset();
    this.root.enabled = false;
    this.subscriptions.push(this.frame.onInitialized.add(() => this.configure()));
    this.subscriptions.push(this.frame.onTranslationStart.add(() => { if (!this.configuring) this.pinned = true; }));
    this.subscriptions.push(this.frame.onScalingUpdate.add(() => { if (!this.configuring) { this.pinned = true; this.clamp(); } }));
  }
  private configure(): void {
    if (this.configured || !isFrameInitialized(this.frame)) return;
    this.configuring = true;
    configureControlPanelFrame(this.frame, { width: ARM_PANEL_STYLE.widthM, height: .228 }, true);
    this.frame.roundedRectangle.cornerRadius = ARM_PANEL_STYLE.cornerM * 100;
    this.frame.showCloseButton = false; this.frame.showFollowButton = false;
    this.frame.onlyInteractOnBorder = true; this.frame.allowTranslation = true; this.frame.allowScaling = true;
    this.frame.setUseFollow(false); this.frame.setFollowing(false);
    this.frame.content.getTransform().setLocalScale(vec3.one());
    this.configured = true; this.configuring = false;
  }
  reset(): void {
    this.configuring = true;
    this.pinned = false; this.height = -1;
    this.root.getTransform().setLocalScale(vec3.one().uniformScale(ARM_PANEL_STYLE.defaultScale * .75));
    this.frame.content.getTransform().setLocalScale(vec3.one());
    this.configuring = false;
  }
  update(base: SceneObject | null, camera: SceneObject, height: number): void {
    this.configure(); this.root.enabled = !!base && this.configured;
    if (!base || !this.configured) return;
    this.configuring = true;
    if (this.height !== height) {
      this.frame.autoScaleContent = false;
      this.frame.innerSize = new vec2(ARM_PANEL_STYLE.widthM * 100 - this.frame.border * 2 - this.frame.padding.x,
        height * 100 - this.frame.border * 2 - this.frame.padding.y);
      this.content.getTransform().setLocalPosition(new vec3(0, height * 50, 0));
      this.height = height;
      this.frame.autoScaleContent = true;
    }
    if (!this.pinned) {
      const q = camera.getTransform().getWorldRotation();
      const scale = ARM_PANEL_STYLE.defaultScale * .75;
      this.root.getTransform().setWorldPosition(base.getTransform().getWorldPosition().add(q.multiplyVec3(new vec3(0, -13 - height * 50 * scale, 0))));
      this.root.getTransform().setWorldRotation(q);
    }
    this.configuring = false;
  }
  private clamp(): void {
    const scale = this.content.getTransform().getWorldScale().x;
    if (!(scale > 0)) return;
    const target = clampArmPanelScale(scale / .75) * .75;
    if (Math.abs(target - scale) < 1e-6) return;
    this.configuring = true;
    const ratio = target / scale, size = this.frame.innerSize;
    this.frame.autoScaleContent = false;
    this.frame.innerSize = new vec2(size.x * ratio, size.y * ratio);
    const content = this.frame.content.getTransform(); content.setLocalScale(content.getLocalScale().uniformScale(ratio));
    this.frame.autoScaleContent = true; this.configuring = false;
  }
  dispose(): void { for (const unsubscribe of this.subscriptions) unsubscribe(); this.root.destroy(); }
}
