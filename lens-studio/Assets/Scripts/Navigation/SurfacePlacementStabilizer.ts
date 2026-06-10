// ================================================================
/** Temporal buffer + robust estimator for ground-ray placement hits. */
// ================================================================

export type SurfaceHitSample = {
  x: number;
  y: number;
  z: number;
  time: number;
};

const SAMPLE_WINDOW_S = 0.35;
const MAX_SAMPLES = 24;
const MIN_SAMPLES_FOR_MEDIAN = 3;
const POSE_SMOOTHING_RATE = 10.0;
const POSITION_DEADBAND_CM = 0.5;
const STALE_GAP_S = 0.5;

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  let sum = 0;
  for (let index = 0; index < values.length; index++) {
    sum += values[index];
  }
  return sum / values.length;
}

export class SurfacePlacementStabilizer {
  private _samples: SurfaceHitSample[] = [];
  private _smoothedPosition: vec3 | null = null;
  private _floorBaselineY = 0;
  private _hasResolvedEstimate = false;

  public reset(floorBaselineY: number, initialPosition: vec3): void {
    this._samples = [];
    this._floorBaselineY = floorBaselineY;
    this._hasResolvedEstimate = false;
    this._smoothedPosition = new vec3(
      initialPosition.x,
      initialPosition.y,
      initialPosition.z,
    );
  }

  public setFloorBaselineY(floorBaselineY: number): void {
    this._floorBaselineY = floorBaselineY;
  }

  public get smoothedPosition(): vec3 | null {
    return this._smoothedPosition;
  }

  public pushSample(position: vec3, groundedY: number, now: number = getTime()): void {
    this._pruneSamples(now);
    this._samples.push({
      x: position.x,
      y: groundedY,
      z: position.z,
      time: now,
    });
    if (this._samples.length > MAX_SAMPLES) {
      this._samples.shift();
    }
  }

  /** Robust estimate from buffered hits; null when buffer is empty. */
  public estimateFromBuffer(): vec3 | null {
    if (this._samples.length === 0) {
      return null;
    }

    const ys = this._samples.map((sample) => sample.y);
    const estimatedY =
      ys.length >= MIN_SAMPLES_FOR_MEDIAN ? median(ys) : average(ys);
    const clampedY = Math.max(estimatedY, this._floorBaselineY);

    return new vec3(
      average(this._samples.map((sample) => sample.x)),
      clampedY,
      average(this._samples.map((sample) => sample.z)),
    );
  }

  /**
   * Blend toward a target pose. Snaps on first valid target or after a stale gap.
   */
  public advanceTowardTarget(
    target: vec3,
    dt: number,
    snapImmediate: boolean = false,
  ): vec3 {
    if (!this._smoothedPosition) {
      this._smoothedPosition = new vec3(target.x, target.y, target.z);
      this._hasResolvedEstimate = true;
      return this._smoothedPosition;
    }

    const deadbandTarget = new vec3(
      Math.abs(target.x - this._smoothedPosition.x) < POSITION_DEADBAND_CM
        ? this._smoothedPosition.x
        : target.x,
      Math.abs(target.y - this._smoothedPosition.y) < POSITION_DEADBAND_CM
        ? this._smoothedPosition.y
        : target.y,
      Math.abs(target.z - this._smoothedPosition.z) < POSITION_DEADBAND_CM
        ? this._smoothedPosition.z
        : target.z,
    );

    if (snapImmediate || !this._hasResolvedEstimate) {
      this._smoothedPosition = new vec3(
        deadbandTarget.x,
        deadbandTarget.y,
        deadbandTarget.z,
      );
      this._hasResolvedEstimate = true;
      return this._smoothedPosition;
    }

    const alpha = 1.0 - Math.exp(-POSE_SMOOTHING_RATE * dt);
    this._smoothedPosition = vec3.lerp(
      this._smoothedPosition,
      deadbandTarget,
      alpha,
    );
    this._hasResolvedEstimate = true;
    return this._smoothedPosition;
  }

  public shouldSnapImmediate(now: number = getTime()): boolean {
    if (this._samples.length === 0) {
      return false;
    }
    if (!this._hasResolvedEstimate) {
      return true;
    }
    const latest = this._samples[this._samples.length - 1];
    return now - latest.time >= STALE_GAP_S;
  }

  public clearSamples(): void {
    this._samples = [];
  }

  private _pruneSamples(now: number): void {
    while (this._samples.length > 0) {
      if (now - this._samples[0].time <= SAMPLE_WINDOW_S) {
        break;
      }
      this._samples.shift();
    }
  }
}
