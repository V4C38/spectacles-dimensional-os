import { sameTrackingReference } from "../localization/clientTrackingOrigin";
import type { InteractionAuthorityPort } from "../replication/CollaborationTypes";
import { clientTrackingToOdomPose, odomToClientTrackingPose } from "../localization/clientTrackingTransforms";
import type { ClientTrackingOrigin } from "../localization/clientTrackingOrigin";
import type { ARModuleSessionState } from "../websocket/arModuleSession";
import type { Quat, Vec3, YawPose } from "../websocket/protocolTypes";
import { NavigationPreviewCoordinator } from "./NavigationPreviewCoordinator";
import { NavigationGoalLifecycle, type NavigationPose, type NavigationCommands, type NavFlash } from "./NavigationGoalLifecycle";
import { NavigationPlacementSession, DRAG_THRESHOLD_M, type Placement, type NavigationInputId, type PlacementStage } from "./NavigationPlacementSession";
export { FLASH_DURATION_S, NAV_FEEDBACK_ANIMATION_S, NAV_FEEDBACK_TIMING, GOAL_SEND_INTERVAL_S, GOAL_SEND_MIN_DISTANCE_M } from "./NavigationGoalLifecycle";
export { DRAG_THRESHOLD_M, DRAG_HEADING_MIN_DELTA_M, DRAG_HEADING_SMOOTHING_RATE } from "./NavigationPlacementSession";
export * from "./NavigationPolicy";
import { NavigationHeading } from "./NavigationPolicy";
export type { NavFlash, Placement, PlacementStage, NavigationInputId };

