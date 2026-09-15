import type { ClientTrackingOrigin } from "@dimos-ar-client/localization/clientTrackingOrigin";
import {
  clientTrackingToOdomPose,
  odomToClientTrackingYawPose,
} from "@dimos-ar-client/localization/clientTrackingTransforms";
import { requestNavGoal } from "@dimos-ar-client/navigation/navGoalRequest";
import type { ARModuleSession, ARModuleSessionState } from "@dimos-ar-client/websocket/arModuleSession";
import type { NavState, Quat, Vec3, YawPose } from "@dimos-ar-client/websocket/protocolTypes";
import { clientTrackingToWebxrYawPose, webxrToClientTrackingPose } from "../coordinates/WebXRCoordinates";
import { WebXRNavGoalView, type NavFlash } from "./WebXRNavGoalView";
import {
  RAY_LENGTH_M,
  solveMeshPlacement,
  type MeshHit,
  type RobotGroundDeadzone,
} from "./WebXRGroundPlacement";

export const GOAL_SEND_INTERVAL_S = 0.35;
export const GOAL_SEND_MIN_DISTANCE_M = 0.2;
export const DRAG_THRESHOLD_M = 0.11;
export const DRAG_HEADING_MIN_DELTA_M = 0.03;
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
    if (lastSent && distance(lastSent, position) < 0.02) {
      return false;
    }
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

