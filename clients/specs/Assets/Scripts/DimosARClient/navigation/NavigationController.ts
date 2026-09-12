import type { ClientTrackingOrigin } from "../core/localization/clientTrackingOrigin";
import { clientTrackingToOdomPose, odomToClientTrackingYawPose } from "../core/localization/clientTrackingTransforms";
import { requestNavGoal } from "../core/navigation/navGoalRequest";
import type { ARModuleSession, ARModuleSessionState } from "../core/websocket/arModuleSession";
import type { NavState, YawPose } from "../core/websocket/protocolTypes";
import { specsWorldPoseToTracking } from "../localization/SpecsCameraSource";
import type { RobotPresenter } from "../robot/RobotPresenter";
import { clientTrackingToSpecsYawPose } from "../SpecsCoordinates";
import { GroundPlacement } from "./GroundPlacement";
import { NavGoalMarker } from "./NavGoalMarker";

export const GOAL_SEND_INTERVAL_S = 0.35;
export const GOAL_SEND_MIN_DISTANCE_CM = 20.0;
export const GOAL_FORCE_NOOP_DISTANCE_CM = 2.0;

export type NavFlash = "cancelled" | "failed";

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
  position: vec3,
  lastSentGoal: { position: vec3 } | null,
  force: boolean,
): boolean {
  if (force) {
    if (
      lastSentGoal &&
      poseDistanceCm(lastSentGoal.position, position) < GOAL_FORCE_NOOP_DISTANCE_CM
    ) {
      return false;
    }
    return true;
  }
  if (now - lastSendTime < GOAL_SEND_INTERVAL_S) {
    return false;
  }
  if (!lastSentGoal) {
    return true;
  }
  return poseDistanceCm(lastSentGoal.position, position) >= GOAL_SEND_MIN_DISTANCE_CM;
}

export class NavigationController {
  onFlashChange: (() => void) | null = null;

  private readonly session: ARModuleSession;
  private readonly eventHost: BaseScriptComponent;
  private readonly robotPresenter: RobotPresenter;
  private readonly parent: SceneObject;
  private readonly navGoalMarkerPrefab: ObjectPrefab;
  private readonly placement: GroundPlacement;
  private marker: NavGoalMarker | null = null;
  private lastPreview: { position: vec3; rotation: quat } | null = null;
  private lastSentGoal: { position: vec3 } | null = null;
  private lastGoalSendTime = -GOAL_SEND_INTERVAL_S;
  private lastReceivedPose: YawPose | null = null;
  private lastAppliedNav: NavState | null = null;
  private navFlash: NavFlash | null = null;
  private armed = false;
  private origin: ClientTrackingOrigin | null = null;

  constructor(deps: {
    session: ARModuleSession;
    eventHost: BaseScriptComponent;
    deviceTracking: DeviceTracking;
    robotPresenter: RobotPresenter;
    parent: SceneObject;
    navGoalMarkerPrefab: ObjectPrefab;
  }) {
    if (!deps.eventHost) {
      throw new Error("event host is required");
    }
    if (!deps.deviceTracking) {
      throw new Error("DeviceTracking is required");
    }
    if (!deps.robotPresenter) {
      throw new Error("robotPresenter is required");
    }
    if (!deps.parent) {
      throw new Error("parent is required");
    }
    if (!deps.navGoalMarkerPrefab) {
      throw new Error("navGoalMarkerPrefab is required");
    }
    this.session = deps.session;
    this.eventHost = deps.eventHost;
    this.robotPresenter = deps.robotPresenter;
    this.parent = deps.parent;
    this.navGoalMarkerPrefab = deps.navGoalMarkerPrefab;
    this.placement = new GroundPlacement(deps.eventHost, deps.deviceTracking);
    this.placement.onPose = (position, rotation, force) => this.streamGoal(position, rotation, force);
    this.placement.onDragChange = () => this.syncCancelVisible();
    this.placement.onCancel = () => this.cancelGoal();
    this.hide();
  }

