import type { ClientTrackingOrigin } from "../localization/clientTrackingOrigin";
import { clientTrackingToOdomPose, odomToClientTrackingYawPose } from "../localization/clientTrackingTransforms";
import type { ARModuleSessionState } from "../websocket/arModuleSession";
import type { NavState, Quat, Vec3, YawPose } from "../websocket/protocolTypes";
import { NavigationPreviewCoordinator } from "./NavigationPreviewCoordinator";

export type NavFlash = "cancelled" | "failed";
export type Placement = { position: Vec3; blocked: boolean } | null;
export interface NavigationTargetSnapshot {
  visible: boolean;
  position: Vec3;
  orientation: Quat;
  selected: boolean;
  dragging?: boolean;
  placementHeld?: boolean;
  followingPath?: boolean;
  attachedToRobot?: boolean;
  aiming: boolean;
  goalActive: boolean;
  cancelVisible: boolean;
  flash: NavFlash | null;
}

/** Interaction intent, independent of scene geometry and authoritative wire storage. */
class NavigationTargetState {
  private state: NavigationTargetSnapshot = { visible: false, position: [0, 0, 0], orientation: [0, 0, 0, 1], selected: false, aiming: false, goalActive: false, cancelVisible: false, flash: null };
  snapshot(): NavigationTargetSnapshot { return { ...this.state, position: [...this.state.position], orientation: [...this.state.orientation] }; }
  pose(): { position: Vec3; orientation: Quat } { const { position, orientation } = this.snapshot(); return { position, orientation }; }
  setPose(position: Vec3, orientation: Quat): void { this.state.position = [...position]; this.state.orientation = [...orientation]; }
  show(): void { this.state.visible = true; }
  hide(): void { this.state.visible = false; this.state.cancelVisible = false; }
  setSelected(value: boolean): void { this.state.selected = value; }
  setAiming(value: boolean): void { this.state.aiming = value; }
  setGoalActive(value: boolean): void { this.state.goalActive = value; }
  setFlash(value: NavFlash | null): void { this.state.flash = value; }
  setCancelVisible(value: boolean): void { this.state.cancelVisible = value; }
}

export const GOAL_SEND_INTERVAL_S = 0.35;
export const GOAL_SEND_MIN_DISTANCE_M = 0.2;
export const DRAG_THRESHOLD_M = 0.11;
export const DRAG_HEADING_MIN_DELTA_M = 0.03;
export const DRAG_HEADING_SMOOTHING_RATE = 8;
export const FLASH_DURATION_S = 1.5;

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

export class NavigationInteraction {
  private readonly target = new NavigationTargetState();
  private view: ARModuleSessionState | null = null;
  private origin: ClientTrackingOrigin | null = null;
  private lastSent: Vec3 | null = null;
  private lastSendTime = -GOAL_SEND_INTERVAL_S;
  private lastReceivedPose: YawPose | null = null;
  private lastAppliedNav: NavState | null = null;
  private headingGate: { x: number; y: number } | null = null;
  private heading: Quat = [0, 0, 0, 1];
  private headingTarget: Quat = [0, 0, 0, 1];
  private lastHoldTime: number | null = null;
  private streaming = true;
  private dragging = false;
  private activated = false;
  private armed = false;
  private navFlash: NavFlash | null = null;
  private flashUntil = 0;
  private touchStart: Vec3 | null = null;
  private lastFloor: { position: Vec3; orientation: Quat } | null = null;

  private selected = false;
  private aiming = false;
  private floorAnchor: Vec3 | null = null;
  private activeRoute: YawPose[] | null = null;
  private routeGoalKey = "";
  private suppressedRoute: ARModuleSessionState["nav_goal"] = null;
  private authoritative: { position: Vec3; orientation: Quat } | null = null;
  constructor(
    private readonly commands: { sendGoal: (pose: { position: Vec3; orientation: Quat }) => void; cancel: () => void },
    private readonly previews: NavigationPreviewCoordinator,
  ) {}

