import { unsubscribe } from "SpectaclesInteractionKit.lspkg/Utils/Event";
import { Frame } from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame";
import {
  CONTENT_PAD_X,
  CONTENT_PAD_Y,
  FALLBACK_FRAME_INNER_HEIGHT,
  FALLBACK_FRAME_INNER_WIDTH,
} from "./UIConstants";

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
