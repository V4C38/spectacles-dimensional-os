import type { Quat, Vec3, YawPose, InteractionAuthorityPort, NavGoal, ReadonlyFacts } from "../ClientContracts";
import { type ClientTrackingOrigin, clientTrackingToOdomPose, odomToClientTrackingYawPose, odomToClientTrackingPose, sameTrackingReference } from "../localization/ClientTracking";

import type { ARModuleSessionState, ARModuleSession } from "../websocket/ARModuleSession";


import { requestNavPreview } from "./NavigationCommands";





export function yawFromPlanarDirection(x: number, y: number): Quat {
  const yaw = Math.atan2(y, x);
  const half = yaw * 0.5;
  return [0, 0, Math.sin(half), Math.cos(half)];
}

export function robotDeadzoneRadiusM(footprint: readonly [number, number]): number {
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

export type NavigationPose = { position: Vec3; orientation: Quat };
export type NavFlash = "succeeded" | "cancelled" | "failed";
export const NAV_FEEDBACK_TIMING = { traceS: 0.25, glyphS: 0.15, holdS: 0.35 } as const;
/** Drawing reaches progress 1 before the completed-state hold begins. */
export const NAV_FEEDBACK_ANIMATION_S = NAV_FEEDBACK_TIMING.traceS + NAV_FEEDBACK_TIMING.glyphS;
export const FLASH_DURATION_S = NAV_FEEDBACK_ANIMATION_S + NAV_FEEDBACK_TIMING.holdS;
export const GOAL_SEND_INTERVAL_S = 0.35;
export const GOAL_SEND_MIN_DISTANCE_M = 0.2;
export type NavigationCommands = { sendGoal: (pose: NavigationPose) => void; cancel: () => void };

/** Owns execution facts and terminal feedback. Placement drafts never modify this state. */
export class NavigationGoalLifecycle {
  private view: ARModuleSessionState | null = null;
  private origin: ReadonlyFacts<ClientTrackingOrigin> | null = null;
  private floor: NavigationPose | null = null;
  private pose: NavigationPose | null = null;
  private phase: "idle" | "submitted" | "accepted" | "resolved" = "idle";
  private get active(): boolean { return this.phase === "submitted" || this.phase === "accepted"; }
  private get resolved(): boolean { return this.phase === "resolved"; }
  private get awaitingFreshFacts(): boolean { return this.phase === "submitted"; }
  private route: NavGoal["path_poses"] | null = null;
  private routeGoal: Readonly<YawPose> | null = null;
  private lastFrame: ARModuleSessionState["nav_goal"] = null;
  private newestTs = -Infinity;
  private retiredTs = -Infinity;
  private suppressed: ARModuleSessionState["nav_goal"] = null;
  private lastNav: ARModuleSessionState["nav"] = null;
  private submissionBaseline: ARModuleSessionState["nav"] = null;
  private postAcceptanceIdle = false;
  private sharedCancellation = false;
  private lastSent: Vec3 | null = null;
  private lastSentAt = -Infinity;
  private flash: NavFlash | null = null;
  private elapsed = 0;
  private feedbackId = 0;
  private confirmationId = 0;
  constructor(private readonly commands: NavigationCommands) {}

  apply(view: ARModuleSessionState, origin: ReadonlyFacts<ClientTrackingOrigin> | null, floor: NavigationPose | null): void {
    this.view = view;
    this.floor = floor;
    if (!origin || !view.hasTrackingOrigin || view.connection !== "ready" || view.capabilities?.navigation.nav_goal.available !== true) {
      this.reset(); return;
    }
    if (this.origin !== origin) this.route = null;
    this.origin = origin;
    const frame = view.nav_goal;
    const freshGoal = this.isFreshGoal(frame, view);
    const newAcceptedGoal = freshGoal && (frame.ts > this.newestTs || !sameYawPose(frame.pose, this.routeGoal));
    if (newAcceptedGoal) {
      this.postAcceptanceIdle = false;
      this.sharedCancellation = false;
    }
    if (freshGoal) {
      this.newestTs = frame.ts;
      this.phase = "accepted";
      this.flash = null;
      this.elapsed = 0;
    }
    const navChanged = view.nav !== this.lastNav;
    // Rendering/ticking a cached resolved fact after send is not a new outcome.
    const freshState = navChanged && view.nav !== this.submissionBaseline;
    if (this.active && !newAcceptedGoal && freshState && view.nav?.state === "idle") {
      this.postAcceptanceIdle = true;
    }
    const awaitingAtArrival = this.awaitingFreshFacts;
    if (this.awaitingFreshFacts && freshState && view.nav?.state !== "resolved") {
      this.phase = "accepted";
    }
    const outcomeChanged = this.submissionBaseline?.state !== "resolved" ||
      view.nav?.outcome !== this.submissionBaseline.outcome;
    const terminal = freshState && view.nav?.state === "resolved" &&
      (!this.awaitingFreshFacts || outcomeChanged);
    const stoppedFollowing = freshState && this.lastNav?.state === "following_path";
    const goalClearedAfterAcceptance = this.active && this.postAcceptanceIdle &&
      view.interaction?.active_goal === null;
    const cancelled = !awaitingAtArrival && view.nav?.state === "idle" &&
      (stoppedFollowing || goalClearedAfterAcceptance);
    const correctedTerminal = terminal && this.sharedCancellation && this.flash === "cancelled";
    const hasExecutionEvidence = this.active || freshGoal ||
      view.nav?.state === "following_path" || correctedTerminal;
    const canResolve = (!this.resolved || correctedTerminal) && hasExecutionEvidence;
    if (canResolve && (terminal || cancelled)) {
      this.sharedCancellation = !terminal && this.postAcceptanceIdle &&
        view.interaction?.active_goal === null;
      let feedback: NavFlash = "cancelled";
      if (terminal) feedback = view.nav?.outcome === "succeeded" ? "succeeded" : "failed";
      this.finish(feedback);
    }
    if (!this.resolved && !this.awaitingFreshFacts && view.nav?.state === "following_path") this.phase = "accepted";
    if (!this.resolved && view.nav?.state !== "resolved" && frame && frame !== this.suppressed && frame.ts >= this.newestTs) {
      this.newestTs = frame.ts;
      if (frame.pose) {
        if (!sameYawPose(frame.pose, this.routeGoal)) this.route = null;
        this.routeGoal = frame.pose;
        const p = odomToClientTrackingYawPose(frame.pose, origin);
        this.pose = { position: [p[0], p[1], p[2]], orientation: [0, 0, Math.sin(p[3] / 2), Math.cos(p[3] / 2)] };
        this.phase = "accepted";
      }
      if (frame.path_poses.length >= 2) this.route = frame.path_poses;
    }
    if (!this.active && !this.flash) this.pose = floor;
    this.lastFrame = frame;
    this.lastNav = view.nav;
  }

  private isFreshGoal(frame: ARModuleSessionState["nav_goal"], view: ARModuleSessionState): frame is NonNullable<ARModuleSessionState["nav_goal"]> {
    return frame !== null && frame !== this.lastFrame && frame !== this.suppressed &&
      frame.ts >= this.newestTs && frame.ts > this.retiredTs && !!frame.pose &&
      (view.nav?.state !== "resolved" || this.awaitingFreshFacts);
  }

  send(now: number, pose: NavigationPose): boolean {
    if (!this.origin || now - this.lastSentAt < GOAL_SEND_INTERVAL_S || this.lastSent && distance(this.lastSent, pose.position) < GOAL_SEND_MIN_DISTANCE_M) return false;
    try { this.commands.sendGoal(clientTrackingToOdomPose(pose, this.origin)); } catch { return false; }
    this.submitted(now, pose, false);
    return true;
  }

  /** Register local intent before its authoritative reply, without sending another command. */
  submitted(now: number, pose: NavigationPose, confirmed = true): void {
    if (confirmed) this.confirmationId++;
    this.submissionBaseline = this.view?.nav ?? null;
    this.postAcceptanceIdle = this.sharedCancellation = false;
    this.phase = "submitted";
    this.suppressed = this.view?.nav_goal ?? null;
    this.flash = null;
    this.elapsed = 0;
    this.pose = clone(pose);
    this.route = null;
    this.lastSent = [...pose.position];
    this.lastSentAt = now;
  }

  cancel(): boolean {
    if (!this.active || this.view?.capabilities?.estop.available !== true) return false;
    try { this.commands.cancel(); } catch { return false; }
    this.sharedCancellation = false;
    this.finish("cancelled"); return true;
  }

  tick(deltaS: number): void {
    if (!this.flash) return;
    this.elapsed = Math.min(FLASH_DURATION_S, this.elapsed + Math.max(0, deltaS));
    if (this.elapsed >= FLASH_DURATION_S) { this.flash = null;
    this.pose = this.floor; }
  }

  snapshot() {
    return { pose: this.pose && clone(this.pose), active: this.active, followingPath: this.active && !this.awaitingFreshFacts && this.view?.nav?.state === "following_path",
      confirmationId: this.confirmationId,
      cancelVisible: this.active && this.view?.capabilities?.estop.available === true,
      flash: this.flash, feedbackId: this.feedbackId, feedbackProgress: Math.min(1, this.elapsed / NAV_FEEDBACK_ANIMATION_S),
      attachedToRobot: !this.active && !this.flash, path: this.route };
  }

  reset(): void {
    this.origin = null;
    this.pose = null;
    this.phase = "idle";
    this.route = null;
    this.routeGoal = null;
    this.flash = null;
    this.elapsed = 0;
    this.lastSent = null;
    this.lastSentAt = -Infinity;
    this.newestTs = this.retiredTs = -Infinity;
    this.lastFrame = this.suppressed = null;
    this.lastNav = this.submissionBaseline = null;
    this.postAcceptanceIdle = this.sharedCancellation = false;
  }

  private finish(flash: NavFlash): void {
    this.flash = flash;
    this.elapsed = 0;
    this.feedbackId++;
    this.phase = "resolved";
    this.route = null;
    this.retiredTs = Math.max(this.retiredTs, this.newestTs, this.view?.nav_goal?.ts ?? -Infinity);
    this.suppressed = this.view?.nav_goal ?? null;
    this.lastSent = null;
    this.lastSentAt = -Infinity;
  }
}
function sameYawPose(a: Readonly<YawPose> | null, b: Readonly<YawPose> | null): boolean {
  return a === b || !!a && !!b && a.every((value, axis) => value === b[axis]);
}
function clone(pose: NavigationPose): NavigationPose { return { position: [...pose.position], orientation: [...pose.orientation] }; }
function distance(a: Vec3, b: Vec3): number { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }

export type NavigationInputId = string;
export type Placement = { position: Vec3; blocked: boolean } | null;
export type PlacementStage = "none" | "probe" | "preview";
export const DRAG_THRESHOLD_M = 0.11;
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
  rebase(convert: (pose: NavigationPose) => NavigationPose, now: number): void {
    if (this.pose) { this.pose = convert(this.pose); this.heading.reset(this.pose.position, this.pose.orientation, now); }
    this.probes.forEach((position, id) => this.probes.set(id, convert({ position, orientation: [0, 0, 0, 1] }).position));
  }
  private clearDraft(): void { this.owner = null; this.pose = null; this.held = this.firstGesture = false; }
}

