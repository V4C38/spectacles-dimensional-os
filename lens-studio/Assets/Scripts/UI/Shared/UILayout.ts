import {
  FOOTER_BUTTON_GAP,
  FOOTER_TOP_GAP,
  SPACE_LG,
  SPACE_SM,
  SPACE_XS,
  Z_BUTTONS,
  Z_CONTENT,
} from "./UIConstants";
import { UIFrameMetrics } from "./UIFrameMetrics";
import { TextInputField } from "SpectaclesUIKit.lspkg/Scripts/Components/TextInputField/TextInputField";

export function setSceneObjectY(obj: SceneObject, centerY: number): void {
  obj.getTransform().setLocalPosition(new vec3(0, centerY, Z_CONTENT));
}

export function setTextSlot(
  text: Text,
  metrics: UIFrameMetrics,
  centerY: number,
  slotHeight: number,
): void {
  setSceneObjectY(text.getSceneObject(), centerY);
  text.worldSpaceRect = Rect.create(
    -metrics.contentWidth / 2,
    metrics.contentWidth / 2,
    -slotHeight / 2,
    slotHeight / 2,
  );
}

export interface FooterButtonTarget {
  sceneObject: SceneObject;
  width: number;
  visible: boolean;
}

/** Pin footer buttons to the bottom of the content area. */
export function layoutFooterButtons(
  metrics: UIFrameMetrics,
  footerHeight: number,
  left: FooterButtonTarget | null,
  right: FooterButtonTarget | null,
): void {
  const footerY = metrics.contentBottomY + footerHeight / 2;
  const showLeft = left !== null && left.visible;
  const showRight = right !== null && right.visible;

  const placeButton = (target: FooterButtonTarget, x: number): void => {
    target.sceneObject
      .getTransform()
      .setLocalPosition(new vec3(x, footerY, Z_BUTTONS));
  };

  if (showLeft && showRight) {
    const totalWidth = left.width + FOOTER_BUTTON_GAP + right.width;
    const leftX = -totalWidth / 2 + left.width / 2;
    const rightX = totalWidth / 2 - right.width / 2;
    placeButton(left, leftX);
    placeButton(right, rightX);
    return;
  }

  const solo = showRight ? right : showLeft ? left : null;
  if (solo) {
    placeButton(solo, 0);
  }
}

export interface WizardLayoutOptions {
  metrics: UIFrameMetrics;
  showInput: boolean;
  showPrev: boolean;
  title: Text;
  description: Text;
  status: Text;
  inputObj: SceneObject | null;
  inputField: TextInputField | null;
  prevObj: SceneObject | null;
  nextObj: SceneObject;
  headlineHeight: number;
  bodyHeight: number;
  inputHeight: number;
  statusHeight: number;
  footerHeight: number;
  prevWidth: number;
  nextWidth: number;
}

/** Stack content upward from a reserved footer band so buttons never overlap text. */
export function layoutSetupWizard(opts: WizardLayoutOptions): void {
  const { metrics } = opts;

  layoutFooterButtons(
    metrics,
    opts.footerHeight,
    opts.showPrev && opts.prevObj
      ? { sceneObject: opts.prevObj, width: opts.prevWidth, visible: true }
      : null,
    { sceneObject: opts.nextObj, width: opts.nextWidth, visible: true },
  );

  let cursorY =
    metrics.contentBottomY + opts.footerHeight + FOOTER_TOP_GAP;

  cursorY += opts.statusHeight / 2;
  setTextSlot(opts.status, metrics, cursorY, opts.statusHeight);
  cursorY += opts.statusHeight / 2 + SPACE_SM;

  if (opts.showInput && opts.inputObj && opts.inputField) {
    cursorY += opts.inputHeight / 2;
    setSceneObjectY(opts.inputObj, cursorY);
    opts.inputField.size = new vec3(
      metrics.contentWidth,
      opts.inputHeight,
      0.5,
    );
    cursorY += opts.inputHeight / 2 + SPACE_XS;
  }

  cursorY += opts.bodyHeight / 2;
  setTextSlot(opts.description, metrics, cursorY, opts.bodyHeight);
  cursorY += opts.bodyHeight / 2 + SPACE_SM;

  cursorY += opts.headlineHeight / 2;
  setTextSlot(opts.title, metrics, cursorY, opts.headlineHeight);
}

export interface HudLayoutOptions {
  metrics: UIFrameMetrics;
  title: Text;
  status: Text;
  buttonObj: SceneObject;
  titleHeight: number;
  statusHeight: number;
  footerHeight: number;
}

export function layoutHudPanel(opts: HudLayoutOptions): void {
  const { metrics } = opts;

  const footerY = metrics.contentBottomY + opts.footerHeight / 2;
  opts.buttonObj
    .getTransform()
    .setLocalPosition(new vec3(0, footerY, Z_BUTTONS));

  let cursorY =
    metrics.contentBottomY + opts.footerHeight + FOOTER_TOP_GAP;
  cursorY += opts.statusHeight / 2;
  setTextSlot(opts.status, metrics, cursorY, opts.statusHeight);
  cursorY += opts.statusHeight / 2 + SPACE_LG;

  cursorY += opts.titleHeight / 2;
  setTextSlot(opts.title, metrics, cursorY, opts.titleHeight);
}
