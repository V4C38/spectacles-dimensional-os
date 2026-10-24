import type { ClientTrackingOrigin } from "@dimos-ar-client/localization/clientTrackingOrigin";
import type { ARModuleSession, ARModuleSessionState } from "@dimos-ar-client/websocket/arModuleSession";
import type { Quat, Vec3, YawPose } from "@dimos-ar-client/websocket/protocolTypes";
import { NavigationInteraction } from "@dimos-ar-client/navigation/NavigationInteraction";
import { NavigationPreviewCoordinator } from "@dimos-ar-client/navigation/NavigationPreviewCoordinator";
import { requestNavGoal } from "@dimos-ar-client/navigation/navGoalRequest";
import { clientTrackingToWebxrPose, webxrHeadingToClientTrackingPose, webxrToClientTrackingPoint } from "../utilities/WebXRCoordinates";
import { WebXRNavGoalView, type NavFlash } from "./WebXRNavGoalView";
import { FLOOR_AIM_RANGE_M, RAY_LENGTH_M, solveMeshPlacement, type MeshHit, type RobotGroundDeadzone } from "./WebXRGroundPlacement";
export { FLASH_DURATION_S, shouldBeginFailedFlash, robotDeadzoneRadiusM, shouldSendStreamGoal, isLiveNavGoal, isNavGoalCancelVisible } from "@dimos-ar-client/navigation/NavigationInteraction";

/** WebXR placement and scene binding. All navigation interaction policy lives in ClientCore. */
export class WebXRNavigationController {
  readonly marker = new WebXRNavGoalView();
  readonly interaction: NavigationInteraction;
  private wasInsideDeadzone = false;
  private lastTick: number | null = null;

  constructor(session: ARModuleSession) {
    this.interaction = new NavigationInteraction({ sendGoal: pose => requestNavGoal(session, pose), cancel: () => session.requestEstop() }, new NavigationPreviewCoordinator(session));
  }

  applyView(view: ARModuleSessionState, origin: ClientTrackingOrigin | null, robotFloor: { position: Vec3; orientation: Quat } | null, now: number): void {
    this.interaction.applyView(view, origin, robotFloor ? webxrHeadingToClientTrackingPose(robotFloor) : null, now);
    this.sync();
  }
  tick(now: number): void {
    this.interaction.tick(now);
    this.sync();
    this.marker.tick(this.lastTick === null ? 0 : Math.max(0, now - this.lastTick));
    this.lastTick = now;
  }
  setSelected(selected: boolean): void { this.interaction.setSelected(selected); this.sync(); }
  isAiming(): boolean { return this.interaction.isAiming(); }
  isDragging(): boolean { return this.interaction.isDragging(); }
  isRouteVisible(): boolean { return this.interaction.isRouteVisible(); }
  activePath(): YawPose[] | null { return this.interaction.activePath(); }
  previewPath(): YawPose[] | null { return this.interaction.previewPath(); }
  flash(): NavFlash | null { return this.interaction.flash(); }
  clearAim(): void { this.interaction.clearAim(); this.sync(); }
  cancel(now: number): void { this.interaction.cancel(now); this.sync(); }
  cancelDrag(): void { this.interaction.cancelDrag(); this.sync(); }
  reset(): void { this.interaction.reset(); this.wasInsideDeadzone = false; this.lastTick = null; this.sync(); }
  dispose(): void { this.interaction.dispose(); this.marker.dispose(); }

  aim(now: number, from: Vec3, dir: Vec3, hits: MeshHit[], deadzone: RobotGroundDeadzone | null, fallbackY: number): void {
    this.interaction.aim(now, this.place(from, dir, hits, deadzone, fallbackY, true)); this.sync();
  }
  hold(now: number, from: Vec3, dir: Vec3, hits: MeshHit[], deadzone: RobotGroundDeadzone | null, fallbackY: number, streaming = true): boolean {
    const held = this.interaction.hold(now, this.place(from, dir, hits, deadzone, fallbackY, !streaming), streaming); this.sync(); return held;
  }
  release(now: number, from: Vec3, dir: Vec3, hits: MeshHit[], deadzone: RobotGroundDeadzone | null, fallbackY: number): void {
    this.interaction.release(now, this.place(from, dir, hits, deadzone, fallbackY, this.interaction.snapshot().placementHeld === true)); this.sync();
  }

  private place(from: Vec3, dir: Vec3, hits: MeshHit[], deadzone: RobotGroundDeadzone | null, fallbackY: number, floorAim = false): { position: Vec3; blocked: boolean } {
    const length = Math.hypot(...dir) || 1;
    const to = from.map((value, i) => value + dir[i] / length * (floorAim ? FLOOR_AIM_RANGE_M : RAY_LENGTH_M)) as Vec3;
    const result = solveMeshPlacement({ rayFrom: from, rayTo: to, hits, deadzone, wasInsideDeadzone: this.wasInsideDeadzone, fallbackY });
    this.wasInsideDeadzone = result.wasInsideDeadzone;
    return { position: webxrToClientTrackingPoint(result.goalPosition ?? result.probePosition), blocked: result.status !== "ok" };
  }
  private sync(): void {
    const state = this.interaction.snapshot();
    const pose = clientTrackingToWebxrPose(state);
    this.marker.setPose(pose.position, pose.orientation);
    if (state.visible) this.marker.show(); else this.marker.hide();
    this.marker.setSelected(state.selected);
    this.marker.setAiming(state.aiming);
    this.marker.setGoalActive(state.goalActive);
    this.marker.setInteraction(state.dragging === true || state.placementHeld === true, state.followingPath === true);
    this.marker.setFlash(state.flash);
    this.marker.setCancelVisible(state.cancelVisible);
  }
}

/** Direction helper for WebXR callers; portable heading math uses +X forward, Z up. */
export function yawFromPlanarDirection(x: number, z: number): Quat {
  const yaw = Math.atan2(-x, -z);
  return [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
}
