import { RectangleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton";
import { RoundButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton";
import { TextInputField } from "SpectaclesUIKit.lspkg/Scripts/Components/TextInputField/TextInputField";
import { SnapOS2Styles } from "SpectaclesUIKit.lspkg/Scripts/Themes/SnapOS-2.0/SnapOS2";
import { FONT_BUTTON, Z_BUTTONS, Z_CONTENT } from "./UICore";
import { animateScaleTo } from "./UIAnimations";

// ================================================================
/** SnapOS2 button/text factory helpers and toggle binding utilities. */
// ================================================================

export { SnapOS2Styles };

type StyleableButton = any;

function assignButtonStyle(btn: any, style: string): void {
  (btn as StyleableButton)._style = style;
}

/** Apply a SnapOS2 style before or after button initialization. */
export function setButtonStyle(
  btn: RectangleButton | RoundButton | null,
  style: string,
): void {
  if (!btn || btn.style === style) {
    return;
  }
  assignButtonStyle(btn as unknown as StyleableButton, style);
  const internal = btn as unknown as StyleableButton;
  if (!internal._initialized) {
    return;
  }
  if (internal._visual) {
    internal._visual.destroy();
    internal._visual = null;
  }
  internal._initialized = false;
  btn.initialize();
}

export function configureButtonToggle(
  btn: RectangleButton,
  defaultOn: boolean = false,
): void {
  const toggleBtn = btn as any;
  toggleBtn._toggleable = true;
  toggleBtn._defaultToOn = defaultOn;
}

function buttonToggleState(btn: any): boolean | null {
  if ("isOn" in btn && typeof btn.isOn === "boolean") {
    return btn.isOn;
  }
  if ("_isOn" in btn && typeof btn._isOn === "boolean") {
    return btn._isOn;
  }
  return null;
}

export function setButtonToggleState(
  btn: RectangleButton | null,
  enabled: boolean,
): void {
  if (!btn) {
    return;
  }
  const toggleBtn = btn as any;
  const current = buttonToggleState(toggleBtn);
  toggleBtn._defaultToOn = enabled;
  if (current === enabled) {
    return;
  }
  if ("isOn" in toggleBtn) {
    toggleBtn.isOn = enabled;
    return;
  }
  if ("_isOn" in toggleBtn) {
    toggleBtn._isOn = enabled;
    return;
  }
  if (typeof toggleBtn.toggle === "function") {
    toggleBtn.toggle(enabled);
  }
}

type ToggleButtonWithValueChange = RectangleButton & {
  onValueChange?: { add: (cb: (value: number) => void) => void };
};

/** Bind a toggleable RectangleButton via onValueChange only (no onTriggerUp fallback). */
export function bindToggleOnValueChange(
  button: RectangleButton,
  onChanged: (enabled: boolean) => void,
): void {
  const toggleButton = button as ToggleButtonWithValueChange;
  if (
    !toggleButton.onValueChange ||
    typeof toggleButton.onValueChange.add !== "function"
  ) {
    throw new Error("bindToggleOnValueChange: button missing onValueChange");
  }
  toggleButton.onValueChange.add((value: number) => onChanged(value === 1));
}

export function setButtonEnabled(
  btn: RectangleButton | RoundButton | null,
  enabled: boolean,
): void {
  if (!btn) {
    return;
  }
  (btn as any).enabled = enabled;
  if ("inactive" in (btn as any)) {
    (btn as any).inactive = !enabled;
  }
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
  if (!button || !label) {
    return;
  }
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
  if (!button) {
    return;
  }
  const toggleButton = button as RectangleButton & {
    onValueChange?: { add: (cb: (value: number) => void) => void };
  };
  if (
    toggleButton.onValueChange &&
    typeof toggleButton.onValueChange.add === "function"
  ) {
    toggleButton.onValueChange.add((value: number) => onChanged(value === 1));
    return;
  }
  button.onTriggerUp.add(() => onChanged(!currentValue()));
}

/** Stable world-space text rendering inside UIKit frames. */
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
  if (opts.position) {
    obj.getTransform().setLocalPosition(opts.position);
  }
  const text = obj.createComponent("Text") as Text;
  if (opts.text !== undefined) {
    text.text = opts.text;
  }
  if (opts.fontSize !== undefined) {
    text.size = opts.fontSize;
  }
  if (opts.color) {
    text.textFill.color = opts.color;
  }
  if (opts.horizontalAlignment !== undefined) {
    text.horizontalAlignment = opts.horizontalAlignment;
  }
  if (opts.worldSpaceRect) {
    text.worldSpaceRect = opts.worldSpaceRect;
  }
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
  if (toggleable) {
    configureButtonToggle(btn, defaultOn);
  }
  btn.initialize();

  const labelText = createText({
    parent: btnObj,
    name: `${name}Label`,
    text: label,
    fontSize: FONT_BUTTON,
    color: new vec4(1, 1, 1, 1),
    position: new vec3(0, 0, Z_CONTENT),
    horizontalAlignment: HorizontalAlignment.Center,
    worldSpaceRect: Rect.create(
      -width / 2 + 0.3,
      width / 2 - 0.3,
      -height / 2,
      height / 2,
    ),
  });

  return { sceneObject: btnObj, button: btn, labelText };
}

export function createTextInput(
  parent: SceneObject,
  name: string,
  width: number,
  height: number,
  position: vec3,
  fontSize?: number,
): TextInputField {
  const obj = global.scene.createSceneObject(name);
  obj.setParent(parent);
  obj.getTransform().setLocalPosition(position);
  const field = obj.createComponent(TextInputField.getTypeName()) as TextInputField;
  field.size = new vec3(width, height, 0.5);
  if (fontSize !== undefined) {
    field.fontSize = fontSize;
  }
  return field;
}

export function setButtonLabelRect(
  label: Text | null,
  width: number,
  height: number,
  inset: number = 0.3,
): void {
  if (!label) {
    return;
  }
  label.worldSpaceRect = Rect.create(
    -width / 2 + inset,
    width / 2 - inset,
    -height / 2,
    height / 2,
  );
}

/**
 * Bind a subtle hover scale animation to a button/sceneObject pair.
 * Base scale is read once at bind time; the hover scale is `base * scale`.
 */
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
