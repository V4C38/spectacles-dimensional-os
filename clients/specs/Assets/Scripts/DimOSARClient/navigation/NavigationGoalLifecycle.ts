import type { ClientTrackingOrigin } from "../localization/clientTrackingOrigin";
import { clientTrackingToOdomPose, odomToClientTrackingYawPose } from "../localization/clientTrackingTransforms";
import type { ARModuleSessionState } from "../websocket/arModuleSession";
import type { Quat, Vec3, YawPose } from "../websocket/protocolTypes";

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
  private origin: ClientTrackingOrigin | null = null;
  private floor: NavigationPose | null = null;
  private pose: NavigationPose | null = null;
  private active = false;
  private resolved = false;
  private route: YawPose[] | null = null;
  private routeGoalKey = "";
  private lastFrame: ARModuleSessionState["nav_goal"] = null;
  private newestTs = -Infinity;
  private retiredTs = -Infinity;
  private suppressed: ARModuleSessionState["nav_goal"] = null;
  private lastNav: ARModuleSessionState["nav"] = null;
  private submissionBaseline: ARModuleSessionState["nav"] = null;
  private awaitingFreshFacts = false;
  private lastSent: Vec3 | null = null;
  private lastSentAt = -Infinity;
  private flash: NavFlash | null = null;
  private elapsed = 0;
  private feedbackId = 0;
  private confirmationId = 0;
  constructor(private readonly commands: NavigationCommands, private readonly forceNoopDistanceM = 0) {}

  apply(view: ARModuleSessionState, origin: ClientTrackingOrigin | null, floor: NavigationPose | null): void {
    this.view = view; this.floor = floor;
    if (!origin || !view.hasTrackingOrigin || view.connection !== "ready" || view.capabilities?.navigation.nav_goal.available !== true) {
      this.reset(); return;
    }
    if (this.origin !== origin) this.route = null;
    this.origin = origin;
    const frame = view.nav_goal;
    const freshGoal = frame !== null && frame !== this.lastFrame && frame !== this.suppressed && frame.ts >= this.newestTs && frame.ts > this.retiredTs && !!frame.pose && (view.nav?.state !== "resolved" || this.awaitingFreshFacts);
    if (freshGoal) {
      this.newestTs = frame.ts; this.resolved = false; this.active = true;
      this.flash = null; this.elapsed = 0; this.awaitingFreshFacts = false;
    }
    const navChanged = view.nav !== this.lastNav;
    // Rendering/ticking a cached resolved fact after send is not a new outcome.
    const freshState = navChanged && view.nav !== this.submissionBaseline;
    const awaitingAtArrival = this.awaitingFreshFacts;
    if (this.awaitingFreshFacts && freshState && view.nav?.state !== "resolved") this.awaitingFreshFacts = false;
    const terminal = freshState && view.nav?.state === "resolved" && (!this.awaitingFreshFacts || this.submissionBaseline?.state !== "resolved" || view.nav.outcome !== this.submissionBaseline.outcome);
    const cancelled = freshState && !awaitingAtArrival && this.lastNav?.state === "following_path" && view.nav?.state === "idle";
    if (!this.resolved && (this.active || freshGoal || view.nav?.state === "following_path") && (terminal || cancelled)) {
      this.finish(terminal ? view.nav?.outcome === "succeeded" ? "succeeded" : "failed" : "cancelled");
    }
    if (!this.resolved && !this.awaitingFreshFacts && view.nav?.state === "following_path") this.active = true;
    if (!this.resolved && view.nav?.state !== "resolved" && frame && frame !== this.suppressed && frame.ts >= this.newestTs) {
      this.newestTs = frame.ts;
      if (frame.pose) {
        const key = JSON.stringify(frame.pose);
        if (key !== this.routeGoalKey) this.route = null;
        this.routeGoalKey = key;
        const p = odomToClientTrackingYawPose(frame.pose, origin);
        this.pose = { position: [p[0], p[1], p[2]], orientation: [0, 0, Math.sin(p[3] / 2), Math.cos(p[3] / 2)] };
        this.active = true;
      }
      if (frame.path_poses.length >= 2) this.route = frame.path_poses;
    }
    if (!this.active && !this.flash) this.pose = floor;
    this.lastFrame = frame; this.lastNav = view.nav;
  }

  send(now: number, pose: NavigationPose, force = true): boolean {
    if (!this.origin || force && this.lastSent && distance(this.lastSent, pose.position) < this.forceNoopDistanceM) return false;
    if (!force && (now - this.lastSentAt < GOAL_SEND_INTERVAL_S || this.lastSent && distance(this.lastSent, pose.position) < GOAL_SEND_MIN_DISTANCE_M)) return false;
    try { this.commands.sendGoal(clientTrackingToOdomPose(pose, this.origin)); } catch { return false; }
    if (force) this.confirmationId++;
    this.submissionBaseline = this.view?.nav ?? null;
    this.awaitingFreshFacts = true;
    this.suppressed = this.view?.nav_goal ?? null;
    this.active = true; this.resolved = false; this.flash = null; this.elapsed = 0;
    this.pose = clone(pose); this.route = null;
    this.lastSent = [...pose.position]; this.lastSentAt = now;
    return true;
  }

  cancel(): boolean {
    if (!this.active || this.view?.capabilities?.estop.available !== true) return false;
    try { this.commands.cancel(); } catch { return false; }
    this.finish("cancelled"); return true;
  }

  tick(deltaS: number): void {
    if (!this.flash) return;
    this.elapsed = Math.min(FLASH_DURATION_S, this.elapsed + Math.max(0, deltaS));
    if (this.elapsed >= FLASH_DURATION_S) { this.flash = null; this.pose = this.floor; }
  }

  snapshot() {
    return { pose: this.pose && clone(this.pose), active: this.active, followingPath: this.active && !this.awaitingFreshFacts && this.view?.nav?.state === "following_path",
      confirmationId: this.confirmationId,
      cancelVisible: this.active && this.view?.capabilities?.estop.available === true,
      flash: this.flash, feedbackId: this.feedbackId, feedbackProgress: Math.min(1, this.elapsed / NAV_FEEDBACK_ANIMATION_S),
      attachedToRobot: !this.active && !this.flash, path: this.route };
  }

  reset(): void {
    this.origin = null; this.pose = null; this.active = false; this.resolved = false;
    this.route = null; this.routeGoalKey = ""; this.flash = null; this.elapsed = 0; this.lastSent = null; this.lastSentAt = -Infinity;
    this.newestTs = this.retiredTs = -Infinity; this.lastFrame = this.suppressed = null;
    this.lastNav = this.submissionBaseline = null; this.awaitingFreshFacts = false;
  }

  private finish(flash: NavFlash): void {
    this.flash = flash; this.elapsed = 0; this.feedbackId++;
    this.active = false; this.resolved = true; this.route = null;
    this.retiredTs = Math.max(this.retiredTs, this.view?.nav_goal?.ts ?? -Infinity);
    this.suppressed = this.view?.nav_goal ?? null;
    this.lastSent = null; this.lastSentAt = -Infinity;
  }
}
function clone(pose: NavigationPose): NavigationPose { return { position: [...pose.position], orientation: [...pose.orientation] }; }
function distance(a: Vec3, b: Vec3): number { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
