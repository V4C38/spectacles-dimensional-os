import { HandInputData } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData";
import { HandType } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandType";
import {
  exponentialSmoothAlpha,
  scaleIn,
  scaleOut,
} from "../Utilities/AnimationUtilities";
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
  visibleScale?: number;
  onBeforeShow?: () => void;
};

export class WristMenuController {
  private static readonly POSITION_RATE = 28.0;
  private static readonly SCALE_IN_DURATION = 0.25;
  private static readonly SCALE_OUT_DURATION = 0.2;

  private readonly _panel: SceneObject;
  private readonly _anchorRoot: SceneObject;
  private readonly _hand;
  private readonly _visibleScale: vec3;
  private readonly _onBeforeShow?: () => void;
  private readonly _gestureGate = new PalmGestureGate(DEFAULT_PALM_GESTURE_GATE_CONFIG);

  private _gatingActive = false;
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

    this._panel = deps.panel;
    this._anchorRoot = deps.anchorRoot;
    this._hand = HandInputData.getInstance().getHand(deps.handType ?? "left");
    this._onBeforeShow = deps.onBeforeShow;
    const scale = deps.visibleScale ?? 1.0;
    this._visibleScale = new vec3(scale, scale, scale);

    this._hidePanelImmediate();
  }

  public setGatingActive(active: boolean): void {
    if (this._gatingActive === active) {
      return;
    }
    this._gatingActive = active;
    if (!active) {
      this._gestureGate.reset();
      this._hideMenu(true);
    }
  }

  public tick(dt: number): void {
    if (!this._gatingActive) {
      return;
    }

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
    scaleIn(this._panel, WristMenuController.SCALE_IN_DURATION, this._visibleScale);
    this._tracking = true;
  }

  private _hideMenu(immediate: boolean): void {
    if (!this._menuVisible && !this._panel.enabled) {
      this._resetTracking();
      return;
    }

    this._menuVisible = false;
    if (immediate) {
      this._hidePanelImmediate();
    } else {
      scaleOut(this._panel, WristMenuController.SCALE_OUT_DURATION);
    }
    this._resetTracking();
  }

  private _hidePanelImmediate(): void {
    this._panel.enabled = false;
    this._panel.getTransform().setLocalScale(new vec3(0, 0, 0));
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
