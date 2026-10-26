import { NavigationInteraction, type Placement } from "../../DimOSARClient/navigation/NavigationInteraction";
import { NavigationPreviewCoordinator } from "../../DimOSARClient/navigation/NavigationPreviewCoordinator";
import { NavigationMarkerRenderer } from "./NavigationMarkerRenderer";
import { solveMeshPlacement } from "./GroundPlacement";
import { specsToClientTrackingPoint, clientTrackingToSpecsPoint, clientTrackingToSpecsYawPose, specsToClientTrackingYawPose } from "../utilities/SpecsCoordinates";
import type { NavFlash } from "../../DimOSARClient/navigation/NavigationGoalLifecycle";
import type { ClientTrackingOrigin } from "../../DimOSARClient/localization/clientTrackingOrigin";
import { requestNavGoal } from "../../DimOSARClient/navigation/navGoalRequest";
import type { ARModuleSession, ARModuleSessionState } from "../../DimOSARClient/websocket/arModuleSession";
import type { Vec3, YawPose } from "../../DimOSARClient/websocket/protocolTypes";
import type { RobotPresenter } from "../presentation/RobotPresenter";
import { NavGoalMarker } from "./NavGoalMarker";

export class NavigationController {
  onFlashChange: (() => void) | null = null;
  readonly interaction: NavigationInteraction;
  private marker: NavGoalMarker | null = null;
  private draftMarker: NavGoalMarker | null = null;
  private readonly probes = new Map<string, NavigationMarkerRenderer>();
  private readonly inside = new Map<string, boolean>();
  private previousFlash: NavFlash | null = null;
  private inputEnabled = true;
  private directSource: string | null = null;
  private viewportHeight = 1024;
  private hovered = false;
  private meshTracking = false;
  private lastMeshUseAt = -Infinity;

  constructor(private readonly deps: {
    session: ARModuleSession; deviceTracking: DeviceTracking;
    robotPresenter: RobotPresenter; cameraObject: SceneObject; parent: SceneObject; navGoalMarkerPrefab: ObjectPrefab;
  }) {
    deps.deviceTracking.worldOptions.enableWorldMeshesTracking = false;
    this.interaction = new NavigationInteraction({ sendGoal: pose => requestNavGoal(deps.session, pose),
      cancel: () => deps.session.requestEstop() }, new NavigationPreviewCoordinator(deps.session));
  }

  isArmed(): boolean { return this.interaction.snapshot().visible; }
  flash(): NavFlash | null { return this.interaction.flash(); }
  currentPose(): { position: vec3; rotation: quat } | null {
    if (!this.isArmed()) return null;
    const s = this.interaction.snapshot();
    return trackingToSpecs(s.draft ?? s.activeGoal.pose ?? s);
  }
  activePath() { return this.interaction.activePath(); }
  previewPath() { return this.interaction.previewPath(); }
  isAiming(): boolean { return this.interaction.isAiming(); }
  circleBounds() { return this.marker?.circleBounds(); }
  draftCircleBounds() { return this.draftMarker?.circleBounds(); }
  circleOpacity(): number { return this.marker?.circleOpacity() ?? 0.35; }
  setViewportHeight(height: number): void { this.viewportHeight = height; }
  setSelected(selected: boolean): void {
    if (this.interaction.snapshot().selected === selected) return;
    this.interaction.setSelected(selected);
    if (!selected) this.setMeshTracking(false);
  }
  setHovered(hovered: boolean): void { this.hovered = hovered; }
  ownsDraft(sourceId: string): boolean { return this.interaction.ownsDraft(sourceId); }
  setInputEnabled(enabled: boolean): void {
    if (!enabled && this.inputEnabled) { this.cancelDrag(); this.setMeshTracking(false); }
    this.inputEnabled = enabled;
  }
  cancel(): void { this.interaction.cancel(getTime()); this.render(0); }
  cancelDrag(): void { this.directSource = null; this.interaction.cancelDrag(); this.render(0); }
  cancelSource(sourceId: string): void {
    if (this.directSource === sourceId) this.cancelDrag();
    this.clearAim(sourceId);
  }
  tick(deltaS: number): void {
    this.interaction.tick(getTime(), Math.max(0, Math.min(deltaS, 0.1)));
    if (this.meshTracking && getTime() - this.lastMeshUseAt >= 1) this.setMeshTracking(false);
    this.render(deltaS);
  }
  applyView(view: ARModuleSessionState, origin: ClientTrackingOrigin | null): void {
    const floor = this.deps.robotPresenter.floorPose();
    this.interaction.applyView(view, origin, floor ? specsNavigationPoseInTracking(floor.position, floor.rotation) : null, getTime());
  }
  hide(): void { this.directSource = null; this.interaction.reset(); this.setMeshTracking(false); this.render(0); }
  dispose(): void {
    this.setMeshTracking(false);
    this.interaction.dispose(); this.marker?.destroy(); this.draftMarker?.destroy();
    for (const probe of this.probes.values()) probe.destroy(); this.probes.clear();
  }
  ownsMarkerTarget(object: SceneObject): boolean {
    return this.marker?.ownsDragTarget(object) === true || this.draftMarker?.ownsDragTarget(object) === true;
  }

