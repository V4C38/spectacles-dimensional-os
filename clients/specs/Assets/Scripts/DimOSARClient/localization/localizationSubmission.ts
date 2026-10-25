/** Correlate capture-derived result timestamps without adding wire ACKs. */
export class LocalizationSubmission {
  private latestCaptureTs = -Infinity;
  private expectedResultTs: number | null = null;
  private deadline: number | null = null;

  begin(captureTs: number, offset: number, now: number, timeoutS: number): void {
    if (!Number.isFinite(captureTs) || captureTs <= this.latestCaptureTs) {
      throw new Error("localization capture timestamps must increase between submissions");
    }
    if (!Number.isFinite(timeoutS) || timeoutS <= 0) {
      throw new Error("localization result timeout must be finite and positive");
    }
    if (![offset, now, captureTs + offset, now + timeoutS].every(Number.isFinite)) {
      throw new Error("localization clocks must be finite");
    }
    this.latestCaptureTs = captureTs;
    this.expectedResultTs = captureTs + offset;
    this.deadline = now + timeoutS;
  }

  accept(resultTs: number, now: number): boolean {
    if (!Number.isFinite(resultTs) || !Number.isFinite(now)) return false;
    if (this.expectedResultTs === null || this.deadline === null || now >= this.deadline) {
      this.cancel();
      return false;
    }
    // A few float64 epoch-time ULPs cover arithmetic rounding at either end.
    if (Math.abs(resultTs - this.expectedResultTs) > 0.000001) return false;
    this.cancel();
    return true;
  }

  cancel(): void {
    this.expectedResultTs = null;
    this.deadline = null;
  }

  reset(): void {
    this.cancel();
    this.latestCaptureTs = -Infinity;
  }
}
