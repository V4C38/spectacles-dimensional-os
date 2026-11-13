import { Frame } from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame";
import { ARM_PANEL_STYLE, clampArmPanelScale, PANEL_PIN_SEGMENTS, PANEL_SCAN_SEGMENTS } from "DimOSARClient.lspkg/Scripts/DimOSARClient/presentation/ControlPanelPresentation";
import { configureControlPanelFrame, isFrameInitialized, COLOR_WHITE, createIconButton, createText, panelButtonLayer, SnapOS2Styles, uiMaterialLayer, type IconButtonResult } from "../presentation/UIKit";
import { Slider } from "SpectaclesUIKit.lspkg/Scripts/Components/Slider/Slider";
import type { ManipulationController } from "DimOSARClient.lspkg/Scripts/DimOSARClient/manipulation/ManipulationController";


import { WorldMeshRenderer } from "../presentation/WorldMeshRenderer";

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


/** Native controls and their registrations; interaction command policy stays in Core. */
export class ManipulationControlsView {
  readonly panelPresenter: SpecsArmPanelPresenter;
  readonly panel: SceneObject;
  readonly previewMenu: SceneObject;
  readonly gripper: IconButtonResult;
  readonly buttons = new Map<string, IconButtonResult>();
  readonly speed: Slider;
  readonly speedLabel: Text;
  readonly panelTitle: Text;
  readonly rescan: IconButtonResult;
  readonly scanIcon: WorldMeshRenderer;
  syncingSpeed = false;
  private disposed = false;
  private readonly subscriptions: (() => void)[] = [];

