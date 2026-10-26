import type { Quat, Vec3 } from "../websocket/protocolTypes";
import type { NavigationPose } from "./NavigationGoalLifecycle";
import { NavigationHeading } from "./NavigationPolicy";
export type NavigationInputId = string;
export type Placement = { position: Vec3; blocked: boolean } | null;
export type PlacementStage = "none" | "probe" | "preview";
export const DRAG_THRESHOLD_M = 0.11;
export { DRAG_HEADING_MIN_DELTA_M, DRAG_HEADING_SMOOTHING_RATE } from "./NavigationPolicy";

/** Per-source probes and one owned draft. Contains no robot execution state or host objects. */
export class NavigationPlacementSession {
  private probes = new Map<NavigationInputId, Vec3>();
  private owner: NavigationInputId | null = null;
  private pose: NavigationPose | null = null;
  private held = false;
  private firstGesture = false;
  private readonly heading = new NavigationHeading();
  private readonly cancelledGestures = new Set<NavigationInputId>();
  update(id: NavigationInputId, now: number, placement: Placement, _heading: Quat): void {
    if (!placement || placement.blocked) { this.remove(id); return; }
    this.probes.set(id, [...placement.position]);
    if (this.owner !== id || !this.pose || this.held && !this.firstGesture) return;
    this.pose = { position: [...placement.position], orientation: this.heading.update(placement.position, now) };
  }
  press(id: NavigationInputId, now: number, placement: Placement, heading: Quat): boolean {
    if (this.cancelledGestures.has(id) || this.owner && this.owner !== id) return false;
    if (!placement || placement.blocked) { if (this.held && this.owner === id) this.cancelledGestures.add(id); this.remove(id); return false; }
    if (!this.owner) {
      this.owner = id; this.firstGesture = true;
      this.pose = { position: [...placement.position], orientation: [...heading] };
      this.heading.reset(placement.position, heading, now);
    }
    this.held = true; this.update(id, now, placement, heading); return true;
  }
  release(id: NavigationInputId, _now: number, placement: Placement): NavigationPose | null {
    if (this.cancelledGestures.delete(id)) return null;
    if (this.owner !== id || !this.held || !this.pose) return null;
    if (!placement || placement.blocked) { this.remove(id); return null; }
    this.held = false;
    if (this.firstGesture) { this.firstGesture = false; return null; }
    // Confirmation uses the displayed draft frozen on press, not release jitter.
    const result = { position: [...this.pose.position] as Vec3, orientation: [...this.pose.orientation] as Quat };
    this.clearDraft(); return result;
  }
  remove(id: NavigationInputId): void { this.probes.delete(id); if (this.owner === id) this.clearDraft(); }
  clear(): void { this.probes.clear(); this.clearDraft(); this.cancelledGestures.clear(); }
  snapshot() {
    return { probes: [...this.probes].filter(([id]) => id !== this.owner).map(([sourceId, position]) => ({ sourceId, position: [...position] as Vec3 })),
      draft: this.owner && this.pose ? { ownerId: this.owner, position: [...this.pose.position] as Vec3, orientation: [...this.pose.orientation] as Quat, held: this.held, firstGesture: this.firstGesture } : null };
  }
  private clearDraft(): void { this.owner = null; this.pose = null; this.held = this.firstGesture = false; }
}
