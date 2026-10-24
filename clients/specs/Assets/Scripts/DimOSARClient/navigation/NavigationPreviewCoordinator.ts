import { requestNavPreview } from "./navGoalRequest";
import { clientTrackingToOdomPose } from "../localization/clientTrackingTransforms";
import type { ClientTrackingOrigin } from "../localization/clientTrackingOrigin";
import type { ARModuleSession } from "../websocket/arModuleSession";
import type { NavGoal, Quat, Vec3, YawPose } from "../websocket/protocolTypes";

export const PREVIEW_INTERVAL_S = 0.35;
export const PREVIEW_DISTANCE_M = 0.2;
export const PREVIEW_HEADING_RAD = Math.PI / 12;
export const PREVIEW_DEADLINE_S = 5;
type Aim = { position: Vec3; orientation: Quat; generation: number };
let nextCoordinator = 0;

/** Request/reply lifecycle only; no marker, host coordinates, or motion commands. */
export class NavigationPreviewCoordinator {
  private readonly prefix = `preview-${++nextCoordinator}`;
  private sequence = 0;
  private generation = 0;
  private desired: Aim | null = null;
  private pending: { id: string; aim: Aim; deadline: number } | null = null;
  private lastAim: Aim | null = null;
  private lastSend = -PREVIEW_INTERVAL_S;
  private lastResponse: NavGoal | null = null;
  private origin: ClientTrackingOrigin | null = null;
  private costmap: number | null = null;
  private queued = false;
  private legacy = false;
  private path: YawPose[] | null = null;

  constructor(private readonly session: Pick<ARModuleSession, "view" | "sendText">) {}

  previewPath(): YawPose[] | null { return this.path; }

  apply(origin: ClientTrackingOrigin | null): void {
    const view = this.session.view();
    if (view.connection !== "ready") { this.reset(); return; }
    if (view.capabilities?.navigation.nav_goal.preview !== true) { this.clear(); return; }
    const costmap = view.state?.nav_preview_costmap_ts ?? null;
    if (origin !== this.origin || costmap !== this.costmap) {
      this.generation++;
      if (origin !== this.origin) this.path = null;
      this.queued = true;
      if (this.desired) this.desired = { ...this.desired, generation: this.generation };
    }
    this.origin = origin;
    this.costmap = costmap;
    const response = view.nav_preview;
    if (!response || response === this.lastResponse) return;
    this.lastResponse = response;
    if (!this.pending) return;
    if (!response.preview_id) {
      this.legacy = true;
      this.pending = null;
      this.path = null;
      return;
    }
    if (response.preview_id !== this.pending.id) return;
    const pending = this.pending;
    this.pending = null;
    if (origin && this.desired?.generation === pending.aim.generation) this.path = response.path_poses;
  }

  aim(position: Vec3, orientation: Quat): void {
    const reference = this.pending?.aim ?? this.lastAim ?? this.desired;
    if (!this.desired || !reference || changed(reference, { position, orientation })) {
      this.generation++;
      if (this.pending) this.queued = true;
    }
    this.desired = { position: [...position], orientation: [...orientation], generation: this.generation };
  }

  clear(): void {
    this.generation++;
    this.desired = null;
    this.path = null;
    this.lastAim = null;
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
    this.legacy = false;
    this.lastSend = -PREVIEW_INTERVAL_S;
  }

  tick(now: number): void {
    if (this.pending && now >= this.pending.deadline) {
      this.pending = null;
      this.path = null;
      this.lastAim = null;
      this.queued = true;
    }
    const desired = this.desired;
    if (!desired || this.pending || !this.origin || this.legacy ||
        this.session.view().connection !== "ready" ||
        this.session.view().capabilities?.navigation.nav_goal.preview !== true ||
        now - this.lastSend < PREVIEW_INTERVAL_S ||
        (this.lastAim && !changed(this.lastAim, desired) && !this.queued)) return;
    const id = `${this.prefix}-${++this.sequence}`;
    const odom = clientTrackingToOdomPose(desired, this.origin);
    try { requestNavPreview(this.session, { ...odom, preview_id: id }); }
    catch { this.path = null; return; }
    this.pending = { id, aim: desired, deadline: now + PREVIEW_DEADLINE_S };
    this.lastAim = desired;
    this.queued = false;
    this.lastSend = now;
  }
}

function changed(a: { position: Vec3; orientation: Quat }, b: { position: Vec3; orientation: Quat }): boolean {
  const distance = Math.hypot(...a.position.map((value, index) => value - b.position[index]));
  const turn = 2 * Math.acos(Math.min(1, Math.abs(a.orientation.reduce((sum, value, index) => sum + value * b.orientation[index], 0))));
  return distance >= PREVIEW_DISTANCE_M || turn >= PREVIEW_HEADING_RAD;
}
