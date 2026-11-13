import type { ReadonlyFacts } from "../ClientContracts";
import { lerpVec3, slerpQuat, type PositionOrientation } from "./ClientTracking";

export interface PoseSample extends PositionOrientation { t: number; }
export interface PoseHistoryPolicy {
  maxNearestAgeS: number;
  /** Platforms may allow an older bracketing pair while still rejecting stale extrapolation. */
  maxBracketAgeS: number;
}

/** Look up exposure-time tracking without depending on camera or rendering SDK objects. */
export function lookupPoseSample(
  buffer: readonly ReadonlyFacts<PoseSample>[],
  timestamp: number,
  policy: Readonly<PoseHistoryPolicy>,
): ReadonlyFacts<PoseSample> | null {
  if (!Number.isFinite(timestamp) || !buffer.length) return null;
  let before: ReadonlyFacts<PoseSample> | null = null;
  let after: ReadonlyFacts<PoseSample> | null = null;
  for (const sample of buffer) {
    if (sample.t <= timestamp) before = sample;
    else { after = sample; break; }
  }
  if (before && after && after.t > before.t) {
    if (timestamp - before.t > policy.maxBracketAgeS || after.t - timestamp > policy.maxBracketAgeS) return null;
    const fraction = (timestamp - before.t) / (after.t - before.t);
    return {
      t: timestamp,
      position: lerpVec3(before.position, after.position, fraction),
      orientation: slerpQuat(before.orientation, after.orientation, fraction),
    };
  }
  const nearest = before ?? after;
  return nearest && Math.abs(nearest.t - timestamp) <= policy.maxNearestAgeS ? nearest : null;
}

/** One bounded, chronological history; insertion takes ownership of copied tuple values. */
export class CapturePoseHistory {
  private readonly samples: ReadonlyFacts<PoseSample>[] = [];
  constructor(private readonly capacity: number, private readonly policy: Readonly<PoseHistoryPolicy>) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("Invalid pose history capacity");
    if (![policy.maxNearestAgeS, policy.maxBracketAgeS].every(age => age >= 0)) throw new Error("Invalid pose history age");
  }
  sample(sample: ReadonlyFacts<PoseSample>): void {
    if (!Number.isFinite(sample.t)) throw new Error("Pose timestamp must be finite");
    const previous = this.latest();
    if (previous && sample.t < previous.t) throw new Error("Pose timestamps must not decrease");
    const owned = { t: sample.t, position: [...sample.position] as PositionOrientation["position"],
      orientation: [...sample.orientation] as PositionOrientation["orientation"] };
    if (previous && sample.t === previous.t) this.samples[this.samples.length - 1] = owned;
    else this.samples.push(owned);
    if (this.samples.length > this.capacity) this.samples.shift();
  }
  read(timestamp: number): ReadonlyFacts<PoseSample> | null {
    return lookupPoseSample(this.samples, timestamp, this.policy);
  }
  latest(): ReadonlyFacts<PoseSample> | null { return this.samples[this.samples.length - 1] ?? null; }
  clear(): void { this.samples.length = 0; }
}