  aim(sourceId: string, from: vec3, direction: vec3): void {
    const state = this.interaction.snapshot();
    if (!this.inputEnabled || !state.selected || !state.visible) { this.clearAim(sourceId); return; }
    this.interaction.aim(getTime(), this.place(sourceId, from, direction, true), sourceId);
  }
  clearAim(sourceId: string): void { this.interaction.clearAim(sourceId); this.inside.delete(sourceId); }
  hold(sourceId: string, from: vec3, direction: vec3, fromMarker: boolean): void {
    if (!this.inputEnabled || !this.isArmed()) return;
    const selected = this.interaction.snapshot().selected;
    if (!selected) {
      if (!fromMarker || this.directSource !== null && this.directSource !== sourceId) return;
      this.directSource = sourceId;
    }
    const placement = this.place(sourceId, from, direction, selected || !fromMarker);
    this.interaction.hold(getTime(), placement, fromMarker, sourceId);
  }
  release(sourceId: string, from: vec3, direction: vec3): void {
    if (!this.inputEnabled || this.directSource !== null && this.directSource !== sourceId) return;
    const selected = this.interaction.snapshot().selected;
    if (!selected && this.directSource !== sourceId) return;
    this.directSource = null;
    this.interaction.release(getTime(), this.place(sourceId, from, direction, selected), sourceId);
  }

  private place(sourceId: string, from: vec3, direction: vec3, floorAim: boolean): Placement {
    const length = direction.length;
    if (length < 0.001) return null;
    const to = from.add(direction.uniformScale((floorAim ? 500 : 2000) / length));
    this.lastMeshUseAt = getTime(); this.setMeshTracking(true);
    const raw = this.deps.deviceTracking.raycastWorldMesh(from, to);
    const radiusCm = this.deps.robotPresenter.deadzoneRadiusCm();
    const floorY = this.deps.robotPresenter.floorWorldY() ?? 0;
    // SIK mesh hits have no semantic floor label. Match WebXR's unlabelled
    // floor gate: 20 degrees and within 18 cm of the known robot floor.
    const first = raw[0];
    if (first
      ? first.normal.length < 0.0001 || first.normal.y / first.normal.length < Math.cos(Math.PI / 9) ||
        Math.abs(first.position.y - floorY) > 18 || first.position.sub(from).dot(direction) <= 0
      : direction.y >= -0.0001) return null;
    const result = solveMeshPlacement({ rayFrom: from, rayTo: to, hits: raw.map(hit => ({ position: hit.position, normal: hit.normal })),
      deadzone: radiusCm === null ? null : { radiusCm,
        getRobotWorldPosition: () => this.deps.robotPresenter.worldPosition(),
        getRobotFloorWorldY: () => this.deps.robotPresenter.floorWorldY() },
      wasInsideDeadzone: this.inside.get(sourceId) ?? false, fallbackY: floorY });
    this.inside.set(sourceId, result.wasInsideDeadzone);
    const p = result.goalPosition;
    if (result.status !== "ok" || !p || floorAim && p.distance(from) > 500) return null;
    return { position: specsToClientTrackingPoint([p.x, p.y, p.z]), blocked: false };
  }

  private setMeshTracking(enabled: boolean): void {
    if (this.meshTracking === enabled) return;
    this.meshTracking = enabled;
    this.deps.deviceTracking.worldOptions.enableWorldMeshesTracking = enabled;
  }

