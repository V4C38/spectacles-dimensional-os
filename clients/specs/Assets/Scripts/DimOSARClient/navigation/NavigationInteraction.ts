import type { ClientTrackingOrigin } from "../localization/clientTrackingOrigin";
import type { ARModuleSessionState } from "../websocket/arModuleSession";
import type { Quat, Vec3, YawPose } from "../websocket/protocolTypes";
import { NavigationPreviewCoordinator } from "./NavigationPreviewCoordinator";
import { NavigationGoalLifecycle, type NavigationPose, type NavigationCommands, type NavFlash } from "./NavigationGoalLifecycle";
import { NavigationPlacementSession, DRAG_THRESHOLD_M, type Placement, type NavigationInputId, type PlacementStage } from "./NavigationPlacementSession";
export { FLASH_DURATION_S, NAV_FEEDBACK_TIMING, GOAL_SEND_INTERVAL_S, GOAL_SEND_MIN_DISTANCE_M } from "./NavigationGoalLifecycle";
export { DRAG_THRESHOLD_M, DRAG_HEADING_MIN_DELTA_M, DRAG_HEADING_SMOOTHING_RATE } from "./NavigationPlacementSession";
export * from "./NavigationPolicy";
import { NavigationHeading } from "./NavigationPolicy";
export type { NavFlash, Placement, PlacementStage, NavigationInputId };

export interface NavigationTargetSnapshot {
  visible: boolean; position: Vec3; orientation: Quat; selected: boolean;
  aiming: boolean; goalActive: boolean; cancelVisible: boolean; flash: NavFlash | null;
  placementStage: PlacementStage; probePosition: Vec3 | null; dragging: boolean; placementHeld: boolean;
  followingPath: boolean; attachedToRobot: boolean; feedbackId: number; feedbackProgress: number;
  activeGoal: ReturnType<NavigationGoalLifecycle["snapshot"]>;
  probes: ReturnType<NavigationPlacementSession["snapshot"]>["probes"];
  draft: ReturnType<NavigationPlacementSession["snapshot"]>["draft"];
}
const DEFAULT_SOURCE = "default";