  snapshot(): NavigationTargetSnapshot {
    return { ...this.target.snapshot(), dragging: this.dragging,
      placementHeld: this.floorAnchor !== null,
      followingPath: this.view?.nav?.state === "following_path",
      attachedToRobot: !this.aiming && !this.floorAnchor && !this.dragging &&
        !this.target.snapshot().goalActive && this.navFlash === null };
  }

  applyView(
    view: ARModuleSessionState,
    origin: ClientTrackingOrigin | null,
    robotFloor: { position: Vec3; orientation: Quat } | null,
    now: number,
  ): void {
    this.view = view;
    this.lastFloor = robotFloor;
    if (view.connection !== "ready") {
      this.setSelected(false);
    }
    this.previews.apply(origin);
    const available =
      view.connection === "ready" && view.hasTrackingOrigin &&
      view.capabilities?.navigation.available === true && view.capabilities.navigation.nav_goal.available === true;
    if (!available || !origin) {
      this.setSelected(false);
      this.origin = null;
      this.lastReceivedPose = null;
      this.lastAppliedNav = null;
      this.navFlash = null;
      this.stop();
      return;
    }
    if (this.origin && this.origin !== origin) this.cancelDrag();
    if (this.origin !== origin) this.activeRoute = null;
    this.origin = origin;
    const goalKey = view.nav_goal?.pose ? JSON.stringify(view.nav_goal.pose) : this.routeGoalKey;
    const terminal = view.nav?.state === "resolved";
    if (goalKey !== this.routeGoalKey || terminal) this.activeRoute = null;
    this.routeGoalKey = goalKey;
    if (!terminal && view.nav_goal !== this.suppressedRoute && view.nav_goal?.path_poses && view.nav_goal.path_poses.length >= 2) this.activeRoute = view.nav_goal.path_poses;
    else if (view.nav?.state !== "following_path") this.activeRoute = null;
    if (!this.armed) {
      this.arm(robotFloor ?? this.target.pose());
    }
    const liveGoal = this.goalActive(view);
    const prevNav = this.lastAppliedNav;
    this.lastAppliedNav = view.nav;
    if (view.nav?.state === "resolved" && view.nav.outcome === "succeeded" && !view.nav_goal?.pose) {
      this.clearGoalFacts();
      this.activated = false;
    }
    const received = view.nav_goal?.pose;
    if (received) {
      this.lastReceivedPose = received;
      this.authoritative = yawPoseToTracking(received, origin);
    } else if (view.nav?.state !== "following_path" && (!this.goalActive(view) || this.lastReceivedPose)) {
      this.lastReceivedPose = null;
      this.authoritative = robotFloor;
    }
    if (!this.authoritative) this.authoritative = robotFloor;
    const followFloor = !this.goalActive(view) && this.navFlash === null && !this.dragging;
    if (!this.aiming && !this.floorAnchor && followFloor && robotFloor) {
      this.applyPose(robotFloor.position, robotFloor.orientation);
    } else if (!this.aiming && !this.floorAnchor && !this.dragging && this.navFlash === null) {
      if (view.nav_goal?.pose || view.nav?.state !== "following_path") this.applyReceivedTarget(view.nav_goal?.pose ?? null, origin);
    }
    if (shouldBeginFailedFlash(prevNav, view.nav, liveGoal) && this.navFlash === null) {
      this.beginFlash("failed", now);
    }
    if (this.navFlash === null) {
      this.target.setGoalActive(this.goalActive(view));
    }
    this.syncCancelVisible(view);
  }

  tick(now: number): void {
    this.previews.tick(now);
    if (this.navFlash !== null && now >= this.flashUntil) {
      this.completeFlash();
    }
  }

  setSelected(selected: boolean): void {
    if (this.selected === selected) return;
    this.selected = selected;
    this.target.setSelected(selected);
    if (!selected) this.cancelDrag();
  }

