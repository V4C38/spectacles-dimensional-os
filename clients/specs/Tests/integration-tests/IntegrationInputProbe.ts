import { DimOSSpecsClient } from "../Scripts/DimOSSpecsClient/DimOSSpecsClient";
import { IntegrationInput } from "./IntegrationInput";
import { getFrameComponent } from "../Scripts/DimOSSpecsClient/presentation/UIKit";
@component
export class ReviewScenario extends BaseScriptComponent {
  @input
  startDelayS = 5;
  private elapsed = 0;
  private input: IntegrationInput | null = null;
  private root: any;
  private start: vec3 | null = null;
  private phase = -1;
  private failed = false;
  private emit(v: Record<string, unknown>): void { print(`SPECS_REVIEW ${JSON.stringify({ ...v, unixMs: Date.now() })}`); }
  private check(name: string, passed: boolean): void { this.failed ||= !passed; this.emit({ type: "result", name, passed }); }
  onAwake(): void { this.createEvent("OnStartEvent").bind(() => this.createEvent("UpdateEvent").bind(() => this.tick())); }
  private tick(): void {
    this.elapsed += Math.min(0.1, getDeltaTime());
    if (!this.root) {
      if (this.elapsed < this.startDelayS)
        return;
      const find = (o: SceneObject): any => { const r = o.getComponent(DimOSSpecsClient.getTypeName()); if (r)
        return r; for (let i = 0; i < o.getChildrenCount(); i++) {
        const r = find(o.getChild(i));
        if (r)
          return r;
      } return null; };
      for (let i = 0; i < global.scene.getRootObjectsCount(); i++) {
        this.root = find(global.scene.getRootObject(i));
        if (this.root)
          break;
      }
      this.input = new IntegrationInput();
      this.root.transport.connect = () => { };
      this.root.transport.close = () => { };
      this.root.uiPresenter.setupWizardController.invalidatePending();
      this.root.uiPresenter.finishWizard();
      this.elapsed = 3;
    }
    const ui = this.root.uiPresenter, frame: any = getFrameComponent(ui.mainUIFrame), input = this.input!;
    if (this.phase === 1) {
      const offset = new vec3(Math.min(12, this.elapsed * 8), 0, 0);
      input.ray(this.root.cameraObject.getTransform().getWorldPosition().add(offset), this.start!.add(offset), frame._interactable);
      input.update();
    }
    if (this.elapsed < 3)
      return;
    this.elapsed = 0;
    this.phase++;
    if (this.phase === 0) {
      frame.setFollowing(false);
      ui.mainUIFrame.enabled = true;
      this.start = ui.mainUIFrame.getTransform().getWorldPosition();
      const hit = ui.mainUIFrame.getTransform().getWorldTransform().multiplyPoint(new vec3(44, 0, 0));
      input.ray(this.root.cameraObject.getTransform().getWorldPosition(), hit, frame._interactable);
      input.hover(frame._interactable);
      this.emit({ type: "scene", name: "native-grab-hover" });
    }
    else if (this.phase === 1) {
      input.start();
      this.emit({ type: "scene", name: "native-grab-move" });
    }
    else if (this.phase === 2) {
      input.end();
      input.unhover();
      this.check("native-frame-moved", ui.mainUIFrame.getTransform().getWorldPosition().distance(this.start!) > 2);
      this.check("native-frame-pinned", !frame.following);
      this.emit({ type: "scene", name: "native-grab-release" });
    }
    else {
      input.restore();
      this.emit({ type: "complete", passed: !this.failed });
      this.enabled = false;
    }
  }
}