  applyView(view: ARModuleSessionState, origin: ClientTrackingOrigin | null): void {
    const available = view.hasTrackingOrigin && view.capabilities?.navigation?.available === true;
    if (!available || !origin) {
      this.origin = null;
      this.lastReceivedPose = null;
      this.lastAppliedNav = null;
      this.navFlash = null;
      this.stop();
      return;
    }
    this.origin = origin;
    const radiusCm = this.robotPresenter.deadzoneRadiusCm();
    this.placement.setRobotGroundDeadzone(
      radiusCm !== null
        ? {
            radiusCm,
            getRobotWorldPosition: () => this.robotPresenter.worldPosition(),
            getRobotFloorWorldY: () => this.robotPresenter.floorWorldY(),
          }
        : null,
    );
    if (!this.armed) {
      this.arm(this.startPose());
    }
    const liveGoal = this.goalActive(view);
    const prevNav = this.lastAppliedNav;
    this.lastAppliedNav = view.nav;
    if (view.nav?.state === "resolved" && view.nav.outcome === "succeeded" && !view.nav_goal?.pose) {
      this.clearGoalFacts();
      this.placement.resetActivated();
    }
    const followFloor = !this.goalActive(view) && this.navFlash === null;
    this.placement.setFollowFloor(followFloor);
    if (followFloor) {
      const floor = this.robotPresenter.floorPose();
      if (floor) {
        this.placement.syncFollowFloorPose(floor.position, floor.rotation);
      }
    } else if (!this.placement.isActivelyDragging() && this.navFlash === null) {
      this.applyReceivedTarget(view.nav_goal?.pose ?? null, origin);
    }
    if (shouldBeginFailedFlash(prevNav, view.nav, liveGoal) && this.navFlash === null) {
      this.beginFlash("failed");
    }
    if (this.navFlash === null) {
      this.marker?.setGoalActive(this.goalActive(view));
    }
    this.syncCancelVisible(view);
  }

  flash(): NavFlash | null {
    return this.navFlash;
  }

  currentPose(): { position: vec3; rotation: quat } | null {
    if (!this.armed) {
      return null;
    }
    return this.placement.currentPose();
  }

  hide(): void {
    this.stop();
  }

  dispose(): void {
    this.stop();
    this.destroyMarker();
  }

  private applyReceivedTarget(pose: YawPose | null, origin: ClientTrackingOrigin): void {
    if (this.navFlash !== null) {
      return;
    }
    if (pose) {
      const world = specsYawPoseToWorld(clientTrackingToSpecsYawPose(odomToClientTrackingYawPose(pose, origin)));
      this.placement.applyPose(world.position, world.rotation);
      this.lastPreview = world;
      this.lastReceivedPose = pose;
      return;
    }
    if (!this.lastReceivedPose) {
      return;
    }
    this.lastReceivedPose = null;
    const floor = this.robotPresenter.floorPose();
    if (floor) {
      this.placement.applyPose(floor.position, floor.rotation);
      this.lastPreview = floor;
    }
  }

  private arm(start: { position: vec3; rotation: quat } | null): void {
    const pose = start ?? this.lastPreview;
    if (!pose) {
      return;
    }
    const marker = this.ensureMarker();
    this.placement.attach(marker);
    this.placement.start(pose.position, pose.rotation);
    this.armed = true;
    this.syncDragEnabled();
  }

  private stop(): void {
    this.placement.stop();
    this.placement.detach();
    this.marker?.hide();
    this.armed = false;
    this.lastSentGoal = null;
    this.lastGoalSendTime = -GOAL_SEND_INTERVAL_S;
    this.navFlash = null;
    this.lastAppliedNav = null;
    this.syncDragEnabled();
    this.marker?.setCancelVisible(false);
  }

  private streamGoal(position: vec3, rotation: quat, force: boolean): void {
    if (!this.origin || this.navFlash !== null) {
      return;
    }
    if (!shouldSendStreamGoal(getTime(), this.lastGoalSendTime, position, this.lastSentGoal, force)) {
      return;
    }
    const tracking = specsWorldPoseToTracking(position, rotation);
    const odom = clientTrackingToOdomPose(tracking, this.origin);
    try {
      requestNavGoal(this.session, odom);
    } catch {
      return;
    }
    this.lastPreview = { position, rotation };
    this.lastSentGoal = { position: new vec3(position.x, position.y, position.z) };
    this.lastGoalSendTime = getTime();
    this.syncCancelVisible();
  }

