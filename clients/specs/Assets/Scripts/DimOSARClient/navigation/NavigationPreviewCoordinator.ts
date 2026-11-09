import type { InteractionAuthorityPort } from "../replication/CollaborationTypes";
import { requestNavPreview } from "./navGoalRequest";
import { odomToClientTrackingPose } from "../localization/clientTrackingTransforms";
import type { ClientTrackingOrigin } from "../localization/clientTrackingOrigin";
import type { ARModuleSession } from "../websocket/arModuleSession";
import type { NavGoal, Quat, Vec3 } from "../websocket/protocolTypes";

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
  private lastResponse: NavGoal | null = null;
  private origin: ClientTrackingOrigin | null = null;
  private costmap: number | null = null;
  private queued = false;
  private requestedTargetRevision: number | null = null;

  constructor(private readonly session: Pick<ARModuleSession, "view" | "sendText"> & Partial<Pick<ARModuleSession, "assetTransferDeadline">> & { collaboration: InteractionAuthorityPort }) {
    if (!session.collaboration) throw new Error("Navigation requires interaction authority");
  }

  apply(origin: ClientTrackingOrigin | null): void {
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
    if (shared.ownsAuthority && canonical && this.pending && changed(this.pending.aim, canonical) && now - this.lastSend >= PREVIEW_INTERVAL_S) {
      this.pending = null;
      this.queued = true;
    }
    if (shared.ownsAuthority && shared.preview === null && this.lastAim &&
        (shared.rawTarget?.revision !== this.requestedTargetRevision || !this.pending)) this.queued = true;
    if (this.pending && now >= Math.max(this.pending.deadline, this.session.assetTransferDeadline?.(this.pending.id) ?? 0)) {
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
