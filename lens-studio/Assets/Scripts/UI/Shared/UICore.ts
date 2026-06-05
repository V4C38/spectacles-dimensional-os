import { unsubscribe } from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { RectangleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton";
import { RoundButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton";
import { Frame } from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame";

// ================================================================
/**
 * Shared UI core primitives: constants, frame metrics, and scene lookup helpers.
 */
// ================================================================

/** Fallback inner size when no UIKit Frame is on the panel (cm). */
export const FALLBACK_FRAME_INNER_WIDTH = 33;
export const FALLBACK_FRAME_INNER_HEIGHT = 18;

export const CONTENT_PAD_X = 2.0;
export const CONTENT_PAD_Y = 1.5;

/** Minimum clear space between the last text row and the footer buttons (cm). */
export const FOOTER_TOP_GAP = 1.2;

export const Z_CONTENT = 2.0;
export const Z_BUTTONS = 1.5;

/** Vertical spacing scale (cm). */
export const SPACE_XS = 0.4;
export const SPACE_SM = 0.6;
export const SPACE_MD = 0.8;
export const SPACE_LG = 1.2;

/** Fixed slot heights for the setup wizard (cm). */
export const SLOT_HEADLINE = 3.0;
export const SLOT_BODY = 3.8;
export const SLOT_INPUT = 2.8;
export const SLOT_STATUS = 2.0;
export const SLOT_FOOTER = 3.5;

/** HUD slot heights (cm). */
export const SLOT_HUD_TITLE = 3.0;
export const SLOT_HUD_STATUS = 2.0;

export const BUTTON_HEIGHT = 3.5;
export const BUTTON_WIDTH = 12;
export const FOOTER_BUTTON_GAP = SPACE_MD;

/** Spectacles UIKit typography - Far distance / Large frame. */
export const FONT_HEADLINE = 72;
export const FONT_BODY = 54;
export const FONT_CAPTION = 42;
export const FONT_BUTTON = 44;
export const FONT_HUD_TITLE = 64;

export const COLOR_WHITE = new vec4(1, 1, 1, 1);
export const COLOR_MUTED = new vec4(1, 1, 1, 0.55);
export const COLOR_SUCCESS = new vec4(0, 1, 0, 1);
export const COLOR_ERROR = new vec4(1, 0, 0, 1);
export const COLOR_WARN = new vec4(1, 0.85, 0, 1);

export const WS_PORT = 8787;
export const IP_STORAGE_KEY = "dimos_bridge_ip";

/** Content-area measurements derived from a UIKit Frame inner size. */
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
    return new UIFrameMetrics(
      FALLBACK_FRAME_INNER_WIDTH,
      FALLBACK_FRAME_INNER_HEIGHT,
    );
  }
}

export function getFrameComponent(panel: SceneObject): Frame | null {
  const frame = panel.getComponent(Frame.getTypeName()) as Frame;
  if (frame) {
    return frame;
  }
  return null;
}

/**
 * Re-run layout when the Frame inner size changes at runtime.
 * When autoScaleContent is enabled (default), UIKit scales children so only
 * inspector size changes and autoScaleContent=false need a full relayout.
 */
export function bindFrameLayout(
  panel: SceneObject,
  relayout: () => void,
): unsubscribe[] {
  const frame = getFrameComponent(panel);
  if (!frame) {
    return [];
  }
  const unsubs: unsubscribe[] = [];
  unsubs.push(
    frame.onInitialized.add(() => {
      relayout();
    }),
  );
  unsubs.push(
    frame.onScalingUpdate.add(() => {
      if (!frame.autoScaleContent) {
        relayout();
      }
    }),
  );
  return unsubs;
}

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