export const PREVIEW_INTERVAL_S = 0.35;
export const PREVIEW_DISTANCE_M = 0.2;
export const PREVIEW_HEADING_RAD = Math.PI / 12;
export const PREVIEW_DEADLINE_S = 5;
type Aim = { position: Vec3; orientation: Quat };
let nextCoordinator = 0;

/** Request/reply lifecycle only; no marker, host coordinates, or motion commands. */
export class NavigationPreviewCoordinator {
  private readonly prefix = `preview-${++nextCoordinator}`;
  private sequence = 0;
  private desired: Aim | null = null;
  private pending: { id: string; aim: Aim; deadline: number } | null = null;
  private lastAim: Aim | null = null;
  private lastSend = -PREVIEW_INTERVAL_S;
  private lastResponse: ReadonlyFacts<NavGoal> | null = null;
  private origin: ReadonlyFacts<ClientTrackingOrigin> | null = null;
  private costmap: number | null = null;
  private queued = false;
  private requestedTargetRevision: number | null = null;

  constructor(private readonly session: Pick<ARModuleSession, "view" | "sendText"> & Partial<Pick<ARModuleSession, "assetTransferDeadline">> & { collaboration: InteractionAuthorityPort }) {
    if (!session.collaboration) throw new Error("Navigation requires interaction authority");
  }

