import type { Quat, Vec3 } from "../websocket/protocolTypes";

export function yawFromPlanarDirection(x: number, y: number): Quat {
  const yaw = Math.atan2(y, x);
  const half = yaw * 0.5;
  return [0, 0, Math.sin(half), Math.cos(half)];
}

export function robotDeadzoneRadiusM(footprint: [number, number]): number {
  return Math.max(0.2, Math.max(...footprint) * 0.5 + 0.2);
}

export const DRAG_HEADING_MIN_DELTA_M = 0.03;
export const DRAG_HEADING_SMOOTHING_RATE = 6;

/** A gate rejects tracking jitter; time-based easing smooths drag-direction turns. */
export class NavigationHeading {
  constructor(private readonly smoothingRate = DRAG_HEADING_SMOOTHING_RATE) {}
  private gate: Vec3 | null = null;
  private current: Quat = [0, 0, 0, 1];
  private target: Quat = [0, 0, 0, 1];
  private lastAt = 0;
  reset(position: Vec3, heading: Quat, now: number): void { this.gate = [...position]; this.current = [...heading]; this.target = [...heading]; this.lastAt = now; }
  update(position: Vec3, now: number): Quat {
    if (this.gate && Math.hypot(position[0] - this.gate[0], position[1] - this.gate[1]) >= DRAG_HEADING_MIN_DELTA_M) {
      this.target = yawFromPlanarDirection(position[0] - this.gate[0], position[1] - this.gate[1]); this.gate = [...position];
    }
    const yaw = 2 * Math.atan2(this.current[2], this.current[3]), target = 2 * Math.atan2(this.target[2], this.target[3]);
    const delta = Math.atan2(Math.sin(target - yaw), Math.cos(target - yaw));
    const next = yaw + delta * (1 - Math.exp(-this.smoothingRate * Math.max(0, now - this.lastAt)));
    this.lastAt = now; this.current = [0, 0, Math.sin(next / 2), Math.cos(next / 2)]; return [...this.current];
  }
}
