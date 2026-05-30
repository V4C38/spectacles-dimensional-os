import { RectangleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton";
import { RoundButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton";
import { TextInputField } from "SpectaclesUIKit.lspkg/Scripts/Components/TextInputField/TextInputField";
import { SnapOS2Styles } from "SpectaclesUIKit.lspkg/Scripts/Themes/SnapOS-2.0/SnapOS2";
import { FONT_BUTTON, Z_BUTTONS, Z_CONTENT } from "./UIConstants";

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

export function setButtonToggleState(
  btn: RectangleButton | null,
  enabled: boolean,
): void {
  if (!btn) {
    return;
  }
  const toggleBtn = btn as any;
  toggleBtn._defaultToOn = enabled;
  if (typeof toggleBtn.toggle === "function") {
    toggleBtn.toggle(enabled);
    return;
  }
  if ("isOn" in toggleBtn) {
    toggleBtn.isOn = enabled;
  }
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
): TextInputField {
  const obj = global.scene.createSceneObject(name);
  obj.setParent(parent);
  obj.getTransform().setLocalPosition(position);
  const field = obj.createComponent(TextInputField.getTypeName()) as TextInputField;
  field.size = new vec3(width, height, 0.5);
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
