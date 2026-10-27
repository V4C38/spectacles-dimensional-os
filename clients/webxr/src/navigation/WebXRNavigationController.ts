import * as THREE from "three";
import type { ClientTrackingOrigin } from "@dimos-ar-client/localization/clientTrackingOrigin";
import type { ARModuleSession, ARModuleSessionState } from "@dimos-ar-client/websocket/arModuleSession";
import type { Quat, Vec3, YawPose } from "@dimos-ar-client/websocket/protocolTypes";
import { NavigationInteraction } from "@dimos-ar-client/navigation/NavigationInteraction";
import { NavigationPreviewCoordinator } from "@dimos-ar-client/navigation/NavigationPreviewCoordinator";
import { requestNavGoal } from "@dimos-ar-client/navigation/navGoalRequest";
import { clientTrackingToWebxrPose, clientTrackingToWebxrPoint, webxrHeadingToClientTrackingPose, webxrToClientTrackingPoint } from "../utilities/WebXRCoordinates";
import { WebXRNavGoalView, type NavFlash } from "./WebXRNavGoalView";
import { FLOOR_AIM_RANGE_M, RAY_LENGTH_M, solveMeshPlacement, type MeshHit, type RobotGroundDeadzone } from "./WebXRGroundPlacement";
export { FLASH_DURATION_S, robotDeadzoneRadiusM } from "@dimos-ar-client/navigation/NavigationInteraction";

/** WebXR placement and scene binding. All navigation interaction policy lives in ClientCore. */
export class WebXRNavigationController {
  readonly probeRoot = new THREE.Group();
  readonly marker = new WebXRNavGoalView();
  readonly draftMarker = new WebXRNavGoalView();
  readonly probes = new Map<string, WebXRNavGoalView>();
  readonly interaction: NavigationInteraction;
  private wasInsideDeadzone = false;

  constructor(session: ARModuleSession) {
    this.interaction = new NavigationInteraction({ sendGoal: pose => requestNavGoal(session, pose), cancel: () => session.requestEstop() }, new NavigationPreviewCoordinator(session));
  }

  applyView(view: ARModuleSessionState, origin: ClientTrackingOrigin | null, robotFloor: { position: Vec3; orientation: Quat } | null, now: number): void {
    this.interaction.applyView(view, origin, robotFloor ? webxrHeadingToClientTrackingPose(robotFloor) : null, now);
    this.sync();
  }
  tick(now: number, visibleDeltaS = 0): void {
    this.interaction.tick(now, visibleDeltaS);
    this.sync();
    this.marker.tick(visibleDeltaS);
    if (this.draftMarker.object.visible) this.draftMarker.tick(visibleDeltaS);
    this.sync();
  }
  setSelected(selected: boolean): void { this.interaction.setSelected(selected); this.sync(); }
  isAiming(): boolean { return this.interaction.isAiming(); }
  isDragging(): boolean { return this.interaction.isDragging(); }
  isRouteVisible(): boolean { return this.interaction.isRouteVisible(); }
  activePath(): YawPose[] | null { return this.interaction.activePath(); }
  previewPath(): YawPose[] | null { return this.interaction.previewPath(); }
  flash(): NavFlash | null { return this.interaction.flash(); }
  clearAim(sourceId?: string): void { this.interaction.clearAim(sourceId); this.sync(); }
  cancel(now: number): void { this.interaction.cancel(now); this.sync(); }
  cancelDrag(): void { this.interaction.cancelDrag(); this.sync(); }
  reset(): void { this.interaction.reset(); this.wasInsideDeadzone = false; this.sync(); }
  dispose(): void { this.probeRoot.removeFromParent(); this.interaction.dispose(); this.marker.dispose(); this.draftMarker.dispose(); for (const view of this.probes.values()) view.dispose(); this.probes.clear(); }

  aim(now: number, from: Vec3, dir: Vec3, hits: MeshHit[], deadzone: RobotGroundDeadzone | null, fallbackY: number, sourceId = "default"): void {
    this.interaction.aim(now, this.place(from, dir, hits, deadzone, fallbackY, true), sourceId); this.sync();
  }
  hold(now: number, from: Vec3, dir: Vec3, hits: MeshHit[], deadzone: RobotGroundDeadzone | null, fallbackY: number, streaming = true, sourceId = "default"): boolean {
    const held = this.interaction.hold(now, this.place(from, dir, hits, deadzone, fallbackY, !streaming), streaming, sourceId); this.sync(); return held;
  }
  release(now: number, from: Vec3, dir: Vec3, hits: MeshHit[], deadzone: RobotGroundDeadzone | null, fallbackY: number, sourceId = "default"): void {
    this.interaction.release(now, this.place(from, dir, hits, deadzone, fallbackY, this.interaction.snapshot().placementHeld === true), sourceId); this.sync();
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
    const mainPose = state.dragging ? state : state.activeGoal.pose ?? state;
    const pose = clientTrackingToWebxrPose(mainPose);
    this.marker.setPose(pose.position, pose.orientation);
    if (state.visible && (!state.draft || state.activeGoal.active || state.flash)) this.marker.show(); else this.marker.hide();
    this.marker.setSelected(state.selected);
    this.marker.setAiming(false);
    this.marker.setGoalActive(state.goalActive);
    this.marker.setInteraction(state.dragging, state.followingPath);
    this.marker.setFlash(state.flash, state.feedbackProgress);
    this.marker.setProbe(null);
    this.marker.setCancelVisible(state.cancelVisible, state.activeGoal.confirmationId);
    const opacity = this.marker.circleOpacity();
    if (state.draft && state.visible) {
      const draft = clientTrackingToWebxrPose(state.draft);
      this.draftMarker.setPose(draft.position, draft.orientation);
      this.draftMarker.show(); this.draftMarker.setSelected(true); this.draftMarker.setAiming(true);
      this.draftMarker.setInteraction(state.draft.held, false); this.draftMarker.setSharedOpacity(opacity);
    } else this.draftMarker.hide();
    const ids = new Set(state.probes.map(probe => probe.sourceId));
    for (const [id, view] of this.probes) if (!ids.has(id)) { view.dispose(); this.probes.delete(id); }
    for (const probe of state.probes) {
      let view = this.probes.get(probe.sourceId);
      if (!view) { view = new WebXRNavGoalView(0.06); this.probes.set(probe.sourceId, view); this.probeRoot.add(view.probe); }
      view.setProbe(clientTrackingToWebxrPoint(probe.position)); view.setSharedOpacity(opacity);
    }
  }
}

/** Direction helper for WebXR callers; portable heading math uses +X forward, Z up. */
export function yawFromPlanarDirection(x: number, z: number): Quat {
  const yaw = Math.atan2(-x, -z);
  return [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
}
