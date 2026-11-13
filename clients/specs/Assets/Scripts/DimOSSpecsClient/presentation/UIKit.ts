import { PrimaryNeutralGradients } from "SpectaclesUIKit.lspkg/Scripts/Themes/SnapOS-2.0/Gradients/PrimaryNeutralGradients";
import { RoundedRectangle } from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle";
import { CONTROL_PANEL_LAYOUT, CONTROL_PANEL_TYPE, type StatusTone } from "DimOSARClient.lspkg/Scripts/DimOSARClient/presentation/ControlPanelPresentation";
// ================================================================
/**
 * UIKit — merged constants, primitives, scene-lookup helpers, and
 * SnapOS2 button/text factory helpers.
 */
// ================================================================

import { CapsuleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/CapsuleButton";
import { RectangleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton";
import { RoundButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton";
import { Frame } from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame";
import { TextInputField } from "SpectaclesUIKit.lspkg/Scripts/Components/TextInputField/TextInputField";
import { SnapOS2Styles } from "SpectaclesUIKit.lspkg/Scripts/Themes/SnapOS-2.0/SnapOS2";
import { RoundedRectangleVisual } from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangleVisual";


export { SnapOS2Styles };

// ── Constants ──────────────────────────────────────────────────

export const FONT_CAPTION = 42;
const FONT_BUTTON = 44;

export const COLOR_WHITE = new vec4(1, 1, 1, 1);
export const COLOR_MUTED = new vec4(1, 1, 1, 0.55);
export const COLOR_SUCCESS = new vec4(0, 1, 0, 1);
export const COLOR_ERROR = new vec4(1, 0, 0, 1);
export const COLOR_WARN = new vec4(1, 0.85, 0, 1);

export function statusToneColor(tone: StatusTone): vec4 {
  switch (tone) {
    case "error":
      return COLOR_ERROR;
    case "warn":
      return COLOR_WARN;
    case "success":
      return COLOR_SUCCESS;
    case "neutral":
      return COLOR_WHITE;
    case "muted":
      return COLOR_MUTED;
  }
}

// ── Frame metrics ──────────────────────────────────────────────

export function getFrameComponent(panel: SceneObject): Frame | null {
  const frame = panel.getComponent(Frame.getTypeName()) as Frame;
  return frame ?? null;
}

/** True once Frame.initialize() has finished wiring interaction and follow. */
export function isFrameInitialized(frame: Frame | null): boolean {
  if (!frame?.frameObject || !frame.content || !frame.transform) {
    return false;
  }
  if (frame.smoothFollow !== null) {
    return true;
  }
  // Frames without built-in follow finish init once hover handling is wired.
  return frame.hoverBehavior != null && !frame.showFollowButton;
}

export function findChildRecursive(root: SceneObject, name: string): SceneObject | null {
  for (let i = 0; i < root.getChildrenCount(); i++) {
    const child = root.getChild(i);
    if (child.name === name) return child;
    const nested = findChildRecursive(child, name);
    if (nested) return nested;
  }
  return null;
}

// ── Button helpers ────────────────────────────────────────────

type StyleableButton = any;
type ButtonComponent = RectangleButton | RoundButton | CapsuleButton;

function assignButtonStyle(btn: any, style: string): void {
  (btn as StyleableButton)._style = style;
}

export function setButtonStyle(btn: ButtonComponent | null, style: string): void {
  if (!btn) return;
  if (btn.style !== style) {
    const previous = btn.visual as RoundedRectangleVisual | undefined;
    assignButtonStyle(btn, style);
    if (previous) {
      const pass = previous.renderMeshVisual.mainPass;
      const depthTest = pass.depthTest, depthWrite = pass.depthWrite;
      const visual = new RoundedRectangleVisual({
        sceneObject: btn.getSceneObject(),
        style: { visualElementType: btn.typeString, style },
        transparent: style === SnapOS2Styles.Ghost,
      });
      visual.cornerRadius = previous.cornerRadius;
      // The public setter releases only the old visual and restores current hover/press state.
      // Reinitializing Element would allocate more colliders/state machines and listeners.
      btn.visual = visual;
      visual.renderMeshVisual.setRenderOrder(btn.renderOrder);
      visual.renderMeshVisual.mainPass.depthTest = depthTest;
      visual.renderMeshVisual.mainPass.depthWrite = depthWrite;
    }
  }
}

/** Presentation follows the model; these are ordinary buttons, not SUK toggles. */
export function setButtonSelected(btn: ButtonComponent, selected: boolean): void {
  setButtonStyle(btn, selected ? SnapOS2Styles.Primary : SnapOS2Styles.Secondary);
}

export function setButtonEnabled(btn: RectangleButton | RoundButton | CapsuleButton | null, enabled: boolean): void {
  if (!btn) return;
  btn.enabled = true;
  btn.inactive = !enabled;
  setButtonStyle(btn, btn.style);
}

export function configureWorldText(text: Text): void {
  text.depthTest = false;
  text.twoSided = true;
  text.verticalAlignment = VerticalAlignment.Center;
  text.horizontalOverflow = HorizontalOverflow.Wrap;
  text.verticalOverflow = VerticalOverflow.Overflow;
  text.lineSpacing = 0.92;
}

export interface CreateTextOptions {
  parent: SceneObject;
  name: string;
  text?: string;
  fontSize?: number;
  color?: vec4;
  position?: vec3;
  worldSpaceRect?: Rect;
  horizontalAlignment?: HorizontalAlignment;
}

export function createText(opts: CreateTextOptions): Text {
  const obj = global.scene.createSceneObject(opts.name);
  obj.setParent(opts.parent);
  if (opts.position) obj.getTransform().setLocalPosition(opts.position);
  const text = obj.createComponent("Text") as Text;
  if (opts.text !== undefined) text.text = opts.text;
  if (opts.fontSize !== undefined) text.size = opts.fontSize;
  if (opts.color) text.textFill.color = opts.color;
  if (opts.horizontalAlignment !== undefined) text.horizontalAlignment = opts.horizontalAlignment;
  if (opts.worldSpaceRect) text.worldSpaceRect = opts.worldSpaceRect;
  configureWorldText(text);
  return text;
}

export interface IconButtonResult {
  sceneObject: SceneObject;
  button: CapsuleButton;
  labelText: Text;
}

export function createIconButton(
  parent: SceneObject,
  name: string,
  label: string,
  width: number,
  height: number,
  position: vec3,
  style: string = SnapOS2Styles.Secondary,
): IconButtonResult {
  const btnObj = global.scene.createSceneObject(name);
  btnObj.setParent(parent);
  btnObj.getTransform().setLocalPosition(position);
  const btn = btnObj.createComponent(CapsuleButton.getTypeName()) as CapsuleButton;
  btn.size = new vec3(width, height, 0.5);
  assignButtonStyle(btn, style);
  btn.initialize();
  const labelText = createText({
    parent: btnObj,
    name: `${name}Label`,
    text: label,
    fontSize: FONT_BUTTON,
    color: COLOR_WHITE,
    position: new vec3(0, 0, 2),
    horizontalAlignment: HorizontalAlignment.Center,
    worldSpaceRect: Rect.create(-width / 2 + 0.3, width / 2 - 0.3, -height / 2, height / 2),
  });
  return { sceneObject: btnObj, button: btn, labelText };
}

function bindTextInputAlignment(field: TextInputField, alignment: HorizontalAlignment): void {
  const apply = (): void => {
    field.textComponent.horizontalAlignment = alignment;
  };
  field.onTextChanged.add(apply);
  apply();
}

export function createTextInput(
  parent: SceneObject,
  name: string,
  width: number,
  height: number,
  position: vec3,
  fontSize?: number,
  horizontalAlignment?: HorizontalAlignment,
): TextInputField {
  const obj = global.scene.createSceneObject(name);
  obj.setParent(parent);
  obj.getTransform().setLocalPosition(position);
  const field = obj.createComponent(TextInputField.getTypeName()) as TextInputField;
  field.size = new vec3(width, height, 0.5);
  if (fontSize !== undefined) field.fontSize = fontSize;
  if (horizontalAlignment !== undefined) bindTextInputAlignment(field, horizontalAlignment);
  return field;
}

/** Standalone SUK surface: direct primitive setters do not depend on an Element's visual-state loop. */
export function createRoundedSurface(parent: SceneObject, name: string, width: number, height: number,
  position: vec3, color: vec4, radius = 0.96, renderOrder?: number): RoundedRectangle {
  const object = global.scene.createSceneObject(name); object.setParent(parent);
  object.getTransform().setLocalPosition(position);
  const rectangle = object.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle;
  rectangle.initialize(); rectangle.size = new vec2(width, height);
  rectangle.cornerRadius = radius; rectangle.gradient = false; rectangle.useTexture = false; rectangle.border = false;
  rectangle.backgroundColor = color;
  rectangle.renderMeshVisual.mainPass.blendMode = BlendMode.PremultipliedAlphaAuto;
  rectangle.renderMeshVisual.mainPass.colorMask = new vec4b(true, true, true, true);
  if (renderOrder !== undefined) {
    rectangle.renderOrder = renderOrder;
    uiMaterialLayer(rectangle.renderMeshVisual, renderOrder);
  }
  return rectangle;
}

// SUK TextStylePresets.convert516Size documents this 5.15 system-font conversion:
// line-cell height = Text.size / 32; font em = 0.69492703 * line-cell height.
// getBoundingBox() returns the line cell, so treating it as em makes glyphs ~30% too small.
const SYSTEM_FONT_EM_PER_LINE = 0.69492703;
/** Convert WebXR font em height to Lens Studio 5.15 system-font size. */
export function panelFontSize(dp: number, label = true): number {
  return dp * CONTROL_PANEL_TYPE.dpToMetres * (label ? CONTROL_PANEL_TYPE.labelScale : 1) * 100 * 32 / SYSTEM_FONT_EM_PER_LINE;
}
export function uiMaterialLayer(visual: RenderMeshVisual, order: number): void {
  visual.setRenderOrder(order);
  visual.mainPass.depthTest = false;
  visual.mainPass.depthWrite = false;
}
const scalableFrames = new WeakSet<Frame>();

export function configureControlPanelFrame(frame: Frame, size: {width: number; height: number} = {width: CONTROL_PANEL_LAYOUT.width, height: CONTROL_PANEL_LAYOUT.height}, scalable = false): void {
  frame.autoShowHide = false;
  frame.autoScaleContent = false;
  frame.content.getTransform().setLocalScale(vec3.one());
  // SUK's innerSize excludes its border and padding; WebXR's dimensions include them.
  frame.innerSize = new vec2(size.width * 100 - frame.border * 2 - frame.padding.x,
    size.height * 100 - frame.border * 2 - frame.padding.y);
  frame.allowScaling = scalable; frame.allowTranslation = true;
  frame.onlyInteractOnBorder = true; frame.grabZoneOnly = false;
  frame.roundedRectangle.cornerRadius = CONTROL_PANEL_LAYOUT.cornerRadius * 100;
  frame.roundedRectangle.renderOrder = 10;
  uiMaterialLayer(frame.roundedRectangle.renderMeshVisual, 10);
  frame.autoScaleContent = scalable;
  if (scalable && !scalableFrames.has(frame)) {
    scalableFrames.add(frame);
    let clamping = false;
    frame.onScalingUpdate.add(() => {
      if (clamping) return;
      const content = frame.content.getTransform(), scale = content.getLocalScale().x;
      if (!(scale > 0)) return;
      const target = Math.max(.75, Math.min(2, scale));
      if (Math.abs(target-scale)<1e-6) return;
      clamping = true;
      const ratio = target/scale, inner = frame.innerSize;
      frame.autoScaleContent = false;
      frame.innerSize = new vec2(inner.x*ratio,inner.y*ratio);
      content.setLocalScale(content.getLocalScale().uniformScale(ratio));
      frame.autoScaleContent = true;
      clamping = false;
    });
  }
  // Match WebXR's outer glass surface: later world labels must stay behind the panel.
  frame.roundedRectangle.renderMeshVisual.mainPass.depthTest = true;
  frame.roundedRectangle.renderMeshVisual.mainPass.depthWrite = true;
}
export function panelButtonLayer(result: IconButtonResult, occludeWorld = false): void {
  result.button.renderOrder = 12;
  uiMaterialLayer((result.button.visual as RoundedRectangleVisual).renderMeshVisual, 12);
  if (occludeWorld) {
    const pass = (result.button.visual as RoundedRectangleVisual).renderMeshVisual.mainPass;
    pass.depthTest = true; pass.depthWrite = true;
  }
  configurePanelText(result.labelText);
  result.labelText.size = panelFontSize(CONTROL_PANEL_TYPE.buttonDp, false);
}

/** Thin policy adapter: Frame owns follow, damping, billboarding and grabbing. */
export function setPanelFollowing(panel: SceneObject, enabled: boolean, visibleScale: number): void {
  const frame = getFrameComponent(panel);
  if (!isFrameInitialized(frame)) return;
  frame!.setUseFollow(true);
  frame!.setFollowing(enabled);
  // Native resize() expects visible centimetres; Frame normally supplies unscaled size.
  // Our fixed-size frame never resizes interactively, so set this after final sizing.
  frame!.smoothFollow?.resize(frame!.totalSize.x * visibleScale);
}

/** Initial placement only; subsequent movement and follow belong to SUK Frame. */
export function placePanelInFront(panel: SceneObject, camera: SceneObject, offsetY = 0): void {
  const head = camera.getTransform(), transform = panel.getTransform();
  const eye = head.getWorldPosition();
  const component = camera.getComponent("Component.Camera") as Camera | null;
  // Preview's viewer pose can differ from the authored camera transform.
  const projected = component?.screenSpaceToWorldSpace(new vec2(0.5, 0.5), Math.max(0, 90 - component.near));
  const near = component?.screenSpaceToWorldSpace(new vec2(0.5, 0.5), 0);
  const position = (projected ?? eye.add(head.getWorldRotation().multiplyVec3(new vec3(0, 0, -90)))).add(new vec3(0, offsetY, 0));
  transform.setWorldPosition(position);
  transform.setWorldRotation(quat.lookAt((near ?? eye).sub(position).normalize(), vec3.up()));
}

/** Match WebXR Inter/Troika's normal line height while retaining the native font. */
export function configurePanelText(text: Text): void {
  text.sizeToFit = false;
  text.lineSpacing = 1.2099609375 * SYSTEM_FONT_EM_PER_LINE;
  text.setRenderOrder(13);
}

/** Native SUK field styling, using the same neutral gradients and rim as its controls. */
export function createPanelSurface(parent: SceneObject, name: string, width: number, height: number,
  position: vec3, radius = 2.4): RoundedRectangle {
  const rectangle = createRoundedSurface(parent, name, width, height, position, COLOR_WHITE, radius, 11);
  rectangle.gradient = true;
  rectangle.setBackgroundGradient(PrimaryNeutralGradients.defaultBackground);
  rectangle.border = true;
  rectangle.borderSize = 0.125;
  rectangle.borderType = "Gradient";
  rectangle.setBorderGradient(PrimaryNeutralGradients.defaultBorder);
  return rectangle;
}

/** Inter world-label calibration, shared by mobile robot and arm markers. */
export function createRobotLabelText(parent: SceneObject, name: string, emM: number,
  xM: number, yM: number, widthM: number, semibold: boolean, color: vec4, order: number): Text {
  const text = createText({ parent, name, text: "", fontSize: emM * 100 * 32 / 0.8216,
    color, position: new vec3(xM * 100, yM * 100, 0.1), horizontalAlignment: HorizontalAlignment.Center,
    worldSpaceRect: Rect.create(-widthM * 50, widthM * 50, -20, 0) });
  text.font = (semibold ? requireAsset("../../../Fonts/Inter/Inter-Semibold.ttf") : requireAsset("../../../Fonts/Inter/Inter-Regular.ttf")) as Font;
  text.sizeToFit = false; text.lineSpacing = (2478 / 2048) * 0.8216;
  text.verticalAlignment = VerticalAlignment.Top; text.depthTest = true; text.setRenderOrder(order);
  return text;
}