  private displayed: NavGoal["path_poses"] | null = null;
  private displayOwner = "";
  displayPath(): NavGoal["path_poses"] | null {
    const shared = this.session.collaboration.snapshot();
    const owner = `${this.session.collaboration.raw()?.epoch ?? ""}:${shared.authority?.lease_id ?? ""}`;
    if (!shared.authority || owner !== this.displayOwner) this.displayed = null;
    this.displayOwner = owner;
    if (shared.preview) this.displayed = shared.preview.path_poses ?? null;
    return this.displayed;
  }

  apply(origin: ReadonlyFacts<ClientTrackingOrigin> | null): void {
    const view = this.session.view();
    if (view.connection !== "ready") { this.reset(); return; }
    if (view.capabilities?.navigation.nav_goal.preview !== true) { this.clear(); return; }
    const costmap = view.state?.nav_preview_costmap_ts ?? null;
    if (origin !== this.origin) this.queued = true;
    // Costmap changes queue a refresh without retiring a correlated request.
    if (costmap !== this.costmap) this.queued = true;
    this.origin = origin;
    this.costmap = costmap;
    const response = view.nav_preview;
    if (!response || response === this.lastResponse) return;
    this.lastResponse = response;
    if (!this.pending) return;
    if (response.preview_id !== this.pending.id) return;
    this.pending = null;
  }