  isAiming(): boolean { return this.aiming || this.floorAnchor !== null; }

  activePath(): YawPose[] | null { return this.activeRoute; }

  previewPath(): YawPose[] | null { return this.previews.previewPath(); }

  aim(now: number, placed: Placement): void {
    if (!this.selected || !this.armed || this.dragging || this.floorAnchor || this.navFlash || !this.origin) {
      if (!this.floorAnchor) this.clearAim();
      return;
    }
    if (!placed || placed.blocked) { this.clearAim(); return; }
    if (!this.aiming) {
      this.heading = this.authoritative?.orientation ?? this.heading;
      this.headingTarget = this.heading;
      this.headingGate = { x: placed.position[0], y: placed.position[1] };
      this.lastHoldTime = now;
    }
    this.updateHeading(placed.position, Math.max(0, now - (this.lastHoldTime ?? now)));
    this.lastHoldTime = now;
    this.aiming = true;
    this.target.setAiming(true);
    this.applyPose(placed.position, this.heading);
    this.previews.aim(placed.position, this.heading);
    this.previews.tick(now);
    this.syncCancelVisible();
  }

  clearAim(): void {
    if (!this.aiming && !this.floorAnchor) { this.previews.clear(); return; }
    this.aiming = false;
    this.previews.clear();
    this.target.setAiming(false);
    const restore = this.authoritative ?? this.lastFloor;
    if (restore && !this.floorAnchor) this.applyPose(restore.position, restore.orientation);
    this.syncCancelVisible();
  }

  isRouteVisible(): boolean {
    return this.armed && this.navFlash === null;
  }

  isDragging(): boolean {
    return this.dragging;
  }

  flash(): NavFlash | null {
    return this.navFlash;
  }

  hold(
    now: number,
    placed: Placement,
    streamWhileDragging = true,
  ): boolean {
    if (!this.armed || this.navFlash !== null || !this.origin) {
      return false;
    }
    if (!streamWhileDragging) {
      if (!this.selected) return false;
      if (!placed || placed.blocked) return false;
      if (!this.floorAnchor) {
        this.floorAnchor = this.aiming ? this.target.pose().position : [...placed.position];
        this.aiming = false;
        this.target.setAiming(false);
        this.streaming = false;
      }
      this.applyPose(this.floorAnchor, this.heading);
      this.previews.aim(this.floorAnchor, this.heading);
      this.previews.tick(now);
      this.syncCancelVisible();
      return true;
    }
    this.clearAim();
    if (!this.dragging) {
      this.streaming = streamWhileDragging;
      const start = this.target.pose().position;
      this.touchStart = start;
      this.headingGate = { x: start[0], y: start[1] };
      this.headingTarget = this.heading;
      }
    const deltaS = this.lastHoldTime === null ? 0 : Math.max(0, now - this.lastHoldTime);
    this.lastHoldTime = now;
    if (!placed || placed.blocked || !placed.position) {
      return false;
    }
    if (this.touchStart && distancePlanar(this.touchStart, placed.position) > DRAG_THRESHOLD_M) {
      this.dragging = true;
      if (this.streaming) this.activated = true;
    }
    if (this.dragging) {
      this.updateHeading(placed.position, deltaS);
      this.applyPose(placed.position, this.heading);
      this.streamGoal(now, placed.position, this.origin, false);
    }
    this.syncCancelVisible();
    return this.dragging;
  }

