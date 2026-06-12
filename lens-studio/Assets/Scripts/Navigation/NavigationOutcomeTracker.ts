// ================================================================
/**
 * Manages the navigation-outcome flash lifecycle: set a success/failed
 * outcome and auto-clear it after a short delay. Extracted from
 * DimosManager; mirrors the MainMenuModeToggle pattern where
 * DimosManager owns the Lens `createEvent` call and injects an event
 * factory + getter/setter callbacks.
 */
// ================================================================

import { NavigationOutcome } from "../AppState";

const NAVIGATION_OUTCOME_FLASH_S = 1.5;

export class NavigationOutcomeTracker {
  private _seq = 0;
  private _dueSeq = 0;
  private _event: DelayedCallbackEvent | null = null;

  /**
   * @param createDelayedEvent  Factory that creates a single-fire DelayedCallbackEvent
   *                            bound to the given callback (provided by DimosManager so
   *                            the Lens Studio `createEvent` API stays inside the component).
   * @param getOutcome          Returns the current navigationOutcome from app-state.
   * @param setOutcome          Writes a new navigationOutcome into app-state.
   */
  constructor(
    private readonly _createDelayedEvent: (
      callback: () => void,
    ) => DelayedCallbackEvent,
    private readonly _getOutcome: () => NavigationOutcome,
    private readonly _setOutcome: (outcome: NavigationOutcome) => void,
  ) {}

  /**
   * Set a success/failed outcome and schedule an auto-clear after the
   * flash duration. Cancels any previously pending clear first.
   */
  public set(outcome: "success" | "failed"): void {
    this.cancel();
    this._setOutcome(outcome);
    this._scheduleFlash();
  }

  /**
   * Schedule an auto-clear without changing the outcome (use when the
   * caller already set the outcome as part of a multi-field state update).
   * Cancels any previously pending clear first.
   */
  public scheduleFlash(): void {
    this.cancel();
    this._scheduleFlash();
  }

  /**
   * Immediately clear the outcome to "none" and cancel any pending clear.
   * No-op when outcome is already "none".
   */
  public clear(): void {
    this.cancel();
    if (this._getOutcome() === "none") {
      return;
    }
    this._setOutcome("none");
  }

  /**
   * Cancel a pending auto-clear without changing the current outcome.
   * Safe to call even when no clear is scheduled.
   */
  public cancel(): void {
    this._seq += 1;
  }

  private _scheduleFlash(): void {
    this._seq += 1;
    this._dueSeq = this._seq;
    if (!this._event) {
      this._event = this._createDelayedEvent(() => {
        if (this._seq !== this._dueSeq) {
          return;
        }
        this.clear();
      });
    }
    (this._event as DelayedCallbackEvent).reset(NAVIGATION_OUTCOME_FLASH_S);
  }
}
