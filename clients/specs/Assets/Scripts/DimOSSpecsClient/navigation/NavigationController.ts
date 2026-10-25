import { NavigationGoalLifecycle, GOAL_SEND_MIN_DISTANCE_M, type NavFlash } from "../../DimOSARClient/navigation/NavigationGoalLifecycle";
import { shouldSendStreamGoal as sharedShouldSend } from "../../DimOSARClient/navigation/NavigationPolicy";
import type { ClientTrackingOrigin } from "../../DimOSARClient/localization/clientTrackingOrigin";
import { clientTrackingToOdomPose } from "../../DimOSARClient/localization/clientTrackingTransforms";
import { requestNavGoal } from "../../DimOSARClient/navigation/navGoalRequest";
import type { ARModuleSession, ARModuleSessionState } from "../../DimOSARClient/websocket/arModuleSession";
import type { Vec3, YawPose } from "../../DimOSARClient/websocket/protocolTypes";
import type { RobotPresenter } from "../presentation/RobotPresenter";
import { clientTrackingToSpecsYawPose, specsToClientTrackingYawPose } from "../utilities/SpecsCoordinates";
import { GroundPlacement } from "./GroundPlacement";
import { NavGoalMarker } from "./NavGoalMarker";

export { GOAL_SEND_INTERVAL_S } from "../../DimOSARClient/navigation/NavigationGoalLifecycle";
export const GOAL_SEND_MIN_DISTANCE_CM = GOAL_SEND_MIN_DISTANCE_M * 100;
export const GOAL_FORCE_NOOP_DISTANCE_CM = 2.0;

export function specsNavigationGoalInOdom(position: vec3, rotation: quat, origin: ClientTrackingOrigin) {
  const forward = rotation.multiplyVec3(new vec3(1, 0, 0));
  const tracking = specsToClientTrackingYawPose([
    position.x, position.y, position.z, Math.atan2(-forward.z, forward.x),
  ]);
  const half = tracking[3] * 0.5;
  return clientTrackingToOdomPose({
    position: [tracking[0], tracking[1], tracking[2]],
    orientation: [0, 0, Math.sin(half), Math.cos(half)],
  }, origin);
}

export type { NavFlash, LiveNavGoalInput } from "../../DimOSARClient/navigation/NavigationInteraction";
export { isLiveNavGoal, isNavGoalCancelVisible, shouldBeginFailedFlash } from "../../DimOSARClient/navigation/NavigationInteraction";
export function isDisconnectedWithoutRobot(view: ARModuleSessionState): boolean {
  const disconnected = view.connection === "disconnected" || view.connection === "failed";
  return disconnected && view.hello?.robot == null;
}

export function navMarkerMode(input: {
  hasTrackingOrigin: boolean;
  hasOrigin: boolean;
  navGoalAvailable: boolean;
  disconnectedWithoutRobot: boolean;
}): "live" | "preview" | "hidden" {
  if (input.disconnectedWithoutRobot) {
    return "preview";
  }
  if (input.hasTrackingOrigin && input.hasOrigin && input.navGoalAvailable) {
    return "live";
  }
  return "hidden";
}

export function shouldAnimateNavArrow(input: {
  shown: boolean;
  dragging: boolean;
  followingRobot: boolean;
}): boolean {
  return input.shown && !input.dragging && !input.followingRobot;
}

export function shouldSendStreamGoal(now: number, lastSendTime: number, position: vec3, lastSent: { position: vec3 } | null, force: boolean): boolean {
  const point = (p: vec3): Vec3 => [p.x / 100, p.y / 100, p.z / 100];
  if (force && lastSent && Math.hypot(position.x-lastSent.position.x, position.y-lastSent.position.y, position.z-lastSent.position.z) < GOAL_FORCE_NOOP_DISTANCE_CM) return false;
  return sharedShouldSend(now, lastSendTime, point(position), lastSent ? point(lastSent.position) : null, force);
}

