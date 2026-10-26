import { ScrollWindow } from "SpectaclesUIKit.lspkg/Scripts/Components/ScrollWindow/ScrollWindow";
import { Slider } from "SpectaclesUIKit.lspkg/Scripts/Components/Slider/Slider";
import { createText, configurePanelText, COLOR_WHITE, FONT_CAPTION } from "./UIKit";

/** Native masked text and scrollbar, shared by conversation and diagnostics pages. */
export class NativeTextField {
  readonly root: SceneObject;
  readonly window: ScrollWindow;
  readonly text: Text;
  private value = "";

  constructor(parent: SceneObject, name: string, width: number, height: number, y: number, fontSize = FONT_CAPTION) {
    this.root = global.scene.createSceneObject(name);
    this.root.setParent(parent);
    this.root.getTransform().setLocalPosition(new vec3(0, y, 2));
    this.window = this.root.createComponent(ScrollWindow.getTypeName()) as ScrollWindow;
    this.window.windowSize = new vec2(width, height);
    this.window.scrollDimensions = new vec2(width, height);
    this.window.vertical = true;
    this.window.horizontal = false;
    this.window.initialize();
    // ScreenTransform owns the persistent position after native initialization.
    (this.root.getComponent("Component.ScreenTransform") as ScreenTransform).position = new vec3(0, y, 2);
    const content = global.scene.createSceneObject(`${name}Content`);
    this.text = createText({ parent: content, name: `${name}Text`, text: "", fontSize,
      color: COLOR_WHITE, horizontalAlignment: HorizontalAlignment.Left,
      worldSpaceRect: Rect.create(-width / 2, width / 2 - 4.9, -height / 2, height / 2) });
    this.text.verticalAlignment = VerticalAlignment.Top;
    configurePanelText(this.text);
    this.window.addObject(content);
    content.getTransform().setLocalPosition(vec3.zero());
    this.text.getSceneObject().getTransform().setLocalPosition(vec3.zero());
    const barRoot = global.scene.createSceneObject(`${name}ScrollBar`);
    barRoot.setParent(parent);
    barRoot.getTransform().setLocalPosition(new vec3(width / 2 - 1.75, y, 2));
    // SUK ScrollBar requires an authored input during construction. The public
    // Slider primitive supports runtime creation and drives the same native window.
    const bar = barRoot.createComponent(Slider.getTypeName()) as Slider;
    barRoot.getTransform().setLocalRotation(quat.angleAxis(Math.PI / 2, vec3.forward()));
    bar.size = new vec3(height, 0.84, 0.5);
    bar.renderOrder = 12;
    bar.knobSize = new vec2(2.5, 1.2);
    let syncing = false;
    bar.onValueChange.add(value => {
      if (!syncing) this.window.scrollPositionNormalized = new vec2(0, value * 2 - 1);
    });
    const sync = () => {
      syncing = true;
      const normalized = this.window.scrollPositionNormalized.y;
      bar.currentValue = Number.isFinite(normalized) ? Math.max(0, Math.min(1, (normalized + 1) / 2)) : 1;
      barRoot.enabled = this.window.scrollDimensions.y > this.window.windowSize.y;
      syncing = false;
    };
    this.window.onScrollPositionUpdated.add(sync);
    this.window.onScrollDimensionsUpdated.add(sync);
    sync();
  }

  setText(value: string, followEnd = false): void {
    if (value === this.value) return;
    this.value = value;
    this.text.text = value;
    const size = this.window.windowSize;
    // Measure native wrapping rather than estimating line count from character count.
    this.text.worldSpaceRect = Rect.create(-size.x / 2, size.x / 2 - 4.9, -size.y / 2, size.y / 2);
    const bounds = this.text.getBoundingBox();
    const height = Math.max(size.y, bounds.getSize().y);
    this.text.worldSpaceRect = Rect.create(-size.x / 2, size.x / 2 - 4.9, -height / 2, height / 2);
    this.window.scrollDimensions = new vec2(size.x, height);
    this.window.scrollPositionNormalized = new vec2(0, followEnd ? -1 : 1);
  }
}
