import { HandInputData } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData";
import { HandType } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandType";
import { exponentialSmoothAlpha } from "../utilities/AnimationUtilities";

export type PalmGestureGateConfig = {
  showPitchDeg: number;
  showPitchWhenFacingCameraDeg: number;
  hidePitchDeg: number;
  openDebounceSec: number;
  closeDebounceSec: number;
  requireFacingCameraToStayOpen: boolean;
  palmFacingUpOpenDeg: number;
  palmFacingUpStayDeg: number;
};

export type PalmGestureInput = {
  isTracked: boolean;
  palmPitchDeg: number | null;
  isFacingCamera: boolean;
  /** Palm-normal dot world up. Null when the hand joints are unavailable. */
  palmFacingDotUp?: number | null;
};

export const DEFAULT_PALM_GESTURE_GATE_CONFIG: PalmGestureGateConfig = {
  showPitchDeg: 42,
  showPitchWhenFacingCameraDeg: -10,
  hidePitchDeg: -15,
  openDebounceSec: 0.28,
  closeDebounceSec: 0.08,
  requireFacingCameraToStayOpen: true,
  palmFacingUpOpenDeg: 50,
  palmFacingUpStayDeg: 70,
};

type Point = { x: number; y: number; z: number };

/** SIK's left-hand palm normal is the opposite of index × finger-forward. */
export function palmFacingDotWorldUp(
  handType: "left" | "right",
  wrist: Point,
  middleMid: Point,
  indexMid: Point,
): number | null {
  const right = normalize(sub(indexMid, middleMid));
  const forward = normalize(sub(middleMid, wrist));
  if (!right || !forward) {
    return null;
  }
  const up = cross(right, forward);
  const facing = handType === "left" ? scale(up, -1) : up;
  const unit = normalize(facing);
  return unit ? unit.y : null;
}

export class PalmGestureGate {
  private readonly _config: PalmGestureGateConfig;
  private _isOpen = false;
  private _pendingOpen: boolean | null = null;
  private _pendingSince = 0;

  constructor(config: PalmGestureGateConfig = DEFAULT_PALM_GESTURE_GATE_CONFIG) {
    this._config = config;
  }

  public get isOpen(): boolean {
    return this._isOpen;
  }

  public update(input: PalmGestureInput, now: number): boolean {
    if (!input.isTracked || input.palmPitchDeg === null) {
      if (!this._isOpen) {
        this._pendingOpen = null;
        return false;
      }
      this._isOpen = false;
      this._pendingOpen = null;
      return true;
    }

    const wantsOpen = this._evaluateWantsOpen(input);
    if (wantsOpen === this._isOpen) {
      this._pendingOpen = null;
      return false;
    }

    if (this._pendingOpen !== wantsOpen) {
      this._pendingOpen = wantsOpen;
      this._pendingSince = now;
      return false;
    }

    if (now - this._pendingSince < this._debounceSecFor(wantsOpen)) {
      return false;
    }

    this._isOpen = wantsOpen;
    this._pendingOpen = null;
    return true;
  }

  public reset(): void {
    this._isOpen = false;
    this._pendingOpen = null;
    this._pendingSince = 0;
  }

  private _debounceSecFor(wantsOpen: boolean): number {
    return wantsOpen ? this._config.openDebounceSec : this._config.closeDebounceSec;
  }

  private _evaluateWantsOpen(input: PalmGestureInput): boolean {
    const pitch = input.palmPitchDeg!;

    if (this._palmFacesUp(input.palmFacingDotUp, this._isOpen)) {
      return true;
    }

    if (this._config.requireFacingCameraToStayOpen && !input.isFacingCamera) {
      return false;
    }

    if (this._isOpen) {
      return pitch >= this._config.hidePitchDeg;
    }

    const palmUp = pitch >= this._config.showPitchDeg;
    const facingCameraOpen =
      input.isFacingCamera && pitch >= this._config.showPitchWhenFacingCameraDeg;
    return facingCameraOpen || palmUp;
  }

  private _palmFacesUp(dotUp: number | null | undefined, stayingOpen: boolean): boolean {
    if (dotUp === null || dotUp === undefined) {
      return false;
    }
    const maxDeg = stayingOpen
      ? this._config.palmFacingUpStayDeg
      : this._config.palmFacingUpOpenDeg;
    return dotUp >= Math.cos((maxDeg * Math.PI) / 180);
  }
}

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

  /** Hide now and arm the palm pose so it can open the menu again. */
  public closeImmediate(): void {
    this._gestureGate.reset();
    this._hideMenu(true);
  }

  public tick(dt: number): void {
    const now = getTime();
    const isTracked = this._hand.isTracked();
    const input = {
      isTracked,
      palmPitchDeg: isTracked ? this._hand.getPalmPitchAngle() : null,
      isFacingCamera: isTracked ? this._hand.isFacingCamera() : false,
      palmFacingDotUp: isTracked ? this._palmFacingDotUp() : null,
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

  private _palmFacingDotUp(): number | null {
    try {
      return palmFacingDotWorldUp(
        this._hand.handType,
        this._hand.wrist.position,
        this._hand.middleMidJoint.position,
        this._hand.indexMidJoint.position,
      );
    } catch {
      return null;
    }
  }
}

function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(a: Point, s: number): Point {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function cross(a: Point, b: Point): Point {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize(a: Point): Point | null {
  const length = Math.hypot(a.x, a.y, a.z);
  if (length < 1e-6) {
    return null;
  }
  return scale(a, 1 / length);
}
