import { HandInputData } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData";
import { HandType } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandType";

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

type WristHand = Pick<ReturnType<HandInputData["getHand"]>, "isTracked" | "getPalmPitchAngle" | "isFacingCamera" | "wrist" | "middleMidJoint" | "indexMidJoint">;

export type WristMenuControllerDeps = {
  hands?: { left: WristHand; right: WristHand };
  panel: SceneObject;
  anchorRoot: SceneObject;
  cameraObject?: SceneObject;
  handType?: HandType;
  onBeforeShow?: () => void;
  centerOffsetCm?: () => number;
  onPin?: () => void;
  onMenuShow: () => void;
  onMenuHide: (immediate: boolean) => void;
};

/** Either palm can summon; native Frame translation detaches the panel from that source. */
export class WristMenuController {
  private readonly hands: { left: WristHand; right: WristHand };
  private readonly gates = { left: new PalmGestureGate(), right: new PalmGestureGate() };
  private source: "left" | "right" | null = null;
  private visible = false;
  private summonOffset = vec3.zero();

  constructor(private readonly deps: WristMenuControllerDeps) {
    this.hands = deps.hands ?? {
      left: HandInputData.getInstance().getHand("left"),
      right: HandInputData.getInstance().getHand("right"),
    };
    deps.onMenuHide(true);
  }

  pin(): void { this.source = null; this.deps.onPin?.(); }
  isPinned(): boolean { return this.visible && this.source === null; }
  sourceHand(): "left" | "right" | null { return this.source; }
  closeImmediate(): void {
    this.source = null; this.visible = false;
    this.gates.left.reset(); this.gates.right.reset();
    this.deps.onMenuHide(true);
  }

  tick(dt: number): void {
    for (const side of ["left", "right"] as const) {
      const hand = this.hands[side], tracked = hand.isTracked();
      let palmFacingDotUp: number | null = null;
      if (tracked) {
        try { palmFacingDotUp = palmFacingDotWorldUp(side, hand.wrist.position, hand.middleMidJoint.position, hand.indexMidJoint.position); }
        catch { /* Tracking can temporarily omit joints. */ }
      }
      const changed = this.gates[side].update({ isTracked: tracked,
        palmPitchDeg: tracked ? hand.getPalmPitchAngle() : null,
        isFacingCamera: tracked && hand.isFacingCamera(), palmFacingDotUp }, getTime());
      if (this.source === side && !tracked) { this.pin(); continue; }
      if (changed && this.gates[side].isOpen && !this.visible) {
        this.visible = true; this.source = side;
        const forward = this.deps.cameraObject?.getTransform().getWorldRotation().multiplyVec3(new vec3(0, 0, -1));
        const length = forward ? Math.hypot(forward.x, forward.z) : 0;
        this.summonOffset = forward && length > 0.001 ? new vec3(forward.x / length * 18, 0, forward.z / length * 18) : vec3.zero();
        this.placeAtPalm(); this.deps.onBeforeShow?.(); this.deps.onMenuShow();
      } else if (changed && !this.gates[side].isOpen && this.source === side) {
        this.source = null; this.visible = false; this.deps.onMenuHide(false);
      }
    }
    if (this.visible && this.source) this.placeAtPalm(dt);
  }

  private placeAtPalm(dt?: number): void {
    if (!this.source) return;
    const hand = this.hands[this.source];
    const transform = this.deps.panel.getTransform();
    const camera = this.deps.cameraObject?.getTransform();
    const wrist = hand.wrist?.position;
    const offset = dt === undefined ? 0 : this.deps.centerOffsetCm?.() ?? 0;
    const target = wrist ? new vec3(wrist.x, wrist.y + 20 + offset, wrist.z).add(this.summonOffset) : this.deps.anchorRoot.getTransform().getWorldPosition();
    const alpha = dt === undefined ? 1 : 1 - Math.exp(-12 * Math.max(0, dt));
    transform.setWorldPosition(vec3.lerp(transform.getWorldPosition(), target, alpha));
    if (camera) {
      const toward = camera.getWorldPosition().sub(transform.getWorldPosition());
      if (toward.length > 0.001) {
        const rotation = quat.lookAt(toward.normalize(), vec3.up());
        transform.setWorldRotation(dt === undefined ? rotation : quat.slerp(transform.getWorldRotation(), rotation, alpha));
      }
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
