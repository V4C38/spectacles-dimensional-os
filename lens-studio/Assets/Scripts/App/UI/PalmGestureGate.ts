// ================================================================
/**
 * Hysteresis + debounce gate for palm-up wrist menu visibility.
 * Pure logic — no Lens runtime dependencies.
 */
// ================================================================

export type PalmGestureGateConfig = {
  /** Strong palm-up pitch for opening without facing the camera. */
  showPitchDeg: number;
  /**
   * Minimum camera-relative pitch to open while the palm faces the camera.
   * SIK pitch is relative to the camera forward axis, so looking down at a
   * wrist-level palm often reads near zero or slightly negative.
   */
  showPitchWhenFacingCameraDeg: number;
  /** Pitch must stay at or above this while open; lower closes more easily than open. */
  hidePitchDeg: number;
  openDebounceSec: number;
  closeDebounceSec: number;
  /** When open, menu closes if the palm stops facing the camera. */
  requireFacingCameraToStayOpen: boolean;
};

export type PalmGestureInput = {
  isTracked: boolean;
  palmPitchDeg: number | null;
  isFacingCamera: boolean;
};

export const DEFAULT_PALM_GESTURE_GATE_CONFIG: PalmGestureGateConfig = {
  showPitchDeg: 42,
  showPitchWhenFacingCameraDeg: -10,
  hidePitchDeg: -15,
  openDebounceSec: 0.28,
  closeDebounceSec: 0.08,
  requireFacingCameraToStayOpen: true,
};

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

  /** Returns true when the open/closed state changes after this update. */
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

    if (
      this._config.requireFacingCameraToStayOpen &&
      !input.isFacingCamera
    ) {
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
}