  constructor(parent: SceneObject, private readonly core: ManipulationController,
    enabled: () => boolean, hover: (key: string, active: boolean) => void, recalibrate: () => void) {
    this.panelPresenter = new SpecsArmPanelPresenter(parent);
    this.panel = this.panelPresenter.content;
    this.previewMenu = this.node(parent, "PreviewMenu");
    const add = (key: string, text: string, action: () => void, style = SnapOS2Styles.Secondary) => {
      const button = createIconButton(key === "plan" || key === "execute" ? this.previewMenu : this.panel, key, text, key === "estop" ? 20 : key === "plan" || key === "execute" ? 9.5 : key === "reset" || key === "stop" ? 9.2 : 14, ARM_PANEL_STYLE.buttonHeightM*100, vec3.zero(), style);
      this.subscriptions.push(button.button.onTriggerDown.add(() => { if ((enabled() || key === "estop" || key === "stop") && !button.button.inactive) action(); }));
      button.labelText.size = ARM_PANEL_STYLE.buttonFontM * 100 * 32 / 0.69492703;
      if (key === "plan" || key === "execute") {
        button.sceneObject.getTransform().setLocalPosition(new vec3(0, key === "plan" ? 3.9 : 0, 0));
        this.subscriptions.push(button.button.interactable.onHoverEnter.add(() => hover(key, true)));
        this.subscriptions.push(button.button.interactable.onHoverExit.add(() => hover(key, false)));
      }
      this.buttons.set(key, button);
    };
    add("plan", "Preview", () => core.action("plan"));
    add("execute", "Execute", () => core.action("execute"), SnapOS2Styles.Primary);
    add("reset", "Reset", () => core.action("reset"));
    add("stop", "Stop", () => core.action("stop"));
    add("estop", "E-stop", () => { if (core.interaction.snapshot().stopped) core.action("resume"); else core.action("estop"); }, SnapOS2Styles.Special);
    const speedRoot = this.node(this.panel, "ManipulationSpeed");
    this.speed = speedRoot.createComponent(Slider.getTypeName()) as Slider;
    this.speed.size = new vec3(14, 2.25, 0.5); this.speed.knobSize = new vec2(2.4, 2.4);
    this.speedLabel = createText({ parent: speedRoot, name: "SpeedLabel", text: "", fontSize: 0.011 * 100 * 32 / 0.69492703, color: COLOR_WHITE,
      position: new vec3(0, 2, 0), horizontalAlignment: HorizontalAlignment.Center, worldSpaceRect: Rect.create(-12, 12, -2, 2) });
    this.subscriptions.push(this.speed.onValueChange.add(value => {
      if (!this.syncingSpeed && core.interaction.snapshot().canManipulate) core.interaction.setSpeedScale(0.05 + Math.max(0, Math.min(1, value)) * 0.95);
    }));
    this.gripper = createIconButton(parent, "Gripper", "Open", 9.5, 3.2, vec3.zero());
    this.subscriptions.push(this.gripper.button.interactable.onHoverEnter.add(() => hover("gripper", true)));
    this.subscriptions.push(this.gripper.button.interactable.onHoverExit.add(() => hover("gripper", false)));
    const pin = createIconButton(this.panel,"Pin to robot","",ARM_PANEL_STYLE.pinSizeM*100,ARM_PANEL_STYLE.pinSizeM*100,
      new vec3(ARM_PANEL_STYLE.pinXM*100,ARM_PANEL_STYLE.pinYM*100,.8),SnapOS2Styles.Secondary);
    panelButtonLayer(pin);
    this.subscriptions.push(pin.button.onTriggerUp.add(() => this.panelPresenter.reset()));
    this.panelTitle = createText({parent: this.panel, name: "ArmPanelTitle", text: "Arm", fontSize: 1.3 * 32 / .69492703, color: COLOR_WHITE,
      position: new vec3(-9.6, ARM_PANEL_STYLE.pinYM*100, 1.4), horizontalAlignment: HorizontalAlignment.Left, worldSpaceRect: Rect.create(0,12,-1.6,1.6)});
    const rescan = this.rescan = createIconButton(this.panel, "Recalibrate", "", ARM_PANEL_STYLE.pinSizeM*100, ARM_PANEL_STYLE.pinSizeM*100, new vec3((ARM_PANEL_STYLE.pinXM-.039)*100, ARM_PANEL_STYLE.pinYM*100,.8));
    panelButtonLayer(rescan);
    this.subscriptions.push(rescan.button.onTriggerUp.add(() => { const intent = this.core.interaction.snapshot(); if (!intent.executing && !intent.dragging && !intent.resetting) recalibrate(); }));
    const drawIcon = (segments: readonly (readonly [number,number])[], x: number) => {
    const icon = new WorldMeshRenderer(this.panel,"PinIcon");
    icon.object.getTransform().setLocalPosition(new vec3(x*100,ARM_PANEL_STYLE.pinYM*100,1.4));
    uiMaterialLayer(icon.visual, 66);
    const positions:number[]=[], indices:number[]=[];
    for(let i=0;i<segments.length;i+=2){
      const a=segments[i],b=segments[i+1],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),nx=-dy/length*ARM_PANEL_STYLE.iconStrokeM*50,ny=dx/length*ARM_PANEL_STYLE.iconStrokeM*50,k=positions.length/3;
      positions.push(a[0]*100+nx,a[1]*100+ny,.2,a[0]*100-nx,a[1]*100-ny,.2,b[0]*100+nx,b[1]*100+ny,.2,b[0]*100-nx,b[1]*100-ny,.2);
      indices.push(k,k+1,k+2,k+2,k+1,k+3);
    }
    const xs = positions.filter((_, i) => i % 3 === 0), ys = positions.filter((_, i) => i % 3 === 1);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    for (let i = 0; i < positions.length; i += 3) { positions[i] -= cx; positions[i+1] -= cy; }
    icon.triangles(positions,indices,[1,1,1,1]);
    return icon;
    };
    drawIcon(PANEL_PIN_SEGMENTS, ARM_PANEL_STYLE.pinXM);
    this.scanIcon = drawIcon(PANEL_SCAN_SEGMENTS, ARM_PANEL_STYLE.pinXM-.039);
  }

  private node(parent: SceneObject, name: string): SceneObject {
    const object = global.scene.createSceneObject(name); object.setParent(parent); return object;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe();
    this.panelPresenter.dispose(); this.previewMenu.destroy(); this.gripper.sceneObject.destroy();
  }
}