export interface NavigationTargetSnapshot {
  blocked?: boolean;
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
  private direct: { source: NavigationInputId; start: Vec3; heading: Quat; pose: NavigationPose | null } | null = null;
  private get directSource(): NavigationInputId | null { return this.direct?.source ?? null; }
  private get directPose(): NavigationPose | null { return this.direct?.pose ?? null; }
  private get dragging(): boolean { return this.direct?.pose !== null && this.direct !== null; }
  private readonly heading: NavigationHeading;
  private lastDenial = 0;
  constructor(commands: NavigationCommands, private readonly previews: NavigationPreviewCoordinator, headingSmoothingRate = 6, private readonly collaboration: InteractionAuthorityPort) { if (!collaboration) throw new Error("Navigation requires interaction authority"); this.goals = new NavigationGoalLifecycle(commands); this.heading = new NavigationHeading(headingSmoothingRate); }
  snapshot(): NavigationTargetSnapshot {
    const goal = this.goals.snapshot(), placement = this.placement.snapshot();
    const shared = this.collaboration.snapshot();
    const remote = shared.target && this.origin && !shared.ownsAuthority && !shared.pending
      ? odomToClientTrackingPose(shared.target, this.origin) : null;
    const remoteDraft = remote && shared.phase === "draft" && shared.planning ? {
      ownerId: `remote:${shared.authority!.client_id}`, position: remote.position, orientation: remote.orientation,
      held: shared.authority!.held, firstGesture: false,
    } : null;
    const draft = placement.draft ?? remoteDraft;
    const remoteLive = remote && shared.authority?.kind === "live";
    const pose = draft ?? this.directPose ?? (remoteLive || shared.phase === "committed" && !goal.pose ? remote : null) ?? goal.pose ?? this.floor ?? { position: [0, 0, 0] as Vec3, orientation: [0, 0, 0, 1] as Quat };
    return { ...pose, blocked: shared.blocked ?? false, visible: this.armed, selected: this.selected, aiming: !!draft,
      goalActive: goal.active, cancelVisible: goal.cancelVisible && !this.dragging,
      flash: goal.flash, feedbackId: goal.feedbackId, feedbackProgress: goal.feedbackProgress,
      placementStage: draft ? "preview" : placement.probes.length ? "probe" : "none",
      probePosition: placement.probes[0]?.position ?? null, dragging: this.dragging || !!remoteLive,
      placementHeld: draft?.held ?? false, followingPath: goal.followingPath,
      attachedToRobot: goal.attachedToRobot && !this.dragging && !draft,
      activeGoal: remote && shared.phase === "committed" && !goal.pose ? { ...goal, pose: remote } : goal, ...placement, draft };
  }
  applyView(view: ARModuleSessionState, origin: ClientTrackingOrigin | null, floor: NavigationPose | null, _now: number): void {
    this.previews.apply(origin);
    const available = view.connection === "ready" && view.hasTrackingOrigin && view.capabilities?.navigation.available === true && view.capabilities.navigation.nav_goal.available === true && origin !== null;
    if (!available || !sameTrackingReference(this.origin, origin)) this.cancelDrag();
    else if (this.origin && origin && this.origin !== origin) {
      const previous = this.origin;
      const convert = (pose: NavigationPose) => odomToClientTrackingPose(clientTrackingToOdomPose(pose, previous), origin);
      this.placement.rebase(convert, _now);
      if (this.direct) {
        const baseline = convert({ position: this.direct.start, orientation: this.direct.heading });
        this.direct.start = baseline.position;
        this.direct.heading = baseline.orientation;
        if (this.direct.pose) this.direct.pose = convert(this.direct.pose);
        this.heading.reset(this.direct.pose?.position ?? baseline.position, this.direct.pose?.orientation ?? baseline.orientation, _now);
      }
    }
    this.origin = available ? origin : null; this.floor = floor; this.armed = available;
    if (!available) this.selected = false;
    const shared = this.collaboration.snapshot();
    if (shared.blocked || this.lastDenial !== this.collaboration.denialRevision) {
      this.placement.clear(); this.previews.clear(); this.direct = null;
    }
    this.lastDenial = this.collaboration.denialRevision;
    this.goals.apply(view, this.origin, floor);
  }
  tick(now: number, visibleDeltaS = 0): void {
    this.goals.tick(visibleDeltaS);
    const draft = this.placement.snapshot().draft;
    if (draft && this.origin) this.collaboration.update(clientTrackingToOdomPose(draft, this.origin));
    if (draft && this.collaboration.snapshot().ownsAuthority) this.previews.aim(draft.position, draft.orientation);
    this.previews.tick(now);
  }
  setSelected(selected: boolean): void { if (this.selected === selected) return; this.selected = selected; if (!selected) this.cancelDrag(); }
  isAiming(): boolean { return this.snapshot().draft !== null; }
  isDragging(): boolean { return this.dragging; }
  isRouteVisible(): boolean { return this.armed && this.flash() === null; }
  activePath(): YawPose[] | null { return this.goals.snapshot().path; }
  previewPath(): YawPose[] | null {
    return this.previews.displayPath();
  }
  flash(): NavFlash | null { return this.goals.snapshot().flash; }
  aim(now: number, placed: Placement, sourceId = DEFAULT_SOURCE): void {
    if (this.directSource !== null || this.collaboration.snapshot().blocked) return;
    if (!this.selected || !this.armed) { this.clearAim(sourceId); return; }
    const hadDraft = this.placement.snapshot().draft !== null;
    this.placement.update(sourceId, now, placed, this.goals.snapshot().pose?.orientation ?? [0, 0, 0, 1]);
    const draft = this.placement.snapshot().draft;
    if (hadDraft && !draft) this.collaboration.cancel(["live", "navigation_planning"]);
    if (draft) { this.previews.aim(draft.position, draft.orientation); this.previews.tick(now); } else this.previews.clear();
  }
  clearAim(sourceId?: NavigationInputId): void {
    if (this.directSource !== null && (sourceId === undefined || sourceId === this.directSource)) { this.cancelDrag(); return; }
    const wasOwner = this.placement.snapshot().draft?.ownerId === sourceId || sourceId === undefined;
    if (sourceId === undefined) this.placement.clear(); else this.placement.remove(sourceId);
    if (wasOwner && !this.placement.snapshot().draft) this.collaboration.cancel(["live", "navigation_planning"]);
    if (!this.isAiming()) this.previews.clear();
  }
  ownsDraft(sourceId: NavigationInputId): boolean { return this.placement.snapshot().draft?.ownerId === sourceId; }
  hold(now: number, placed: Placement, streamWhileDragging = true, sourceId = DEFAULT_SOURCE): boolean {
    if (!this.armed || !this.origin || this.collaboration.snapshot().blocked) return false;
    if (this.directSource !== null && this.directSource !== sourceId) return false;
    if (!streamWhileDragging) {
      if (!this.selected) return false;
      if (placed && !placed.blocked && !this.collaboration.begin("navigation_planning", sourceId,
        clientTrackingToOdomPose({ position: placed.position, orientation: this.goals.snapshot().pose?.orientation ?? [0, 0, 0, 1] }, this.origin))) return false;
      return this.placement.press(sourceId, now, placed, this.goals.snapshot().pose?.orientation ?? [0, 0, 0, 1]);
    }
    if (this.placement.snapshot().draft) return false;
    if (!placed || placed.blocked) return false;
    if (!this.direct) {
      if (!this.collaboration.begin("live", sourceId, clientTrackingToOdomPose({
        position: placed.position, orientation: this.goals.snapshot().pose?.orientation ?? [0, 0, 0, 1] }, this.origin))) return false;
      this.placement.clear(); this.previews.clear();
      this.direct = { source: sourceId, pose: null,
        start: [...(this.goals.snapshot().pose?.position ?? placed.position)],
        heading: this.goals.snapshot().pose?.orientation ?? [0, 0, 0, 1] };
      this.heading.reset(this.direct.start, this.direct.heading, now);
    }
    const dx = placed.position[0] - this.direct.start[0], dy = placed.position[1] - this.direct.start[1];
    if (this.dragging || Math.hypot(dx, dy) > DRAG_THRESHOLD_M) {
      this.direct.heading = this.heading.update(placed.position, now);
      this.direct.pose = { position: [...placed.position], orientation: this.direct.heading };
      this.collaboration.update(clientTrackingToOdomPose(this.direct.pose, this.origin));
      this.goals.send(now, this.direct.pose);
    }
    return this.dragging;
  }
  release(now: number, placed: Placement, sourceId = DEFAULT_SOURCE): void {
    if (this.directSource !== null && this.directSource !== sourceId) return;
    if (this.selected && this.directSource === null) {
      const pose = this.placement.release(sourceId, now, placed);
      if (pose) {
        if (this.origin) {
          this.goals.submitted(now, pose);
          this.collaboration.confirm(clientTrackingToOdomPose(pose, this.origin), ["navigation_planning"]);
        } else this.collaboration.cancel(["navigation_planning"]);
        this.previews.clear();
      }
      else { const draft = this.placement.snapshot().draft; if (draft) {
        if (this.origin) this.collaboration.release(clientTrackingToOdomPose(draft, this.origin), ["navigation_planning"]);
        this.previews.aim(draft.position, draft.orientation); this.previews.tick(now);
      } else this.collaboration.cancel(["live", "navigation_planning"]); }
    } else if (this.dragging && placed && !placed.blocked) {
      const finalPose = { position: placed.position, orientation: this.direct!.heading };
      if (this.origin) {
        this.goals.submitted(now, finalPose);
        this.collaboration.release(clientTrackingToOdomPose(finalPose, this.origin), ["live"]);
      } else this.collaboration.cancel(["live"]);
    }
    if (this.directSource && (!this.dragging || !placed || placed.blocked))
      this.collaboration.cancel(["live", "navigation_planning"]);
    this.direct = null;
  }
  cancel(_now: number): boolean { this.cancelDrag(); return this.goals.cancel(); }
  cancelDrag(): void { this.collaboration.cancel(["live", "navigation_planning"]); this.placement.clear(); this.previews.clear(); this.direct = null; }
  reset(): void { this.cancelDrag(); this.goals.reset(); this.origin = null; this.floor = null; this.armed = this.selected = false; }
  dispose(): void { this.reset(); this.previews.reset(); }
}
