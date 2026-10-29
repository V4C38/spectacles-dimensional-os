import type { Vec3 } from "../websocket/protocolTypes";

/** Horizontal physical travel in one headset tracking reference, independent of AR corrections. */
export class HeadsetTravel {
  total = 0;
  private anchor: Vec3 | null = null;
  private lastAt: number | null = null;
  private history: { at: number; travel: number }[] = [];
  sample(position: Vec3, now: number): void {
    if (position.some(value => !Number.isFinite(value)) || !Number.isFinite(now)) { this.pause(); return; }
    if (this.lastAt !== null && now - this.lastAt < 0.1) return;
    if (this.lastAt === null || now - this.lastAt > 0.5) this.anchor = null;
    if (this.anchor) {
      const distance = Math.hypot(position[0] - this.anchor[0], position[1] - this.anchor[1]);
      if (distance >= 0.05) { this.total += distance; this.anchor = [...position]; }
    } else this.anchor = [...position];
    this.lastAt = now;
    this.history.push({ at: now, travel: this.total });
    if (this.history.length > 300) this.history.shift();
  }
  at(timestamp: number): number {
    for (let i = this.history.length - 1; i >= 0; i--) if (this.history[i].at <= timestamp) return this.history[i].travel;
    return this.history[0]?.travel ?? this.total;
  }
  pause(): void { this.anchor = null; this.lastAt = null; }
  reset(): void { this.pause(); this.total = 0; this.history = []; }
}
