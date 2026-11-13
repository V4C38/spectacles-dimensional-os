import { Slider } from "SpectaclesUIKit.lspkg/Scripts/Components/Slider/Slider";
import type { ManipulationController } from "DimOSARClient.lspkg/Scripts/DimOSARClient/manipulation/ManipulationController";
import { ARM_PANEL_STYLE,PANEL_PIN_SEGMENTS,PANEL_SCAN_SEGMENTS } from "DimOSARClient.lspkg/Scripts/DimOSARClient/presentation/PanelFrameStyle";
import { COLOR_WHITE,createIconButton,createText,panelButtonLayer,SnapOS2Styles,uiMaterialLayer,type IconButtonResult } from "../presentation/UIKit";
import { WorldMeshRenderer } from "../presentation/WorldMeshRenderer";
import { SpecsArmPanelPresenter } from "./SpecsArmPanelPresenter";

/** Native controls and their registrations; interaction command policy stays in Core. */
export class ArmControlsView {
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
