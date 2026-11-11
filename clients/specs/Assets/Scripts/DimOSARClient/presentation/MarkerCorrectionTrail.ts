import type { ClientTrackingOrigin } from "../localization/clientTrackingOrigin";
import type { Vec3 } from "../websocket/protocolTypes";

/** Visual only: the authoritative marker keeps its existing placement behavior. */
export class MarkerCorrectionTrail {
  private origin: ClientTrackingOrigin | null = null;
  private previous: Vec3 | null = null;
  private start: Vec3 | null = null;
  private startedAt = 0;
  private duration = 0;
  displayedPosition: Vec3 | null = null;
  scale = 1;
  constructor(private readonly unitsPerMetre = 1) {}

  update(origin: ClientTrackingOrigin | null, position: Vec3, now: number): Vec3 | null {
    if (!origin) { this.reset(); return null; }
    const prior = this.origin;
    if (prior && this.previous) {
      const a = prior.mapAlignment, b = origin.mapAlignment;
      if (a?.map_code !== b?.map_code || a?.odom_reference_id !== b?.odom_reference_id ||
          a?.tracking_reference_id !== b?.tracking_reference_id) this.start = null;
      else if (origin.position.some((v, i) => Math.abs(v - prior.position[i]) > 1e-6) ||
          Math.abs(origin.orientation.reduce((dot, v, i) => dot + v * prior.orientation[i], 0)) < 1 - 1e-10) {
        this.start = this.previous;
        this.startedAt = now;
        this.duration = Math.min(0.5, Math.hypot(...position.map((v, i) => v - this.start![i])) / (0.25 * this.unitsPerMetre) * 0.5);
      }
    }
    this.origin = origin;
    this.displayedPosition = null;
    this.scale = 1;
    if (!this.start) { this.previous = [...position]; return null; }
    const elapsed = Math.max(0, now - this.startedAt);
    const t = this.duration > 0 ? Math.min(1, elapsed / this.duration) : 1;
    this.displayedPosition = this.start.map((v, i) => v + (position[i] - v) * t) as Vec3;
    this.previous = [...this.displayedPosition];
    this.scale = Math.max(0, 1 - Math.max(0, elapsed - this.duration) / 0.1);
    if (this.scale <= 1e-6) { this.start = null; this.displayedPosition = null; return null; }
    return [...this.start];
  }

  reset(): void { this.origin = null; this.previous = this.start = this.displayedPosition = null; this.scale = 1; }
}