/** Coordinates independent execution and draft lifecycles; hosts only solve and render placement. */
export class NavigationInteraction {
  readonly goals: NavigationGoalLifecycle;
  readonly placement = new NavigationPlacementSession();
  private origin: ClientTrackingOrigin | null = null;
  private selected = false;
  private armed = false;
  private floor: NavigationPose | null = null;
  private directPose: NavigationPose | null = null;
  private directStart: Vec3 | null = null;
  private dragging = false;
  private directHeading: Quat = [0, 0, 0, 1];
  private readonly heading = new NavigationHeading();
  constructor(commands: NavigationCommands, private readonly previews: NavigationPreviewCoordinator) { this.goals = new NavigationGoalLifecycle(commands); }
  snapshot(): NavigationTargetSnapshot {
    const goal = this.goals.snapshot(), placement = this.placement.snapshot();
    const draft = placement.draft;
    const pose = draft ?? this.directPose ?? goal.pose ?? this.floor ?? { position: [0, 0, 0] as Vec3, orientation: [0, 0, 0, 1] as Quat };
    return { ...pose, visible: this.armed, selected: this.selected, aiming: !!draft,
      goalActive: goal.active, cancelVisible: goal.cancelVisible && !this.dragging,
      flash: goal.flash, feedbackId: goal.feedbackId, feedbackProgress: goal.feedbackProgress,
      placementStage: draft ? "preview" : placement.probes.length ? "probe" : "none",
      probePosition: placement.probes[0]?.position ?? null, dragging: this.dragging,
      placementHeld: draft?.held ?? false, followingPath: goal.followingPath,
      attachedToRobot: goal.attachedToRobot && !this.dragging && !draft,
      activeGoal: goal, ...placement };
  }
  applyView(view: ARModuleSessionState, origin: ClientTrackingOrigin | null, floor: NavigationPose | null, _now: number): void {
    this.previews.apply(origin);
    const available = view.connection === "ready" && view.hasTrackingOrigin && view.capabilities?.navigation.nav_goal.available === true && origin !== null;
    if (!available || this.origin !== origin) this.cancelDrag();
    this.origin = available ? origin : null; this.floor = floor; this.armed = available;
    if (!available) this.selected = false;
    this.goals.apply(view, this.origin, floor);
  }
  tick(now: number, visibleDeltaS = 0): void {
    this.goals.tick(visibleDeltaS);
    const draft = this.placement.snapshot().draft;
    if (draft) this.previews.aim(draft.position, draft.orientation);
    this.previews.tick(now);
  }
  setSelected(selected: boolean): void { if (this.selected === selected) return; this.selected = selected; if (!selected) this.cancelDrag(); }
  isAiming(): boolean { return this.placement.snapshot().draft !== null; }
  isDragging(): boolean { return this.dragging; }
  isRouteVisible(): boolean { return this.armed && this.flash() === null; }
  activePath(): YawPose[] | null { return this.goals.snapshot().path; }
  previewPath(): YawPose[] | null { return this.previews.previewPath(); }
  flash(): NavFlash | null { return this.goals.snapshot().flash; }
  aim(now: number, placed: Placement, sourceId = DEFAULT_SOURCE): void {
    if (!this.selected || !this.armed || this.dragging) { this.clearAim(sourceId); return; }
    this.placement.update(sourceId, now, placed, this.goals.snapshot().pose?.orientation ?? [0, 0, 0, 1]);
    const draft = this.placement.snapshot().draft;
    if (draft) { this.previews.aim(draft.position, draft.orientation); this.previews.tick(now); } else this.previews.clear();
  }
  clearAim(sourceId?: NavigationInputId): void {
    if (sourceId === undefined) this.placement.clear(); else this.placement.remove(sourceId);
    if (!this.isAiming()) this.previews.clear();
  }
  ownsDraft(sourceId: NavigationInputId): boolean { return this.placement.snapshot().draft?.ownerId === sourceId; }
  hold(now: number, placed: Placement, streamWhileDragging = true, sourceId = DEFAULT_SOURCE): boolean {
    if (!this.armed || !this.origin) return false;
    if (this.selected || !streamWhileDragging) {
      if (!this.selected) return false;
      return this.placement.press(sourceId, now, placed, this.goals.snapshot().pose?.orientation ?? [0, 0, 0, 1]);
    }
    if (!placed || placed.blocked) return false;
    if (!this.directStart) {
      this.directStart = [...(this.goals.snapshot().pose?.position ?? placed.position)];
      this.directHeading = this.goals.snapshot().pose?.orientation ?? [0, 0, 0, 1];
      this.heading.reset(this.directStart, this.directHeading, now);
    }
    const dx = placed.position[0] - this.directStart[0], dy = placed.position[1] - this.directStart[1];
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD_M) this.dragging = true;
    if (this.dragging) {
      this.directHeading = this.heading.update(placed.position, now);
      this.directPose = { position: [...placed.position], orientation: this.directHeading };
      this.goals.send(now, this.directPose, false);
    }
    return this.dragging;
  }
  release(now: number, placed: Placement, sourceId = DEFAULT_SOURCE): void {
    if (this.selected) {
      const pose = this.placement.release(sourceId, now, placed);
      if (pose) { this.goals.send(now, pose); this.previews.clear(); }
      else { const draft = this.placement.snapshot().draft; if (draft) { this.previews.aim(draft.position, draft.orientation); this.previews.tick(now); } }
    } else if (this.dragging && placed && !placed.blocked) {
      this.goals.send(now, { position: placed.position, orientation: this.directHeading });
    }
    this.directPose = null; this.directStart = null; this.dragging = false;
  }
  /** Adapter for hosts whose native drag system already computes a complete pose. */
  sendDirect(now: number, pose: NavigationPose, force: boolean): boolean { return this.goals.send(now, pose, force); }
  cancel(_now: number): boolean { this.cancelDrag(); return this.goals.cancel(); }
  cancelDrag(): void { this.placement.clear(); this.previews.clear(); this.directPose = null; this.directStart = null; this.dragging = false; }
  reset(): void { this.cancelDrag(); this.goals.reset(); this.origin = null; this.floor = null; this.armed = this.selected = false; }
  dispose(): void { this.reset(); this.previews.reset(); }
}
