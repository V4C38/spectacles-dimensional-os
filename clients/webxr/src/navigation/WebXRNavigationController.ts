import type { ReadonlyFacts } from "@dimos-ar-client/ClientContracts";
import * as THREE from "three";
import type { ClientTrackingOrigin as MutableClientTrackingOrigin } from "@dimos-ar-client/localization/ClientTracking";
import type { ARModuleSession, ARModuleSessionState } from "@dimos-ar-client/websocket/ARModuleSession";
import type { Quat, Vec3, YawPose } from "@dimos-ar-client/ClientContracts";
import { NavigationInteraction, NavigationPreviewCoordinator, deriveNavigationPresentation } from "@dimos-ar-client/navigation/NavigationInteraction";

import { requestNavGoal } from "@dimos-ar-client/navigation/NavigationCommands";
import { clientTrackingToWebxrPose, clientTrackingToWebxrPoint, webxrHeadingToClientTrackingPose, webxrToClientTrackingPoint } from "../utilities/WebXRCoordinates";
import { WebXRNavGoalView, type NavFlash } from "./WebXRNavigationRenderer";
import { FLOOR_AIM_RANGE_M, RAY_LENGTH_M, solveMeshPlacement, type MeshHit } from "../input/WebXRInteraction";

type ClientTrackingOrigin = ReadonlyFacts<MutableClientTrackingOrigin>;
export { FLASH_DURATION_S, robotDeadzoneRadiusM } from "@dimos-ar-client/navigation/NavigationInteraction";

/** WebXR placement and scene binding. All navigation interaction policy lives in ClientCore. */
export class WebXRNavigationController {
  private viewerPosition: Vec3 | null = null;
  setViewerPosition(position: Vec3): void { this.viewerPosition = position; }
  readonly probeRoot = new THREE.Group();
  readonly marker = new WebXRNavGoalView();
  readonly draftMarker = new WebXRNavGoalView();
  readonly probes = new Map<string, WebXRNavGoalView>();
  readonly interaction: NavigationInteraction;

  constructor(session: ARModuleSession) {
    this.interaction = new NavigationInteraction({ sendGoal: pose => requestNavGoal(session, pose), cancel: () => session.requestEstop() }, new NavigationPreviewCoordinator(session), undefined, session.collaboration);
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
  activePath(): readonly Readonly<YawPose>[] | null { return this.interaction.activePath(); }
  previewPath(): readonly Readonly<YawPose>[] | null { return this.interaction.previewPath(); }
  flash(): NavFlash | null { return this.interaction.flash(); }
  clearAim(sourceId?: string): void { this.interaction.clearAim(sourceId); this.sync(); }
  cancel(now: number): void { this.interaction.cancel(now); this.sync(); }
  cancelDrag(): void { this.interaction.cancelDrag(); this.sync(); }
  reset(): void { this.interaction.reset(); this.sync(); }
  dispose(): void { this.probeRoot.removeFromParent(); this.interaction.dispose(); this.marker.dispose(); this.draftMarker.dispose(); for (const view of this.probes.values()) view.dispose(); this.probes.clear(); }

  aim(now: number, from: Vec3, dir: Vec3, hits: MeshHit[], fallbackY: number, sourceId = "default"): void {
    this.interaction.aim(now, this.place(from, dir, hits, fallbackY, true), sourceId); this.sync();
  }
  hold(now: number, from: Vec3, dir: Vec3, hits: MeshHit[], fallbackY: number, streaming = true, sourceId = "default"): boolean {
    const held = this.interaction.hold(now, this.place(from, dir, hits, fallbackY, !streaming), streaming, sourceId); this.sync(); return held;
  }
  release(now: number, from: Vec3, dir: Vec3, hits: MeshHit[], fallbackY: number, sourceId = "default"): void {
    this.interaction.release(now, this.place(from, dir, hits, fallbackY, this.interaction.snapshot().placementHeld === true), sourceId); this.sync();
  }

  private place(from: Vec3, dir: Vec3, hits: MeshHit[], fallbackY: number, floorAim = false): { position: Vec3; blocked: boolean } {
    const length = Math.hypot(...dir) || 1;
    const to = from.map((value, i) => value + dir[i] / length * (floorAim ? FLOOR_AIM_RANGE_M : RAY_LENGTH_M)) as Vec3;
    const result = solveMeshPlacement({ rayFrom: from, rayTo: to, hits, fallbackY });
    const position: Vec3 = [...(result.goalPosition ?? result.probePosition)];
    const viewer = this.viewerPosition ?? from;
    if (Math.hypot(...position.map((v, i) => v - viewer[i])) > 2.5) position[1] = Math.max(fallbackY, position[1]);
    return { position: webxrToClientTrackingPoint(position), blocked: result.status !== "ok" };
  }
  private sync(): void {
    const state = this.interaction.snapshot();
    const frame = deriveNavigationPresentation(state, { showFlashDuringDrag: true });
    const pose = clientTrackingToWebxrPose(frame.mainPose);
    this.marker.setPose(pose.position, pose.orientation);
    if (frame.mainVisible) this.marker.show(); else this.marker.hide();
    this.marker.setBlocked(frame.blocked);
    this.draftMarker.setBlocked(frame.blocked);
    this.marker.setSelected(frame.selected);
    this.marker.setAiming(false);
    this.marker.setInteraction(frame.dragging, frame.following);
    this.marker.setFlash(frame.flash, frame.feedbackProgress);
    this.marker.setProbe(null);
    this.marker.setCancelVisible(frame.cancelVisible, frame.confirmationId);
    const opacity = this.marker.circleOpacity();
    if (frame.draftVisible && frame.draftPose) {
      const draft = clientTrackingToWebxrPose(frame.draftPose);
      this.draftMarker.setPose(draft.position, draft.orientation);
      this.draftMarker.show(); this.draftMarker.setSelected(true); this.draftMarker.setAiming(true);
      this.draftMarker.setInteraction(frame.draftHeld, false); this.draftMarker.setSharedOpacity(opacity);
    } else this.draftMarker.hide();
    const ids = new Set(frame.probes.map(probe => probe.sourceId));
    for (const [id, view] of this.probes) if (!ids.has(id)) { view.dispose(); this.probes.delete(id); }
    for (const probe of frame.probes) {
      let view = this.probes.get(probe.sourceId);
      if (!view) { view = new WebXRNavGoalView(0.06); this.probes.set(probe.sourceId, view); this.probeRoot.add(view.probe); }
      view.setProbe(clientTrackingToWebxrPoint(probe.position)); view.setSharedOpacity(opacity);
    }
  }
}