  private cancelGoal(): void {
    const view = this.session.view();
    if (!this.goalActive(view) || view.capabilities?.estop?.available !== true) {
      return;
    }
    try {
      this.session.requestEstop();
    } catch {
      return;
    }
    this.beginFlash("cancelled");
  }

  private beginFlash(flash: NavFlash): void {
    this.navFlash = flash;
    this.placement.resetActivated();
    this.clearGoalFacts();
    this.syncDragEnabled();
    this.marker?.showFlash(flash, () => this.completeFlash());
    this.onFlashChange?.();
  }

  private completeFlash(): void {
    this.navFlash = null;
    this.clearGoalFacts();
    this.placement.resetActivated();
    this.returnToRobotFloor();
    this.placement.setFollowFloor(true);
    const floor = this.robotPresenter.floorPose();
    if (floor) {
      this.placement.syncFollowFloorPose(floor.position, floor.rotation);
    }
    this.syncDragEnabled();
    this.marker?.setGoalActive(false);
    this.onFlashChange?.();
  }

  private clearGoalFacts(): void {
    this.lastSentGoal = null;
    this.lastReceivedPose = null;
    this.lastGoalSendTime = -GOAL_SEND_INTERVAL_S;
  }

  private returnToRobotFloor(): void {
    const floor = this.robotPresenter.floorPose();
    if (floor) {
      this.placement.applyPose(floor.position, floor.rotation);
      this.lastPreview = floor;
    }
    this.syncCancelVisible();
  }

  private syncCancelVisible(view: ARModuleSessionState = this.session.view()): void {
    if (this.navFlash !== null) {
      return;
    }
    this.marker?.setCancelVisible(
      this.isCancelVisible(view),
      view.capabilities?.estop?.available === true,
    );
  }

  private syncDragEnabled(): void {
    this.marker?.setDragEnabled(this.armed && this.navFlash === null);
  }

  private goalActive(view: ARModuleSessionState): boolean {
    return isLiveNavGoal(this.liveNavGoalInput(view));
  }

  private isCancelVisible(view: ARModuleSessionState): boolean {
    return isNavGoalCancelVisible({
      flashing: this.navFlash !== null,
      dragging: this.placement.isActivelyDragging(),
      ...this.liveNavGoalInput(view),
    });
  }

  private liveNavGoalInput(view: ARModuleSessionState): LiveNavGoalInput {
    return {
      activated: this.placement.isActivated(),
      hasSentGoal: this.lastSentGoal !== null,
      hasReceivedPose: this.lastReceivedPose !== null || view.nav_goal?.pose != null,
      followingPath: view.nav?.state === "following_path",
    };
  }

  private startPose(): { position: vec3; rotation: quat } | null {
    return this.lastPreview ?? this.robotPresenter.floorPose();
  }

  private ensureMarker(): NavGoalMarker {
    if (this.marker) {
      return this.marker;
    }
    const root = this.navGoalMarkerPrefab.instantiate(this.parent);
    const marker = root.getComponent(NavGoalMarker.getTypeName()) as NavGoalMarker | null;
    if (!marker) {
      root.destroy();
      throw new Error("navGoalMarkerPrefab is missing NavGoalMarker");
    }
    marker.ensureReady();
    this.marker = marker;
    return marker;
  }

  private destroyMarker(): void {
    this.marker?.destroy();
    this.marker = null;
  }
}

function isResolvedFailed(nav: NavState | null | undefined): boolean {
  return nav?.state === "resolved" && nav.outcome === "failed";
}

function poseDistanceCm(a: vec3, b: vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function specsYawPoseToWorld(pose: YawPose): { position: vec3; rotation: quat } {
  const half = pose[3] * 0.5;
  return {
    position: new vec3(pose[0], pose[1], pose[2]),
    rotation: new quat(Math.cos(half), 0, Math.sin(half), 0),
  };
}
