import { RectangleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton";
import { RoundButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton";

export interface ButtonBinding {
  sceneObject: SceneObject;
  button: RectangleButton;
  labelText: Text | null;
}

export function findChildRecursive(
  root: SceneObject,
  name: string,
): SceneObject | null {
  for (let i = 0; i < root.getChildrenCount(); i++) {
    const child = root.getChild(i);
    if (child.name === name) {
      return child;
    }
    const nested = findChildRecursive(child, name);
    if (nested) {
      return nested;
    }
  }
  return null;
}

export function requireChild(
  root: SceneObject,
  name: string,
  ownerName: string = "SceneLookup",
): SceneObject {
  const child = findChildRecursive(root, name);
  if (!child) {
    throw new Error(`${ownerName}: Missing scene object ${name}`);
  }
  return child;
}

export function findText(root: SceneObject, name: string): Text | null {
  const obj = findChildRecursive(root, name);
  if (!obj) {
    return null;
  }
  return obj.getComponent("Component.Text") as Text;
}

export function requireText(
  root: SceneObject,
  name: string,
  ownerName: string = "SceneLookup",
): Text {
  const obj = requireChild(root, name, ownerName);
  const text = obj.getComponent("Component.Text") as Text;
  if (!text) {
    throw new Error(`${ownerName}: Missing text component on ${name}`);
  }
  return text;
}

export function requireRectangleButton(
  root: SceneObject,
  ownerName: string = "SceneLookup",
): RectangleButton {
  const button = root.getComponent(
    RectangleButton.getTypeName(),
  ) as RectangleButton;
  if (!button) {
    throw new Error(
      `${ownerName}: Missing RectangleButton on ${root.name}`,
    );
  }
  return button;
}

export function requireRoundButton(
  root: SceneObject,
  ownerName: string = "SceneLookup",
): RoundButton {
  const button = root.getComponent(
    RoundButton.getTypeName(),
  ) as RoundButton;
  if (!button) {
    throw new Error(
      `${ownerName}: Missing RoundButton on ${root.name}`,
    );
  }
  return button;
}

export function findButtonBinding(
  root: SceneObject,
  objectName: string,
  labelName: string,
): ButtonBinding | null {
  const obj = findChildRecursive(root, objectName);
  if (!obj) {
    return null;
  }
  const button = obj.getComponent(
    RectangleButton.getTypeName(),
  ) as RectangleButton;
  if (!button) {
    return null;
  }
  return {
    sceneObject: obj,
    button,
    labelText: findText(obj, labelName) ?? findText(root, labelName),
  };
}