export class NavigationController {
  onFlashChange: (() => void) | null = null;
  private readonly placement: GroundPlacement;
  private readonly goals: NavigationGoalLifecycle;
  private marker: NavGoalMarker | null = null;
  private armed = false;
  private origin: ClientTrackingOrigin | null = null;
  private lastPreview: { position: vec3; rotation: quat } | null = null;
  private shownFeedbackId = -1;
  private previousFlash: NavFlash | null = null;
  constructor(private readonly deps: {
    session: ARModuleSession; eventHost: BaseScriptComponent; deviceTracking: DeviceTracking;
    robotPresenter: RobotPresenter; parent: SceneObject; navGoalMarkerPrefab: ObjectPrefab;
  }) {
    for (const key of ["eventHost", "deviceTracking", "robotPresenter", "parent", "navGoalMarkerPrefab"] as const) if (!deps[key]) throw new Error(`${key} is required`);
    this.goals = new NavigationGoalLifecycle({ sendGoal: pose => requestNavGoal(deps.session, pose), cancel: () => deps.session.requestEstop() }, 0.02);
    this.placement = new GroundPlacement(deps.eventHost, deps.deviceTracking);
    this.placement.onPose = (position, rotation, force) => {
      this.lastPreview = { position, rotation };
      if (!this.origin) return;
      const p = specsToTracking(position, rotation);
      this.goals.send(getTime(), p, force); this.render();
    };
    this.placement.onDragChange = () => this.render();
    this.placement.onCancel = () => {
      if (isDisconnectedWithoutRobot(deps.session.view())) { this.placement.resetActivated(); this.followFloor(); }
      else this.goals.cancel();
      this.render();
    };
  }
  isArmed(): boolean { return this.armed; }
  flash(): NavFlash | null { return this.goals.snapshot().flash; }
  currentPose(): { position: vec3; rotation: quat } | null { return this.armed ? this.placement.currentPose() : null; }
  tick(deltaS: number): void { this.goals.tick(deltaS); if (this.armed) this.render(); }
  applyView(view: ARModuleSessionState, origin: ClientTrackingOrigin | null): void {
    const mode = navMarkerMode({ hasTrackingOrigin: view.hasTrackingOrigin, hasOrigin: origin !== null,
      navGoalAvailable: view.capabilities?.navigation.nav_goal.available === true, disconnectedWithoutRobot: isDisconnectedWithoutRobot(view) });
    this.origin = mode === "live" ? origin : null;
    const floor = this.deps.robotPresenter.floorPose();
    this.goals.apply(view, this.origin, floor ? specsToTracking(floor.position, floor.rotation) : null);
    if (mode === "hidden" || !floor) { this.hide(); return; }
    if (!this.armed) {
      this.placement.attach(this.ensureMarker());
      const start = this.lastPreview ?? floor;
      this.placement.start(start.position, start.rotation); this.armed = true;
    }
    const radiusCm = this.deps.robotPresenter.deadzoneRadiusCm();
    this.placement.setRobotGroundDeadzone(radiusCm !== null ? { radiusCm, getRobotWorldPosition: () => this.deps.robotPresenter.worldPosition(), getRobotFloorWorldY: () => this.deps.robotPresenter.floorWorldY() } : null);
    this.render();
  }
  hide(): void { this.goals.reset(); this.placement.stop(); this.placement.detach(); this.marker?.hide(); this.armed = false; this.origin = null; }
  dispose(): void { this.hide(); this.marker?.destroy(); this.marker = null; }
  private render(): void {
    if (!this.armed) return;
    const state = this.goals.snapshot();
    if (state.flash !== this.previousFlash) { this.previousFlash = state.flash; this.onFlashChange?.(); }
    if (state.flash) {
      if (state.feedbackId !== this.shownFeedbackId) {
        this.shownFeedbackId = state.feedbackId; this.placement.resetActivated();
        this.marker?.showFlash(state.flash, () => {});
      }
      this.marker?.setDragEnabled(false); return;
    }
    this.marker?.show(); this.marker?.setDragEnabled(true);
    const localPreview = !this.origin && this.placement.isActivated();
    const followFloor = state.attachedToRobot && !localPreview;
    this.placement.setFollowFloor(followFloor);
    if (followFloor) this.followFloor();
    else if (state.pose && !this.placement.isActivelyDragging()) {
      const yaw = 2 * Math.atan2(state.pose.orientation[2], state.pose.orientation[3]);
      const world = specsYawPoseToWorld(clientTrackingToSpecsYawPose([...state.pose.position, yaw]));
      this.placement.applyPose(world.position, world.rotation); this.lastPreview = world;
    }
    this.marker?.setGoalActive(state.active || localPreview);
    this.marker?.setCancelVisible((state.cancelVisible || localPreview) && !this.placement.isActivelyDragging(), true);
    this.marker?.setArrowAnimating(shouldAnimateNavArrow({ shown: true, dragging: this.placement.isActivelyDragging(), followingRobot: followFloor }));
  }
  private followFloor(): void {
    const floor = this.deps.robotPresenter.floorPose();
    if (floor) { this.placement.syncFollowFloorPose(floor.position, floor.rotation); this.lastPreview = floor; }
  }
  private ensureMarker(): NavGoalMarker {
    if (this.marker) return this.marker;
    const root = this.deps.navGoalMarkerPrefab.instantiate(this.deps.parent);
    const marker = root.getComponent(NavGoalMarker.getTypeName()) as NavGoalMarker | null;
    if (!marker) { root.destroy(); throw new Error("navGoalMarkerPrefab is missing NavGoalMarker"); }
    marker.ensureReady(); this.marker = marker; return marker;
  }
}
function specsToTracking(position: vec3, rotation: quat) {
  const forward = rotation.multiplyVec3(new vec3(1, 0, 0));
  const p = specsToClientTrackingYawPose([position.x, position.y, position.z, Math.atan2(-forward.z, forward.x)]);
  return { position: [p[0], p[1], p[2]] as Vec3, orientation: [0, 0, Math.sin(p[3] / 2), Math.cos(p[3] / 2)] as import("../../DimOSARClient/websocket/protocolTypes").Quat };
}
function specsYawPoseToWorld(pose: YawPose): { position: vec3; rotation: quat } {
  return { position: new vec3(pose[0], pose[1], pose[2]), rotation: new quat(Math.cos(pose[3] / 2), 0, Math.sin(pose[3] / 2), 0) };
}