  release(
    now: number,
    placed: Placement,
  ): void {
    if (!this.armed || this.navFlash !== null || !this.origin) {
      this.dragging = false;
      this.touchStart = null;
      this.lastHoldTime = null;
      return;
    }
    if (this.floorAnchor) {
      const anchor = this.floorAnchor;
      // Confirm the pose shown at press; holding does not introduce a second heading stage.
      this.applyPose(anchor, this.heading);
      if (this.selected && this.streamGoal(now, anchor, this.origin, true)) this.activated = true;
      this.floorAnchor = null;
      this.authoritative = this.target.pose();
      this.aiming = true; // clear all advisory state without restoring the old target
      this.clearAim();
      this.cancelDrag();
      return;
    }
    if (placed && !placed.blocked && placed.position && this.dragging) {
      this.updateHeading(placed.position, this.lastHoldTime === null ? 0 : Math.max(0, now - this.lastHoldTime));
      this.applyPose(placed.position, this.heading);
      if (this.streamGoal(now, placed.position, this.origin, true)) this.activated = true;
    }
    this.dragging = false;
    this.touchStart = null;
    this.lastHoldTime = null;
    this.syncCancelVisible();
  }

  cancel(now: number): void {
    const view = this.view;
    if (!view) return;
    if (!this.goalActive(view) || view.capabilities?.estop?.available !== true) {
      return;
    }
    try {
      this.commands.cancel();
    } catch {
      return;
    }
    this.beginFlash("cancelled", now);
  }

  cancelDrag(): void {
    const interrupted = this.dragging || this.touchStart !== null || this.floorAnchor !== null;
    this.floorAnchor = null;
    this.clearAim();
    if (interrupted) {
      const restore = this.authoritative ?? this.lastFloor;
      if (restore) this.applyPose(restore.position, restore.orientation);
    }
    this.dragging = false;
    this.touchStart = null;
    this.headingGate = null;
    this.lastHoldTime = null;
  }

  reset(): void {
    this.previews.reset();
    this.view = null;
    this.setSelected(false);
    this.stop();
    this.authoritative = null;
    this.origin = null;
    this.lastFloor = null;
  }

  dispose(): void {
    this.reset();
    this.previews.reset();
  }

  private streamGoal(now: number, position: Vec3, origin: ClientTrackingOrigin, force: boolean): boolean {
    if (this.navFlash !== null) {
      return false;
    }
    if (!force && (!this.dragging || !this.streaming)) {
      return false;
    }
    if (!shouldSendStreamGoal(now, this.lastSendTime, position, this.lastSent, force)) {
      return false;
    }
    const tracking = { position, orientation: this.heading };
    const odom = clientTrackingToOdomPose(tracking, origin);
    try { this.commands.sendGoal(odom); } catch { return false; }
    this.activeRoute = null;
    this.suppressedRoute = this.view?.nav_goal ?? null;
    this.authoritative = { position: [...position], orientation: [...this.heading] };
    this.lastSent = position;
    this.lastSendTime = now;
    return true;
  }

  private applyReceivedTarget(pose: YawPose | null, origin: ClientTrackingOrigin): void {
    if (this.navFlash !== null) {
      return;
    }
    if (pose) {
      const world = yawPoseToTracking(pose, origin);
      this.applyPose(world.position, world.orientation);
      this.lastReceivedPose = pose;
      return;
    }
    if (!this.lastReceivedPose) {
      return;
    }
    this.lastReceivedPose = null;
    if (this.lastFloor) {
      this.applyPose(this.lastFloor.position, this.lastFloor.orientation);
    }
  }

  private applyPose(position: Vec3, orientation: Quat): void {
    this.heading = orientation;
    this.target.setPose(position, orientation);
  }

  private arm(start: { position: Vec3; orientation: Quat }): void {
    this.applyPose(start.position, start.orientation);
    this.target.show();
    this.armed = true;
    this.headingGate = { x: start.position[0], y: start.position[1] };
  }

  private stop(): void {
    this.activeRoute = null;
    this.routeGoalKey = "";
    this.suppressedRoute = null;
    this.cancelDrag();
    this.target.hide();
    this.target.setFlash(null);
    this.armed = false;
    this.dragging = false;
    this.activated = false;
    this.lastSent = null;
    this.lastGoalSendTimeReset();
    this.navFlash = null;
    this.lastAppliedNav = null;
    this.touchStart = null;
    this.lastHoldTime = null;
    this.target.setCancelVisible(false);
  }

