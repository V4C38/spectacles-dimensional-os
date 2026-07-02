// ================================================================
/**
 * UIKit — merged constants, primitives, scene-lookup helpers, and
 * SnapOS2 button/text factory helpers.
 *
 * Replaces UICore.ts + UIBuilders.ts (P4 merge).
 */
// ================================================================

import { unsubscribe } from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { RectangleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton";
import { RoundButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton";
import { TextInputField } from "SpectaclesUIKit.lspkg/Scripts/Components/TextInputField/TextInputField";
import { Frame } from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame";
import { SnapOS2Styles } from "SpectaclesUIKit.lspkg/Scripts/Themes/SnapOS-2.0/SnapOS2";
import { animateScaleTo } from "../../Utilities/AnimationUtilities";

export { SnapOS2Styles };

// ── Constants ──────────────────────────────────────────────────

export const FALLBACK_FRAME_INNER_WIDTH = 25;
export const FALLBACK_FRAME_INNER_HEIGHT = 14;

export const CONTENT_PAD_X = 2.0;
export const CONTENT_PAD_Y = 1.5;

export const FOOTER_TOP_GAP = 1.2;

export const Z_CONTENT = 2.0;
export const Z_BUTTONS = 1.5;

export const SPACE_XS = 0.4;
export const SPACE_SM = 0.6;
export const SPACE_MD = 0.8;
export const SPACE_LG = 1.2;

export const SLOT_HEADLINE = 3.0;
export const SLOT_BODY = 3.8;
export const SLOT_INPUT = 2.8;
export const SLOT_STATUS = 2.0;
export const SLOT_FOOTER = 3.5;

export const BUTTON_HEIGHT = 3.5;
export const BUTTON_WIDTH = 12;
export const FOOTER_BUTTON_GAP = SPACE_MD;

export const FONT_HEADLINE = 72;
export const FONT_WIZARD_TITLE = 105;
export const FONT_BODY = 54;
export const FONT_WIZARD_STATUS = 64;
export const FONT_WIZARD_INPUT = 58;
export const FONT_CALIBRATE_TAG = FONT_WIZARD_STATUS;
export const FONT_CALIBRATE_PROGRESS = 58;
export const FONT_CAPTION = 42;
export const FONT_BUTTON = 44;

export const COLOR_WHITE = new vec4(1, 1, 1, 1);
export const COLOR_MUTED = new vec4(1, 1, 1, 0.55);
export const COLOR_SUCCESS = new vec4(0, 1, 0, 1);
export const COLOR_ERROR = new vec4(1, 0, 0, 1);
export const COLOR_WARN = new vec4(1, 0.85, 0, 1);

// ── Frame metrics ──────────────────────────────────────────────

export class UIFrameMetrics {
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly contentTopY: number;
  readonly contentBottomY: number;

  constructor(
    innerWidth: number,
    innerHeight: number,
    padX: number = CONTENT_PAD_X,
    padY: number = CONTENT_PAD_Y,
  ) {
    this.innerWidth = innerWidth;
    this.innerHeight = innerHeight;
    this.contentWidth = innerWidth - padX * 2;
    this.contentHeight = innerHeight - padY * 2;
    this.contentTopY = innerHeight / 2 - padY;
    this.contentBottomY = -innerHeight / 2 + padY;
  }

  static fromSceneObject(panel: SceneObject): UIFrameMetrics {
    const frame = getFrameComponent(panel);
    if (frame) {
      const inner = frame.innerSize;
      return new UIFrameMetrics(inner.x, inner.y);
    }
    return UIFrameMetrics.fallback();
  }

  static fallback(): UIFrameMetrics {
    return new UIFrameMetrics(FALLBACK_FRAME_INNER_WIDTH, FALLBACK_FRAME_INNER_HEIGHT);
  }
}

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

export function bindFrameLayout(panel: SceneObject, relayout: () => void): unsubscribe[] {
  const frame = getFrameComponent(panel);
  if (!frame) {
    return [];
  }
  const unsubs: unsubscribe[] = [];
  unsubs.push(frame.onInitialized.add(() => relayout()));
  unsubs.push(frame.onScalingUpdate.add(() => { if (!frame.autoScaleContent) relayout(); }));
  return unsubs;
}

// ── Scene lookup helpers ───────────────────────────────────────

export interface ButtonBinding {
  sceneObject: SceneObject;
  button: RectangleButton;
  labelText: Text | null;
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

export function requireChild(
  root: SceneObject,
  name: string,
  ownerName: string = "SceneLookup",
): SceneObject {
  const child = findChildRecursive(root, name);
  if (!child) throw new Error(`${ownerName}: Missing scene object ${name}`);
  return child;
}

export function findText(root: SceneObject, name: string): Text | null {
  const obj = findChildRecursive(root, name);
  return obj ? (obj.getComponent("Component.Text") as Text) : null;
}

function findFirstTextObject(root: SceneObject): SceneObject | null {
  const text = root.getComponent("Component.Text") as Text | null;
  if (text) return root;
  for (let i = 0; i < root.getChildrenCount(); i++) {
    const nested = findFirstTextObject(root.getChild(i));
    if (nested) return nested;
  }
  return null;
}

export function findFirstText(root: SceneObject): Text | null {
  const obj = findFirstTextObject(root);
  return obj ? (obj.getComponent("Component.Text") as Text) : null;
}

export function requireFirstText(root: SceneObject, ownerName: string = "SceneLookup"): Text {
  const text = findFirstText(root);
  if (!text) throw new Error(`${ownerName}: subtree of ${root.name} is missing a Text component`);
  return text;
}

export function requireText(
  root: SceneObject,
  name: string,
  ownerName: string = "SceneLookup",
): Text {
  const obj = requireChild(root, name, ownerName);
  const text = obj.getComponent("Component.Text") as Text;
  if (!text) throw new Error(`${ownerName}: Missing text component on ${name}`);
  return text;
}

export function requireRectangleButton(
  root: SceneObject,
  ownerName: string = "SceneLookup",
): RectangleButton {
  const button = root.getComponent(RectangleButton.getTypeName()) as RectangleButton;
  if (!button) throw new Error(`${ownerName}: Missing RectangleButton on ${root.name}`);
  return button;
}

export function requireRoundButton(
  root: SceneObject,
  ownerName: string = "SceneLookup",
): RoundButton {
  const button = root.getComponent(RoundButton.getTypeName()) as RoundButton;
  if (!button) throw new Error(`${ownerName}: Missing RoundButton on ${root.name}`);
  return button;
}

export function findButtonBinding(
  root: SceneObject,
  objectName: string,
  labelName: string,
): ButtonBinding | null {
  const obj = findChildRecursive(root, objectName);
  if (!obj) return null;
  const button = obj.getComponent(RectangleButton.getTypeName()) as RectangleButton;
  if (!button) return null;
  return {
    sceneObject: obj,
    button,
    labelText: findText(obj, labelName) ?? findText(root, labelName),
  };
}

// ── Button helpers (from UIBuilders) ──────────────────────────

type StyleableButton = any;

function assignButtonStyle(btn: any, style: string): void {
  (btn as StyleableButton)._style = style;
}

export function setButtonStyle(btn: RectangleButton | RoundButton | null, style: string): void {
  if (!btn || btn.style === style) return;
  assignButtonStyle(btn as unknown as StyleableButton, style);
  const internal = btn as unknown as StyleableButton;
  if (!internal._initialized) return;
  if (internal._visual) {
    internal._visual.destroy();
    internal._visual = null;
  }
  internal._initialized = false;
  btn.initialize();
}

export function configureButtonToggle(btn: RectangleButton, defaultOn: boolean = false): void {
  const toggleBtn = btn as any;
  toggleBtn._toggleable = true;
  toggleBtn._defaultToOn = defaultOn;
}

function buttonToggleState(btn: any): boolean | null {
  if ("isOn" in btn && typeof btn.isOn === "boolean") return btn.isOn;
  if ("_isOn" in btn && typeof btn._isOn === "boolean") return btn._isOn;
  return null;
}

export function setButtonToggleState(btn: RectangleButton | null, enabled: boolean): void {
  if (!btn) return;
  const toggleBtn = btn as any;
  const current = buttonToggleState(toggleBtn);
  toggleBtn._defaultToOn = enabled;
  if (current === enabled) return;
  if ("isOn" in toggleBtn) { toggleBtn.isOn = enabled; return; }
  if ("_isOn" in toggleBtn) { toggleBtn._isOn = enabled; return; }
  if (typeof toggleBtn.toggle === "function") toggleBtn.toggle(enabled);
}

type ToggleButtonWithValueChange = RectangleButton & {
  onValueChange?: { add: (cb: (value: number) => void) => void };
};

export function bindToggleOnValueChange(
  button: RectangleButton,
  onChanged: (enabled: boolean) => void,
): void {
  const toggleButton = button as ToggleButtonWithValueChange;
  if (!toggleButton.onValueChange || typeof toggleButton.onValueChange.add !== "function") {
    throw new Error("bindToggleOnValueChange: button missing onValueChange");
  }
  toggleButton.onValueChange.add((value: number) => onChanged(value === 1));
}

export function setButtonEnabled(btn: RectangleButton | RoundButton | null, enabled: boolean): void {
  if (!btn) return;
  (btn as any).enabled = enabled;
  if ("inactive" in (btn as any)) (btn as any).inactive = !enabled;
}

export interface CapabilityButtonPresentation {
  available: boolean;
  availableLabel: string;
  unavailableLabel?: string;
  availableStyle?: string;
  unavailableStyle?: string;
}

export function applyCapabilityButtonPresentation(
  button: RectangleButton | RoundButton | null,
  label: Text | null,
  presentation: CapabilityButtonPresentation,
): void {
  if (!button || !label) return;
  label.text = presentation.available
    ? presentation.availableLabel
    : presentation.unavailableLabel ?? `${presentation.availableLabel}\nUnavailable`;
  setButtonStyle(
    button,
    presentation.available
      ? presentation.availableStyle ?? SnapOS2Styles.PrimaryNeutral
      : presentation.unavailableStyle ?? SnapOS2Styles.Special,
  );
  setButtonEnabled(button, presentation.available);
}

export function bindToggleButton(
  button: RectangleButton | null,
  onChanged: (enabled: boolean) => void,
  currentValue: () => boolean,
): void {
  if (!button) return;
  const toggleButton = button as RectangleButton & {
    onValueChange?: { add: (cb: (value: number) => void) => void };
  };
  if (toggleButton.onValueChange && typeof toggleButton.onValueChange.add === "function") {
    toggleButton.onValueChange.add((value: number) => onChanged(value === 1));
    return;
  }
  button.onTriggerUp.add(() => onChanged(!currentValue()));
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
  button: RectangleButton;
  labelText: Text;
}

export function createIconButton(
  parent: SceneObject,
  name: string,
  label: string,
  width: number,
  height: number,
  position: vec3,
  style: string = SnapOS2Styles.PrimaryNeutral,
  toggleable: boolean = false,
  defaultOn: boolean = false,
): IconButtonResult {
  const btnObj = global.scene.createSceneObject(name);
  btnObj.setParent(parent);
  btnObj.getTransform().setLocalPosition(position);
  const btn = btnObj.createComponent(RectangleButton.getTypeName()) as RectangleButton;
  btn.size = new vec3(width, height, 0.5);
  assignButtonStyle(btn, style);
  if (toggleable) configureButtonToggle(btn, defaultOn);
  btn.initialize();
  const labelText = createText({
    parent: btnObj,
    name: `${name}Label`,
    text: label,
    fontSize: FONT_BUTTON,
    color: new vec4(1, 1, 1, 1),
    position: new vec3(0, 0, Z_CONTENT),
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

export function setButtonLabelRect(
  label: Text | null,
  width: number,
  height: number,
  inset: number = 0.3,
): void {
  if (!label) return;
  label.worldSpaceRect = Rect.create(-width / 2 + inset, width / 2 - inset, -height / 2, height / 2);
}

export function bindHoverScale(
  button: RectangleButton | RoundButton,
  sceneObject: SceneObject,
  scale: number = 1.05,
): void {
  const baseScale = sceneObject.getTransform().getLocalScale();
  const hoverScale = baseScale.uniformScale(scale);
  button.onHoverEnter.add(() => animateScaleTo(sceneObject, hoverScale));
  button.onHoverExit.add(() => animateScaleTo(sceneObject, baseScale));
}
