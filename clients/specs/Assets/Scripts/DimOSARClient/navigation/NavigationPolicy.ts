import type { NavState, Quat, Vec3 } from "../websocket/protocolTypes";
import { GOAL_SEND_INTERVAL_S, GOAL_SEND_MIN_DISTANCE_M } from "./NavigationGoalLifecycle";
export type LiveNavGoalInput = {
  activated: boolean;
  hasSentGoal: boolean;
  hasReceivedPose: boolean;
  followingPath: boolean;
};

export function isLiveNavGoal(input: LiveNavGoalInput): boolean {
  return input.activated || input.hasSentGoal || input.hasReceivedPose || input.followingPath;
}

export function isNavGoalCancelVisible(
  input: LiveNavGoalInput & { flashing: boolean; dragging: boolean },
): boolean {
  if (input.flashing || input.dragging) {
    return false;
  }
  return isLiveNavGoal(input);
}

export function shouldBeginFailedFlash(
  prev: NavState | null | undefined,
  next: NavState | null | undefined,
  liveGoal: boolean,
): boolean {
  return !isResolvedFailed(prev) && isResolvedFailed(next) && liveGoal;
}

export function shouldSendStreamGoal(
  now: number,
  lastSendTime: number,
  position: Vec3,
  lastSent: Vec3 | null,
  force: boolean,
): boolean {
  if (force) {
    return true;
  }
  if (now - lastSendTime < GOAL_SEND_INTERVAL_S) {
    return false;
  }
  if (!lastSent) {
    return true;
  }
  return distance(lastSent, position) >= GOAL_SEND_MIN_DISTANCE_M;
}

export function yawFromPlanarDirection(x: number, y: number): Quat {
  const yaw = Math.atan2(y, x);
  const half = yaw * 0.5;
  return [0, 0, Math.sin(half), Math.cos(half)];
}

export function robotDeadzoneRadiusM(footprint: [number, number]): number {
  return Math.max(0.2, Math.max(...footprint) * 0.5 + 0.2);
}


function distance(a: Vec3, b: Vec3): number { return Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]); }
function isResolvedFailed(nav: NavState | null | undefined): boolean { return nav?.state === "resolved" && nav.outcome === "failed"; }

export const DRAG_HEADING_MIN_DELTA_M = 0.03;
export const DRAG_HEADING_SMOOTHING_RATE = 6;

/** A gate rejects tracking jitter; time-based easing smooths drag-direction turns. */
export class NavigationHeading {
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
    const next = yaw + delta * (1 - Math.exp(-DRAG_HEADING_SMOOTHING_RATE * Math.max(0, now - this.lastAt)));
    this.lastAt = now; this.current = [0, 0, Math.sin(next / 2), Math.cos(next / 2)]; return [...this.current];
  }
}