  aim(position: Vec3, orientation: Quat): void {
    const reference = this.pending?.aim ?? this.lastAim ?? this.desired;
    if (this.pending && reference && changed(reference, { position, orientation })) this.queued = true;
    this.desired = { position: [...position], orientation: [...orientation] };
  }

  clear(): void {
    this.displayed = null; this.displayOwner = "";
    this.desired = null;
    this.lastAim = null;
    this.requestedTargetRevision = null;
    this.queued = false;
    // Keep the outstanding request until its reply/deadline; clearing aim must not
    // permit a second request or attribute the old reply to a new interaction.
  }

  reset(): void {
    this.clear();
    this.pending = null;
    this.lastResponse = null;
    this.origin = null;
    this.costmap = null;
    this.lastSend = -PREVIEW_INTERVAL_S;
  }

  tick(now: number): void {
    const shared = this.session.collaboration.snapshot();
    const canonical = shared.rawTarget && this.origin ? odomToClientTrackingPose(shared.rawTarget, this.origin) : null;
    const mayRefresh = now - this.lastSend >= PREVIEW_INTERVAL_S;
    const pendingAimObsolete = canonical && this.pending && changed(this.pending.aim, canonical);
    if (shared.ownsAuthority && pendingAimObsolete && mayRefresh) {
      this.pending = null;
      this.queued = true;
    }
    const previewMissingForTarget = shared.preview === null && this.lastAim &&
      (shared.rawTarget?.revision !== this.requestedTargetRevision || !this.pending);
    if (shared.ownsAuthority && previewMissingForTarget) this.queued = true;
    const pendingDeadline = this.pending && Math.max(
      this.pending.deadline, this.session.assetTransferDeadline?.(this.pending.id) ?? 0,
    );
    if (pendingDeadline !== null && now >= pendingDeadline) {
      this.pending = null;
      this.lastAim = null;
      this.queued = true;
    }
    const desired = this.desired;
    if (!desired || this.pending || !this.origin ||
        this.session.view().connection !== "ready" ||
        this.session.view().capabilities?.navigation.nav_goal.preview !== true ||
        now - this.lastSend < PREVIEW_INTERVAL_S ||
        (this.lastAim && !changed(this.lastAim, desired) && !this.queued)) return;
    if (!shared.ownsAuthority || !shared.rawTarget || !canonical) return;
    const requestAim = canonical;
    const odom = shared.rawTarget;
    const id = `${this.prefix}-${++this.sequence}`;
    try { requestNavPreview(this.session, { ...odom, preview_id: id }); }
    catch { return; }
    this.pending = { id, aim: requestAim, deadline: now + PREVIEW_DEADLINE_S };
    this.lastAim = requestAim;
    this.requestedTargetRevision = shared.rawTarget.revision;
    this.queued = false;
    this.lastSend = now;
  }
}

function changed(a: { position: Vec3; orientation: Quat }, b: { position: Vec3; orientation: Quat }): boolean {
  const distance = Math.hypot(...a.position.map((value, index) => value - b.position[index]));
  const turn = 2 * Math.acos(Math.min(1, Math.abs(a.orientation.reduce((sum, value, index) => sum + value * b.orientation[index], 0))));
  return distance >= PREVIEW_DISTANCE_M || turn >= PREVIEW_HEADING_RAD;
}

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
  private origin: ReadonlyFacts<ClientTrackingOrigin> | null = null;
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
  applyView(view: ARModuleSessionState, origin: ReadonlyFacts<ClientTrackingOrigin> | null, floor: NavigationPose | null, _now: number): void {
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
  activePath(): NavGoal["path_poses"] | null { return this.goals.snapshot().path; }
  previewPath(): NavGoal["path_poses"] | null {
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

/** Shared visibility/pose decisions. Hosts retain coordinate conversion and renderer interaction. */
export function deriveNavigationPresentation(
  state: ReadonlyFacts<NavigationTargetSnapshot>,
  options: { readonly showFlashDuringDrag?: boolean } = {},
) {
  const mainPose: ReadonlyFacts<NavigationPose> = state.dragging ? state : state.activeGoal.pose ?? state;
  return {
    mainPose,
    mainVisible: state.visible && (!state.draft || state.activeGoal.active || state.flash !== null),
    draftPose: state.draft,
    draftVisible: state.visible && state.draft !== null,
    draftHeld: state.draft?.held ?? false,
    flash: state.dragging && !options.showFlashDuringDrag ? null : state.flash,
    blocked: state.blocked === true,
    selected: state.selected,
    dragging: state.dragging,
    following: state.followingPath,
    cancelVisible: state.cancelVisible,
    feedbackProgress: state.feedbackProgress,
    confirmationId: state.activeGoal.confirmationId,
    probes: state.probes,
  } as const;
}