export function yawFromPlanarDirection(x: number, z: number): Quat {
  const yaw = Math.atan2(-z, x);
  const half = yaw * 0.5;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

export function robotDeadzoneRadiusM(footprint: [number, number]): number {
  return Math.max(0.2, Math.max(...footprint) * 0.5 + 0.2);
}

export class WebXRNavigationController {
  readonly marker: WebXRNavGoalView;
  private origin: ClientTrackingOrigin | null = null;
  private lastSent: Vec3 | null = null;
  private lastSendTime = -GOAL_SEND_INTERVAL_S;
  private lastReceivedPose: YawPose | null = null;
  private lastAppliedNav: NavState | null = null;
  private headingGate: { x: number; z: number } | null = null;
  private heading: Quat = [0, 0, 0, 1];
  private dragging = false;
  private activated = false;
  private armed = false;
  private navFlash: NavFlash | null = null;
  private flashUntil = 0;
  private wasInsideDeadzone = false;
  private touchStart: Vec3 | null = null;
  private lastFloor: { position: Vec3; orientation: Quat } | null = null;

  constructor(private readonly session: ARModuleSession) {
    this.marker = new WebXRNavGoalView();
  }

  applyView(
    view: ARModuleSessionState,
    origin: ClientTrackingOrigin | null,
    robotFloor: { position: Vec3; orientation: Quat } | null,
    now: number,
  ): void {
    this.lastFloor = robotFloor;
    const available =
      view.hasTrackingOrigin && view.capabilities?.navigation?.nav_goal?.available === true;
    if (!available || !origin) {
      this.origin = null;
      this.lastReceivedPose = null;
      this.lastAppliedNav = null;
      this.navFlash = null;
      this.stop();
      return;
    }
    this.origin = origin;
    if (!this.armed) {
      this.arm(robotFloor ?? this.marker.pose());
    }
    const liveGoal = this.goalActive(view);
    const prevNav = this.lastAppliedNav;
    this.lastAppliedNav = view.nav;
    if (view.nav?.state === "resolved" && view.nav.outcome === "succeeded" && !view.nav_goal?.pose) {
      this.clearGoalFacts();
      this.activated = false;
    }
    const followFloor = !this.goalActive(view) && this.navFlash === null && !this.dragging;
    if (followFloor && robotFloor) {
      this.applyPose(robotFloor.position, robotFloor.orientation);
    } else if (!this.dragging && this.navFlash === null) {
      this.applyReceivedTarget(view.nav_goal?.pose ?? null, origin);
    }
    if (shouldBeginFailedFlash(prevNav, view.nav, liveGoal) && this.navFlash === null) {
      this.beginFlash("failed", now);
    }
    if (this.navFlash === null) {
      this.marker.setGoalActive(this.goalActive(view));
    }
    this.syncCancelVisible(view);
  }

  tick(now: number): void {
    if (this.navFlash !== null && now >= this.flashUntil) {
      this.completeFlash();
    }
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
    rayFrom: Vec3,
    rayDir: Vec3,
    hits: MeshHit[],
    deadzone: RobotGroundDeadzone | null,
    fallbackY: number,
  ): boolean {
    if (!this.armed || this.navFlash !== null || !this.origin) {
      return false;
    }
    if (!this.dragging) {
      const start = this.marker.pose().position;
      this.touchStart = start;
      this.headingGate = { x: start[0], z: start[2] };
      this.wasInsideDeadzone = false;
    }
    const placed = this.placeFromRay(rayFrom, rayDir, hits, deadzone, fallbackY);
    if (!placed || placed.blocked || !placed.position) {
      return false;
    }
    if (this.touchStart && distanceXZ(this.touchStart, placed.position) > DRAG_THRESHOLD_M) {
      this.dragging = true;
      this.activated = true;
    }
    if (this.dragging) {
      this.updateHeading(placed.position);
      this.applyPose(placed.position, this.heading);
      this.streamGoal(now, placed.position, this.origin, false);
    }
    this.syncCancelVisible();
    return this.dragging;
  }

  release(
    now: number,
    rayFrom: Vec3,
    rayDir: Vec3,
    hits: MeshHit[],
    deadzone: RobotGroundDeadzone | null,
    fallbackY: number,
  ): void {
    if (!this.armed || this.navFlash !== null || !this.origin) {
      this.dragging = false;
      this.touchStart = null;
      return;
    }
    const placed = this.placeFromRay(rayFrom, rayDir, hits, deadzone, fallbackY);
    if (placed && !placed.blocked && placed.position && this.dragging) {
      this.updateHeading(placed.position);
      this.applyPose(placed.position, this.heading);
      this.streamGoal(now, placed.position, this.origin, true);
    }
    this.dragging = false;
    this.touchStart = null;
    this.syncCancelVisible();
  }

  cancel(now: number): void {
    const view = this.session.view();
    if (!this.goalActive(view) || view.capabilities?.estop?.available !== true) {
      return;
    }
    try {
      this.session.requestEstop();
    } catch {
      return;
    }
    this.beginFlash("cancelled", now);
  }

  reset(): void {
    this.stop();
    this.origin = null;
    this.lastFloor = null;
  }

  dispose(): void {
    this.reset();
    this.marker.dispose();
  }

  private placeFromRay(
    rayFrom: Vec3,
    rayDir: Vec3,
    hits: MeshHit[],
    deadzone: RobotGroundDeadzone | null,
    fallbackY: number,
  ): { position: Vec3; blocked: boolean } | null {
    const rayTo: Vec3 = [
      rayFrom[0] + rayDir[0] * RAY_LENGTH_M,
      rayFrom[1] + rayDir[1] * RAY_LENGTH_M,
      rayFrom[2] + rayDir[2] * RAY_LENGTH_M,
    ];
    const result = solveMeshPlacement({
      rayFrom,
      rayTo,
      hits,
      deadzone,
      wasInsideDeadzone: this.wasInsideDeadzone,
      fallbackY,
    });
    this.wasInsideDeadzone = result.wasInsideDeadzone;
    if (result.status !== "ok" || !result.goalPosition) {
      return { position: result.probePosition, blocked: true };
    }
    return { position: result.goalPosition, blocked: false };
  }

  private streamGoal(now: number, position: Vec3, origin: ClientTrackingOrigin, force: boolean): boolean {
    if (this.navFlash !== null) {
      return false;
    }
    if (!this.dragging && !force) {
      return false;
    }
    if (!shouldSendStreamGoal(now, this.lastSendTime, position, this.lastSent, force)) {
      return false;
    }
    const tracking = webxrToClientTrackingPose({
      position,
      orientation: this.heading,
    });
    const odom = clientTrackingToOdomPose(tracking, origin);
    requestNavGoal(this.session, odom);
    this.lastSent = position;
    this.lastSendTime = now;
    return true;
  }

  private applyReceivedTarget(pose: YawPose | null, origin: ClientTrackingOrigin): void {
    if (this.navFlash !== null) {
      return;
    }
    if (pose) {
      const world = yawPoseToWebxr(pose, origin);
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
    this.marker.setPose(position, orientation);
  }

  private arm(start: { position: Vec3; orientation: Quat }): void {
    this.applyPose(start.position, start.orientation);
    this.marker.show();
    this.armed = true;
    this.headingGate = { x: start.position[0], z: start.position[2] };
  }

  private stop(): void {
    this.marker.hide();
    this.armed = false;
    this.dragging = false;
    this.activated = false;
    this.lastSent = null;
    this.lastGoalSendTimeReset();
    this.navFlash = null;
    this.lastAppliedNav = null;
    this.touchStart = null;
    this.marker.setCancelVisible(false);
  }

  private lastGoalSendTimeReset(): void {
    this.lastSendTime = -GOAL_SEND_INTERVAL_S;
  }

  private beginFlash(flash: NavFlash, now: number): void {
    this.navFlash = flash;
    this.activated = false;
    this.dragging = false;
    this.clearGoalFacts();
    this.marker.setFlash(flash);
    this.marker.setCancelVisible(false);
    this.flashUntil = now + FLASH_DURATION_S;
  }

  private completeFlash(): void {
    this.navFlash = null;
    this.clearGoalFacts();
    this.activated = false;
    if (this.lastFloor) {
      this.applyPose(this.lastFloor.position, this.lastFloor.orientation);
    }
    this.marker.setGoalActive(false);
    this.syncCancelVisible();
  }

  private clearGoalFacts(): void {
    this.lastSent = null;
    this.lastReceivedPose = null;
    this.lastGoalSendTimeReset();
  }

  private syncCancelVisible(view: ARModuleSessionState = this.session.view()): void {
    this.marker.setCancelVisible(
      this.isCancelVisible(view) && view.capabilities?.estop?.available === true,
    );
  }

  private goalActive(view: ARModuleSessionState): boolean {
    return isLiveNavGoal(this.liveNavGoalInput(view));
  }

  private isCancelVisible(view: ARModuleSessionState): boolean {
    return isNavGoalCancelVisible({
      flashing: this.navFlash !== null,
      dragging: this.dragging,
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

  private updateHeading(position: Vec3): void {
    if (!this.headingGate) {
      this.headingGate = { x: position[0], z: position[2] };
      return;
    }
    const dx = position[0] - this.headingGate.x;
    const dz = position[2] - this.headingGate.z;
    const travel = Math.hypot(dx, dz);
    if (travel < DRAG_HEADING_MIN_DELTA_M) {
      return;
    }
    this.headingGate = { x: position[0], z: position[2] };
    this.heading = yawFromPlanarDirection(dx / travel, dz / travel);
  }
}

function yawPoseToWebxr(
  pose: YawPose,
  origin: ClientTrackingOrigin,
): { position: Vec3; orientation: Quat } {
  const tracking = odomToClientTrackingYawPose(pose, origin);
  const webxr = clientTrackingToWebxrYawPose(tracking);
  const half = webxr[3] * 0.5;
  return {
    position: [webxr[0], webxr[1], webxr[2]],
    orientation: [0, Math.sin(half), 0, Math.cos(half)],
  };
}

function isResolvedFailed(nav: NavState | null | undefined): boolean {
  return nav?.state === "resolved" && nav.outcome === "failed";
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function distanceXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}