  private createMarker(name: string): NavGoalMarker {
    const root = this.deps.navGoalMarkerPrefab.instantiate(this.deps.parent); root.name = name;
    root.getTransform().setWorldScale(vec3.one());
    const marker = root.getComponent(NavGoalMarker.getTypeName()) as NavGoalMarker;
    if (!marker) { root.destroy(); throw new Error("Navigation prefab is missing NavGoalMarker"); }
    marker.ensureReady(); marker.bindEvents({ onCancel: () => this.cancel() }); return marker;
  }
  private render(deltaS: number): void {
    const state = this.interaction.snapshot();
    if (state.flash !== this.previousFlash) { this.previousFlash = state.flash; this.onFlashChange?.(); }
    if (!state.visible) {
      this.marker?.hide(); this.draftMarker?.hide();
      for (const probe of this.probes.values()) probe.hide(); return;
    }
    if (!this.marker) this.marker = this.createMarker("NavigationTargetMarker");
    const pose = trackingToSpecs(!state.selected && state.dragging ? state : state.activeGoal.pose ?? state);
    this.marker.setPose(pose.position, pose.rotation);
    if (!state.draft || state.activeGoal.active || state.flash) this.marker.show(); else this.marker.hide();
    this.marker.setDragEnabled(this.inputEnabled && !state.flash);
    this.marker.setCancelVisible(state.cancelVisible);
    this.marker.applyWorldStyle({ selected: state.selected, hovered: this.hovered, dragging: state.dragging,
      following: state.followingPath, aiming: false, cancelVisible: state.cancelVisible, flash: state.flash, feedbackProgress: state.feedbackProgress }, deltaS, this.viewportHeight);
    this.marker.orientViewer(this.deps.cameraObject.getTransform().getWorldPosition());
    const opacity = this.marker.circleOpacity();
    if (state.draft) {
      if (!this.draftMarker) this.draftMarker = this.createMarker("NavigationDraftMarker");
      const draft = trackingToSpecs(state.draft);
      this.draftMarker.setPose(draft.position, draft.rotation); this.draftMarker.show();
      this.draftMarker.setDragEnabled(false); this.draftMarker.setCancelVisible(false);
      this.draftMarker.applyWorldStyle({ selected: true, dragging: state.draft.held, following: false,
        aiming: true, flash: null, feedbackProgress: 0, opacity }, deltaS, this.viewportHeight, 6);
    } else this.draftMarker?.hide();
    const ids = new Set(state.probes.map(p => p.sourceId));
    for (const [id, probe] of this.probes) if (!ids.has(id)) { probe.destroy(); this.probes.delete(id); }
    for (const probe of state.probes) {
      let renderer = this.probes.get(probe.sourceId);
      if (!renderer) { renderer = new NavigationMarkerRenderer(this.deps.parent, 6, true); this.probes.set(probe.sourceId, renderer); }
      renderer.root.getTransform().setWorldScale(vec3.one());
      const p = clientTrackingToSpecsPoint(probe.position);
      renderer.root.getTransform().setWorldPosition(new vec3(...p)); renderer.show();
      renderer.apply({ selected: true, dragging: false, following: false, aiming: true, flash: null,
        feedbackProgress: 0, opacity }, deltaS, this.viewportHeight);
    }
  }
}
function trackingToSpecs(pose: { position: Vec3; orientation: import("../../DimOSARClient/websocket/protocolTypes").Quat }) {
  const yaw = 2 * Math.atan2(pose.orientation[2], pose.orientation[3]);
  return specsYawPoseToWorld(clientTrackingToSpecsYawPose([...pose.position, yaw]));
}

export function specsNavigationPoseInTracking(position: vec3, rotation: quat) {
  const forward = rotation.multiplyVec3(new vec3(1, 0, 0));
  const p = specsToClientTrackingYawPose([position.x, position.y, position.z, Math.atan2(-forward.z, forward.x)]);
  return { position: [p[0], p[1], p[2]] as Vec3, orientation: [0, 0, Math.sin(p[3] / 2), Math.cos(p[3] / 2)] as import("../../DimOSARClient/websocket/protocolTypes").Quat };
}
function specsYawPoseToWorld(pose: YawPose): { position: vec3; rotation: quat } {
  return { position: new vec3(pose[0], pose[1], pose[2]), rotation: new quat(Math.cos(pose[3] / 2), 0, Math.sin(pose[3] / 2), 0) };
}
