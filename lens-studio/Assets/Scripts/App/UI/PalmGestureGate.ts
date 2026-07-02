// ================================================================
/**
 * Hysteresis + debounce gate for palm-up wrist menu visibility.
 * Pure logic — no Lens runtime dependencies.
 */
// ================================================================

export type PalmGestureGateConfig = {
  showPitchDeg: number;
  hidePitchDeg: number;
  debounceSec: number;
  requireFacingCamera: boolean;
};

export type PalmGestureInput = {
  isTracked: boolean;
  palmPitchDeg: number | null;
  isFacingCamera: boolean;
};

export const DEFAULT_PALM_GESTURE_GATE_CONFIG: PalmGestureGateConfig = {
  showPitchDeg: 25,
  hidePitchDeg: 5,
  debounceSec: 0.15,
  requireFacingCamera: true,
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

    if (now - this._pendingSince < this._config.debounceSec) {
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

  private _evaluateWantsOpen(input: PalmGestureInput): boolean {
    if (this._config.requireFacingCamera && !input.isFacingCamera) {
      return false;
    }

    const pitch = input.palmPitchDeg!;
    if (this._isOpen) {
      return pitch >= this._config.hidePitchDeg;
    }
    return pitch >= this._config.showPitchDeg;
  }
}