  private lastGoalSendTimeReset(): void {
    this.lastSendTime = -GOAL_SEND_INTERVAL_S;
  }

  private beginFlash(flash: NavFlash, now: number): void {
    this.cancelDrag();
    this.activeRoute = null;
    this.suppressedRoute = this.view?.nav_goal ?? null;
    this.navFlash = flash;
    this.activated = false;
    this.dragging = false;
    this.clearGoalFacts();
    this.target.setFlash(flash);
    this.target.setCancelVisible(false);
    this.flashUntil = now + FLASH_DURATION_S;
  }

  private completeFlash(): void {
    this.navFlash = null;
    this.target.setFlash(null);
    this.clearGoalFacts();
    this.activated = false;
    if (this.lastFloor) {
      this.applyPose(this.lastFloor.position, this.lastFloor.orientation);
    }
    this.target.setGoalActive(false);
    this.syncCancelVisible();
  }

  private clearGoalFacts(): void {
    this.lastSent = null;
    this.lastReceivedPose = null;
    this.lastGoalSendTimeReset();
  }

  private syncCancelVisible(view: ARModuleSessionState | null = this.view): void {
    this.target.setCancelVisible(
      view !== null && this.isCancelVisible(view) && view.capabilities?.estop?.available === true,
    );
  }

  private goalActive(view: ARModuleSessionState): boolean {
    return isLiveNavGoal(this.liveNavGoalInput(view));
  }

  private isCancelVisible(view: ARModuleSessionState): boolean {
    return isNavGoalCancelVisible({
      flashing: this.navFlash !== null,
      dragging: this.dragging || this.aiming || this.floorAnchor !== null,
      ...this.liveNavGoalInput(view),
    });
  }

  private liveNavGoalInput(view: ARModuleSessionState): LiveNavGoalInput {
    return {
      activated: this.activated,
      hasSentGoal: this.lastSent !== null,
      hasReceivedPose: this.lastReceivedPose !== null || view.nav_goal?.pose != null,
      followingPath: view.nav?.state === "following_path",
    };
  }

  private updateHeading(position: Vec3, deltaS: number): void {
    if (!this.headingGate) {
      this.headingGate = { x: position[0], y: position[1] };
    } else {
      const dx = position[0] - this.headingGate.x;
      const dz = position[1] - this.headingGate.y;
      const travel = Math.hypot(dx, dz);
      if (travel >= DRAG_HEADING_MIN_DELTA_M) {
        this.headingGate = { x: position[0], y: position[1] };
        this.headingTarget = yawFromPlanarDirection(dx / travel, dz / travel);
      }
    }
    const yaw = 2 * Math.atan2(this.heading[2], this.heading[3]);
    const target = 2 * Math.atan2(this.headingTarget[2], this.headingTarget[3]);
    const delta = Math.atan2(Math.sin(target - yaw), Math.cos(target - yaw));
    const next = yaw + delta * (1 - Math.exp(-DRAG_HEADING_SMOOTHING_RATE * deltaS));
    this.heading = [0, 0, Math.sin(next / 2), Math.cos(next / 2)];
  }
}

function yawPoseToTracking(
  pose: YawPose,
  origin: ClientTrackingOrigin,
): { position: Vec3; orientation: Quat } {
  const tracking = odomToClientTrackingYawPose(pose, origin);
  const half = tracking[3] * 0.5;
  return {
    position: [tracking[0], tracking[1], tracking[2]],
    orientation: [0, 0, Math.sin(half), Math.cos(half)],
  };
}

function isResolvedFailed(nav: NavState | null | undefined): boolean {
  return nav?.state === "resolved" && nav.outcome === "failed";
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function distancePlanar(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
