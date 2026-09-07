import { HandInputData } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData";
import { HandType } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandType";
import { exponentialSmoothAlpha } from "../Utilities/AnimationUtilities";
import {
  DEFAULT_PALM_GESTURE_GATE_CONFIG,
  PalmGestureGate,
} from "./PalmGestureGate";

// ================================================================
/**
 * Spectacles wrist menu driver: palm-up gesture visibility and smooth
 * position interpolation of the MainUI panel toward WristMenuRoot.
 * Rotation is scene-authored Frame billboarding (not driven here).
 */
// ================================================================

export type WristMenuControllerDeps = {
  panel: SceneObject;
  anchorRoot: SceneObject;
  handType?: HandType;
  onBeforeShow?: () => void;
  onMenuShow: () => void;
  onMenuHide: (immediate: boolean) => void;
};

export class WristMenuController {
  private static readonly POSITION_RATE = 28.0;

  private readonly _panel: SceneObject;
  private readonly _anchorRoot: SceneObject;
  private readonly _hand;
  private readonly _onBeforeShow?: () => void;
  private readonly _onMenuShow: () => void;
  private readonly _onMenuHide: (immediate: boolean) => void;
  private readonly _gestureGate = new PalmGestureGate(DEFAULT_PALM_GESTURE_GATE_CONFIG);

  private _menuVisible = false;
  private _tracking = false;
  private _needsSnap = true;

  constructor(deps: WristMenuControllerDeps) {
    if (!deps.panel) {
      throw new Error("WristMenuController: panel is required");
    }
    if (!deps.anchorRoot) {
      throw new Error("WristMenuController: anchorRoot is required");
    }
    if (!deps.onMenuShow || !deps.onMenuHide) {
      throw new Error("WristMenuController: onMenuShow and onMenuHide are required");
    }

    this._panel = deps.panel;
    this._anchorRoot = deps.anchorRoot;
    this._hand = HandInputData.getInstance().getHand(deps.handType ?? "left");
    this._onBeforeShow = deps.onBeforeShow;
    this._onMenuShow = deps.onMenuShow;
    this._onMenuHide = deps.onMenuHide;

    this._onMenuHide(true);
  }

  public tick(dt: number): void {
    const now = getTime();
    const isTracked = this._hand.isTracked();
    const input = {
      isTracked,
      palmPitchDeg: isTracked ? this._hand.getPalmPitchAngle() : null,
      isFacingCamera: isTracked ? this._hand.isFacingCamera() : false,
    };

    const gestureChanged = this._gestureGate.update(input, now);
    if (gestureChanged) {
      if (this._gestureGate.isOpen) {
        this._showMenu();
      } else {
        this._hideMenu(false);
      }
    }

    if (isTracked) {
      this._tickInterpolation(dt);
      return;
    }

    if (this._menuVisible) {
      this._gestureGate.reset();
      this._hideMenu(true);
    }
  }

  private _showMenu(): void {
    if (this._menuVisible) {
      return;
    }
    this._menuVisible = true;
    this._snapToAnchor();
    this._onBeforeShow?.();
    this._onMenuShow();
    this._tracking = true;
  }

  private _hideMenu(immediate: boolean): void {
    if (!this._menuVisible && !this._panel.enabled) {
      this._resetTracking();
      return;
    }

    this._menuVisible = false;
    this._onMenuHide(immediate);
    this._resetTracking();
  }

  private _snapToAnchor(): void {
    const anchorTransform = this._anchorRoot.getTransform();
    const panelTransform = this._panel.getTransform();
    panelTransform.setWorldPosition(anchorTransform.getWorldPosition());
    this._needsSnap = false;
    this._tracking = true;
  }

  private _tickInterpolation(dt: number): void {
    if (dt <= 0) {
      return;
    }

    const anchorTransform = this._anchorRoot.getTransform();
    const targetPos = anchorTransform.getWorldPosition();
    const panelTransform = this._panel.getTransform();

    if (this._needsSnap) {
      panelTransform.setWorldPosition(targetPos);
      this._needsSnap = false;
      this._tracking = true;
      return;
    }

    if (!this._tracking) {
      return;
    }

    const alpha = exponentialSmoothAlpha(dt, WristMenuController.POSITION_RATE);
    panelTransform.setWorldPosition(
      vec3.lerp(panelTransform.getWorldPosition(), targetPos, alpha),
    );
  }

  private _resetTracking(): void {
    this._tracking = false;
    this._needsSnap = true;
  }
}
