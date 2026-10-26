import { DimOSSpecsClient } from "../Scripts/DimOSSpecsClient/DimOSSpecsClient";
@component
export class ReviewScenario extends BaseScriptComponent {
  @input
  startDelayS = 5;
  private elapsed = 0;
  private captured = false;
  onAwake(): void { this.createEvent("OnStartEvent").bind(() => this.createEvent("UpdateEvent").bind(() => this.tick())); }
  private tick(): void {
    this.elapsed += Math.min(0.1, getDeltaTime());
    if (this.elapsed < this.startDelayS)
      return;
    if (this.captured) {
      if (this.elapsed > this.startDelayS + 4) {
        print(`SPECS_REVIEW ${JSON.stringify({ type: "complete", passed: true, unixMs: Date.now() })}`);
        this.enabled = false;
      }
      return;
    }
    this.captured = true;
    let root: any = null;
    const find = (object: SceneObject) => {
      root ||= object.getComponent(DimOSSpecsClient.getTypeName());
      for (let i = 0; i < object.getChildrenCount(); i++)
        find(object.getChild(i));
    };
    for (let i = 0; i < global.scene.getRootObjectsCount(); i++)
      find(global.scene.getRootObject(i));
    if (!root)
      throw new Error("Production root missing");
    root.uiPresenter.setupWizardController.invalidatePending();
    const rows: any[] = [];
    const texts = (object: SceneObject, path: string) => {
      const text = object.getComponent("Component.Text") as Text;
      if (text && ["dimOS AR", "Setup Wizard"].includes(text.text))
        rows.push({ text: text.text, path,
          localPosition: object.getTransform().getLocalPosition().toString(), worldPosition: object.getTransform().getWorldPosition().toString(),
          size: text.size, lineSpacing: text.lineSpacing, verticalAlignment: text.verticalAlignment,
          horizontalAlignment: text.horizontalAlignment, fontName: text.font?.name ?? "native-default",
          box: text.getBoundingBox().toString(), worldSpaceRect: text.worldSpaceRect.toString() });
      for (let i = 0; i < object.getChildrenCount(); i++)
        texts(object.getChild(i), path + "/" + object.getChild(i).name);
    };
    texts(root.uiPresenter.setupWizardPanel, "Setup");
    print(`SPECS_HEADER_METRICS ${JSON.stringify(rows)}`);
    print(`SPECS_REVIEW ${JSON.stringify({ type: "result", name: "header-metrics", passed: rows.length >= 2, unixMs: Date.now() })}`);
    print(`SPECS_REVIEW ${JSON.stringify({ type: "scene", name: "header_baseline", unixMs: Date.now() })}`);
  }
}
