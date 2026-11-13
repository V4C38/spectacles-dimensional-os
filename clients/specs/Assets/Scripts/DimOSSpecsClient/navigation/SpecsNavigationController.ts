import type { ReadonlyFacts } from "DimOSARClient.lspkg/Scripts/DimOSARClient/ClientContracts";
import type { ClientTrackingOrigin as MutableClientTrackingOrigin } from "DimOSARClient.lspkg/Scripts/DimOSARClient/localization/ClientTracking";
import { requestNavGoal } from "DimOSARClient.lspkg/Scripts/DimOSARClient/navigation/NavigationCommands";
import { type NavFlash, deriveNavigationPresentation, NavigationInteraction, type Placement, NavigationPreviewCoordinator } from "DimOSARClient.lspkg/Scripts/DimOSARClient/navigation/NavigationInteraction";


import type { ARModuleSession, ARModuleSessionState } from "DimOSARClient.lspkg/Scripts/DimOSARClient/websocket/ARModuleSession";
import type { Vec3, YawPose } from "DimOSARClient.lspkg/Scripts/DimOSARClient/ClientContracts";
import type { RobotPresenter } from "../presentation/RobotPresenter";
import { clientTrackingToSpecsPoint, clientTrackingToSpecsYawPose, specsToClientTrackingPoint, specsToClientTrackingYawPose } from "../utilities/SpecsCoordinates";
import { NavGoalMarker } from "./NavGoalMarker";
import { NavigationMarkerRenderer } from "./SpecsNavigationRenderer";
import { InteractionManager } from "SpectaclesInteractionKit.lspkg/Core/InteractionManager/InteractionManager";
import { InteractorInputType, type Interactor } from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor";
import { worldMarkerHover } from "DimOSARClient.lspkg/Scripts/DimOSARClient/presentation/WorldPresentation";

type ClientTrackingOrigin = ReadonlyFacts<MutableClientTrackingOrigin>;

export class SpecsNavigationController {
  readonly interaction: NavigationInteraction;
  private marker: NavGoalMarker | null = null;
  private draftMarker: NavGoalMarker | null = null;
  private readonly probes = new Map<string, NavigationMarkerRenderer>();
  private readonly dragPlanes = new Map<string, { plane: DragPlacementPlane; filter: SpecsDragPosition; offset: vec3 | null; time: number }>();
  private readonly floor = new SpecsFloorReference();
  private surveyRemaining = 0;
  private surveyNextAt = 0;
  private surveyDeadline = 0;
  private surveyIndex = 0;
  private dragPlaneOrigin: ClientTrackingOrigin | null = null;
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
      cancel: () => deps.session.requestEstop() }, new NavigationPreviewCoordinator(deps.session), 1 / 0.08, deps.session.collaboration);
  }

  isArmed(): boolean {
    const state = this.interaction.snapshot();
    return state.visible && (this.floor.heightCm !== null || state.activeGoal.pose !== null);
  }
  flash(): NavFlash | null { return this.interaction.flash(); }
  currentPose(): { position: vec3; rotation: quat } | null {
    if (!this.isArmed()) return null;
    const s = this.interaction.snapshot();
    return trackingToSpecs(s.dragging ? s : s.draft ?? s.activeGoal.pose ?? s);
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
    if (!selected) { this.dragPlanes.clear(); this.setMeshTracking(false); }
  }
  setHovered(hovered: boolean): void { this.hovered = hovered; }
  isMarkerAttachedToRobot(): boolean { return this.interaction.snapshot().attachedToRobot; }
  ownsDraft(sourceId: string): boolean { return this.interaction.ownsDraft(sourceId); }
  setInputEnabled(enabled: boolean): void {
    if (!enabled && this.inputEnabled) { this.cancelDrag(); this.setMeshTracking(false); }
    this.inputEnabled = enabled;
  }
  cancel(): boolean { const sent = this.interaction.cancel(getTime()); this.render(0); return sent; }
  cancelDrag(): void { this.directSource = null; this.dragPlanes.clear(); this.interaction.cancelDrag(); this.render(0); }
  cancelSource(sourceId: string): void {
    if (this.directSource === sourceId) this.cancelDrag();
    this.clearAim(sourceId);
  }
  tick(deltaS: number): void {
    this.floor.advance(deltaS); this.deps.robotPresenter.setFloorHeight?.(this.floor.heightCm);
    this.interaction.tick(getTime(), Math.max(0, Math.min(deltaS, 0.1)));
    if (this.meshTracking && getTime() - this.lastMeshUseAt >= 1) this.setMeshTracking(false);
    this.render(deltaS);
  }
  applyView(view: ARModuleSessionState, origin: ClientTrackingOrigin | null): void {
    const floor = this.deps.robotPresenter.rawFloorPose?.() ?? this.deps.robotPresenter.floorPose();
    const height = floor?.position.y ?? this.deps.robotPresenter.floorWorldY?.() ?? null;
    if (origin !== this.dragPlaneOrigin || view.connection !== "ready" || !view.hasTrackingOrigin) {
      this.dragPlanes.clear();
      this.floor.reset(height);
      this.surveyRemaining = origin && view.connection === "ready" ? 5 : 0;
      this.surveyNextAt = getTime(); this.surveyDeadline = getTime() + 3; this.surveyIndex = 0;
    }
    if (this.floor.heightCm === null && height !== null) {
      this.floor.reset(height); this.surveyRemaining = 5; this.surveyNextAt = getTime(); this.surveyDeadline = getTime() + 3;
    }
    this.dragPlaneOrigin = origin;
    this.deps.robotPresenter.setFloorHeight?.(this.floor.heightCm);
    if (floor && this.floor.heightCm !== null) floor.position.y = this.floor.heightCm;
    this.interaction.applyView(view, origin, floor ? specsNavigationPoseInTracking(floor.position, floor.rotation) : null, getTime());
  }
  hide(): void { this.directSource = null; this.dragPlanes.clear(); this.interaction.reset(); this.setMeshTracking(false); this.render(0); }
  dispose(): void {
    this.dragPlanes.clear();
    this.setMeshTracking(false);
    this.interaction.dispose(); this.marker?.destroy(); this.draftMarker?.destroy();
    for (const probe of this.probes.values()) probe.destroy(); this.probes.clear();
  }
  ownsMarkerTarget(object: SceneObject): boolean {
    return this.marker?.ownsDragTarget(object) === true || this.draftMarker?.ownsDragTarget(object) === true;
  }

  ownsPriorityTarget(object: SceneObject): boolean {
    return this.marker?.ownsInteractionTarget(object) === true || this.draftMarker?.ownsInteractionTarget(object) === true;
  }

  aim(sourceId: string, from: vec3, direction: vec3): void {
    const state = this.interaction.snapshot();
    if (!this.inputEnabled || !state.selected || !state.visible) { this.clearAim(sourceId); return; }
    this.interaction.aim(getTime(), this.place(sourceId, from, direction, true), sourceId);
  }
  clearAim(sourceId: string): void { this.interaction.clearAim(sourceId); this.dragPlanes.delete(sourceId); }
  hold(sourceId: string, from: vec3, direction: vec3, fromMarker: boolean): void {
    if (!this.inputEnabled || !this.isArmed()) return;
    const selected = this.interaction.snapshot().selected;
    if (fromMarker || !selected) {
      if (!fromMarker || this.directSource !== null && this.directSource !== sourceId) return;
      this.directSource = sourceId;
    }
    const placement = this.place(sourceId, from, direction, !fromMarker);
    if (!placement && (this.directSource === sourceId || this.interaction.ownsDraft(sourceId))) return;
    this.interaction.hold(getTime(), placement, fromMarker, sourceId);
  }
  release(sourceId: string, from: vec3, direction: vec3): void {
    if (!this.inputEnabled || this.directSource !== null && this.directSource !== sourceId) return;
    const selected = this.interaction.snapshot().selected;
    if (!selected && this.directSource !== sourceId) return;
    const displayed = this.directSource === sourceId ? this.dragPlanes.get(sourceId)?.filter.position() : null;
    const placement = displayed ? { position: specsToClientTrackingPoint([displayed.x, displayed.y, displayed.z]), blocked: false } :
      this.place(sourceId, from, direction, this.directSource === null && selected);
    this.interaction.release(getTime(), placement, sourceId);
    this.dragPlanes.delete(sourceId);
    this.directSource = null;
  }

  private place(sourceId: string, from: vec3, direction: vec3, floorAim: boolean): Placement {
    const length = direction.length;
    if (![from.x, from.y, from.z, direction.x, direction.y, direction.z, length].every(Number.isFinite) || length < 0.001) return null;
    const to = from.add(direction.uniformScale((floorAim ? 500 : 2000) / length));
    this.lastMeshUseAt = getTime(); this.setMeshTracking(true);
    const raw = this.deps.deviceTracking.raycastWorldMesh(from, to).filter(hit => !this.deps.robotPresenter.containsBodyPoint?.(hit.position));
    if (!floorAim) {
      const time = getTime();
      let drag = this.dragPlanes.get(sourceId);
      if (!drag) {
        const pose = this.currentPose();
        if (!pose) return null;
        drag = { plane: new DragPlacementPlane(pose.position), filter: new SpecsDragPosition(pose.position), offset: null, time };
        this.dragPlanes.set(sourceId, drag);
      }
      const placed = drag.plane.solve(from, direction, raw, time - drag.time, this.floor.heightCm ?? drag.filter.position().y, this.deps.cameraObject.getTransform().getWorldPosition());
      if (placed && placed.distance(from) <= 2000 && drag.offset === null) {
        const initial = drag.filter.position();
        drag.offset = new vec3(initial.x - placed.x, 0, initial.z - placed.z);
      }
      const target = placed && drag.offset ? placed.add(drag.offset) : null;
      const p = target && target.distance(from) <= 2000 ? drag.filter.update(target, time - drag.time) : null;
      drag.time = time;
      return p && [p.x, p.y, p.z].every(Number.isFinite) && p.distance(from) <= 2000 ? { position: specsToClientTrackingPoint([p.x, p.y, p.z]), blocked: false } : null;
    }
    const floorY = this.floor.heightCm ?? this.deps.robotPresenter.floorWorldY();
    if (floorY === null) return null;
    const first = raw[0];
    if (direction.y >= -0.0001 || first && (first.position.distance(from) > 500 || first.position.sub(from).dot(direction) <= 0 ||
      first.normal.length < 0.0001 || first.normal.y / first.normal.length < Math.cos(Math.PI / 9) ||
      Math.abs(first.position.y - floorY) > 18)) return null;
    const t = (floorY - from.y) / direction.y;
    const p = from.add(direction.uniformScale(t));
    if (t < 0 || p.distance(from) > 500) return null;
    return { position: specsToClientTrackingPoint([p.x, p.y, p.z]), blocked: false };
  }

  /** Five bounded floor samples after localization; no always-on room scanning. */
  surveyFloor(): void {
    const now = getTime();
    if (now > this.surveyDeadline) { this.surveyRemaining = 0; return; }
    if (!this.isArmed() || this.surveyRemaining <= 0 || now < this.surveyNextAt || this.floor.heightCm === null) return;
    if (!this.meshTracking) { this.lastMeshUseAt = now; this.setMeshTracking(true); this.surveyNextAt = now + 0.3; return; }
    const robot = this.deps.robotPresenter.worldPosition();
    if (!robot) return;
    const radius = (this.deps.robotPresenter.deadzoneRadiusCm() ?? 50) + 15;
    const angle = (this.surveyIndex++ % 5) * Math.PI * 2 / 5;
    const from = new vec3(robot.x + Math.cos(angle) * radius, this.floor.heightCm + 30, robot.z + Math.sin(angle) * radius);
    this.lastMeshUseAt = now; this.setMeshTracking(true);
    const hit = this.deps.deviceTracking.raycastWorldMesh(from, from.add(new vec3(0, -60, 0)))[0];
    if ((!hit || !this.deps.robotPresenter.containsBodyPoint?.(hit.position)) && this.floor.observe(hit, now)) this.surveyRemaining--;
    this.deps.robotPresenter.setFloorHeight?.(this.floor.heightCm);
    this.surveyNextAt = now + 0.1;
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
    if (!state.visible || state.attachedToRobot && this.floor.heightCm === null) {
      this.marker?.hide(); this.draftMarker?.hide();
      for (const probe of this.probes.values()) probe.hide(); return;
    }
    if (!this.marker) this.marker = this.createMarker("NavigationTargetMarker");
    // Execution feedback may arrive between streamed drag goals. Keep the
    // captured SIK target enabled and render the local pose until release.
    const frame = deriveNavigationPresentation(state);
    const pose = trackingToSpecs(frame.mainPose);
    this.marker.setPose(pose.position, pose.rotation);
    if (frame.mainVisible) this.marker.show(); else this.marker.hide();
    this.marker.setDragEnabled(this.inputEnabled && !frame.flash && !frame.blocked);
    this.marker.setCancelVisible(frame.cancelVisible, true, frame.confirmationId);
    this.marker.applyWorldStyle({ selected: frame.selected, blocked: frame.blocked, hovered: this.hovered,
      dragging: frame.dragging, following: frame.following, aiming: false, cancelVisible: frame.cancelVisible,
      flash: frame.flash, feedbackProgress: frame.feedbackProgress }, deltaS, this.viewportHeight);
    this.marker.orientViewer(this.deps.cameraObject.getTransform().getWorldPosition());
    const opacity = this.marker.circleOpacity();
    if (frame.draftVisible && frame.draftPose) {
      if (!this.draftMarker) this.draftMarker = this.createMarker("NavigationDraftMarker");
      const draft = trackingToSpecs(frame.draftPose);
      this.draftMarker.setPose(draft.position, draft.rotation); this.draftMarker.show();
      this.draftMarker.setDragEnabled(false); this.draftMarker.setCancelVisible(false);
      this.draftMarker.applyWorldStyle({ selected: true, dragging: frame.draftHeld, following: false,
        aiming: true, blocked: state.blocked, flash: null, feedbackProgress: 0, opacity }, deltaS, this.viewportHeight);
    } else this.draftMarker?.hide();
    const ids = new Set(frame.probes.map(p => p.sourceId));
    for (const [id, probe] of this.probes) if (!ids.has(id)) { probe.destroy(); this.probes.delete(id); }
    for (const probe of frame.probes) {
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
function trackingToSpecs(pose: { position: Readonly<Vec3>; orientation: Readonly<import("DimOSARClient.lspkg/Scripts/DimOSARClient/ClientContracts").Quat> }) {
  const yaw = 2 * Math.atan2(pose.orientation[2], pose.orientation[3]);
  return specsYawPoseToWorld(clientTrackingToSpecsYawPose([...pose.position, yaw]));
}

export function specsNavigationPoseInTracking(position: vec3, rotation: quat) {
  const forward = rotation.multiplyVec3(new vec3(1, 0, 0));
  const p = specsToClientTrackingYawPose([position.x, position.y, position.z, Math.atan2(-forward.z, forward.x)]);
  return { position: [p[0], p[1], p[2]] as Vec3, orientation: [0, 0, Math.sin(p[3] / 2), Math.cos(p[3] / 2)] as import("DimOSARClient.lspkg/Scripts/DimOSARClient/ClientContracts").Quat };
}
function specsYawPoseToWorld(pose: YawPose): { position: vec3; rotation: quat } {
  return { position: new vec3(pose[0], pose[1], pose[2]), rotation: new quat(Math.cos(pose[3] / 2), 0, Math.sin(pose[3] / 2), 0) };
}

export type MeshHit = { position: vec3; normal: vec3 };

/** A gesture-local drag plane. Scan noise never drives ordinary planar motion. */
export class DragPlacementPlane {
  private height: number;
  private targetHeight: number;
  constructor(position: vec3) { this.height = this.targetHeight = position.y; }
  solve(from: vec3, direction: vec3, hits: MeshHit[], deltaS: number,
    floorY = this.height, viewer = from): vec3 | null {
    const intersect = () => {
      if (Math.abs(direction.y) < 0.0001) return null;
      const t = (this.height - from.y) / direction.y;
      return t >= 0 ? from.add(direction.uniformScale(t)) : null;
    };
    const planar = intersect();
    if (!planar) return null;
    const hit = hits[0];
    if (hit && [hit.position.x, hit.position.y, hit.position.z, hit.normal.x, hit.normal.y, hit.normal.z].every(Number.isFinite) &&
      hit.normal.length > 0.0001 && hit.normal.y / hit.normal.length >= Math.cos(Math.PI / 9) && hit.position.sub(from).dot(direction) > 0) {
      if (Math.abs(hit.position.y - this.targetHeight) > 10) this.targetHeight = hit.position.y;
    }
    const far = planar.distance(viewer) > 250;
    if (far) this.targetHeight = Math.max(floorY, this.targetHeight);
    this.height += (this.targetHeight - this.height) * (1 - Math.exp(-Math.max(0, Math.min(deltaS, 0.1)) / 0.1));
    if (far) this.height = Math.max(floorY, this.height);
    return intersect();
  }
}

/** Stable room floor: a short, spatially sampled consensus, never a raw hit. */
export class SpecsFloorReference {
  heightCm: number | null = null;
  private samples: { height: number; at: number }[] = [];
  private targetHeight: number | null = null;
  reset(height: number | null): void { this.heightCm = this.targetHeight = height; this.samples = []; }
  advance(dt: number): void {
    if (this.heightCm === null || this.targetHeight === null) return;
    this.heightCm += (this.targetHeight - this.heightCm) * (1 - Math.exp(-Math.max(0, Math.min(dt, 0.1)) / 0.1));
    if (Math.abs(this.heightCm - this.targetHeight) < 0.01) this.heightCm = this.targetHeight;
  }
  observe(hit: MeshHit | undefined, now: number): boolean {
    if (!hit || this.heightCm === null || ![hit.position.x, hit.position.y, hit.position.z, hit.normal.x, hit.normal.y, hit.normal.z].every(Number.isFinite) ||
      !(hit.normal.length > 0.0001 && hit.normal.y / hit.normal.length >= Math.cos(Math.PI / 9)) ||
      Math.abs(hit.position.y - this.heightCm) > 18) return false;
    if (this.samples.length && now - this.samples[this.samples.length - 1].at < 0.07) return false;
    this.samples.push({ height: hit.position.y, at: now });
    if (this.samples.length > 5) this.samples.shift();
    if (this.samples.length < 5 || now - this.samples[0].at < 0.3) return true;
    const heights = this.samples.map(sample => sample.height).sort((a, b) => a - b);
    if (heights[3] - heights[1] <= 3) this.targetHeight = heights[2];
    return true;
  }
}

/** Smooth the complete placement before it is displayed AND streamed to the robot. */
export class SpecsDragPosition {
  private value: vec3;
  constructor(position: vec3) { this.value = new vec3(position.x, position.y, position.z); }
  update(target: vec3, dt: number): vec3 {
    const alpha = 1 - Math.exp(-Math.max(0, Math.min(dt, 0.1)) / 0.1);
    this.value = this.value.add(target.sub(this.value).uniformScale(alpha));
    return new vec3(this.value.x, this.value.y, this.value.z);
  }
  position(): vec3 { return new vec3(this.value.x, this.value.y, this.value.z); }
}

/** Hand targeting only needs navigation commands, not the controller's render/session internals. */
export interface NavigationInputPort {
  ownsMarkerTarget(object: SceneObject): boolean;
  isMarkerAttachedToRobot(): boolean;
  ownsDraft(sourceId: string): boolean;
  setHovered(hovered: boolean): void;
  clearAim(sourceId: string): void;
  cancelSource(sourceId: string): void;
  cancelDrag(): void;
  aim(sourceId: string, from: vec3, direction: vec3): void;
  hold(sourceId: string, from: vec3, direction: vec3, fromMarker: boolean): void;
  release(sourceId: string, from: vec3, direction: vec3): void;
}

type NavigationHand = Pick<Interactor, "inputType" | "startPoint" | "direction" | "isActive" | "currentInteractable" | "isTriggering">;

/** SIK owns targeting. This adapter captures each accepted navigation gesture until release. */
export class SpecsNavigationInput {
  private readonly gestures = new Map<string, { held: boolean; accepted: boolean; fromMarker: boolean; fromRobot: boolean }>();
  private readonly cancelledUntilRelease = new Set<string>();
  constructor(private readonly navigation: NavigationInputPort, private readonly robot?: {
    ownsTarget(object: SceneObject): boolean; setHovered(value: boolean): void;
  }, private readonly readInteractors?: () => readonly NavigationHand[]) {}

  tick(navigationEnabled = true, robotEnabled = true): void {
    const manager = InteractionManager.getInstance();
    const mask = InteractorInputType.BothHands | (global.deviceInfoSystem.isEditor() ? InteractorInputType.Mouse : 0);
    const seen = new Set<string>();
    let robotHovered = false;
    let markerHovered = false;
    for (const hand of this.readInteractors?.() ?? manager.getInteractorsByType(mask)) {
      const id = String(hand.inputType); seen.add(id);
      const previous = this.gestures.get(id) ?? { held: false, accepted: false, fromMarker: false, fromRobot: false };
      const from = hand.startPoint, direction = hand.direction;
      if (!hand.isActive() || !from || !direction) {
        this.navigation.clearAim(id);
        if (previous.held) this.cancelledUntilRelease.add(id);
        if (previous.accepted) this.navigation.cancelSource(id);
        this.gestures.delete(id); continue;
      }
      const target = hand.currentInteractable?.getSceneObject();
      const fromMarker = target ? navigationEnabled && this.navigation.ownsMarkerTarget(target) : false;
      const fromRobot = Boolean(target && robotEnabled && this.robot?.ownsTarget(target));
      const held = hand.isTriggering;
      if (!held) this.cancelledUntilRelease.delete(id);
      const hoverEligible = !this.cancelledUntilRelease.has(id);
      markerHovered ||= hoverEligible && fromMarker;
      // A robot press belongs to selection, not navigation. Preserve its hover
      // through the press so deselection does not collapse and reopen the box.
      robotHovered ||= (hoverEligible || previous.fromRobot) && fromRobot && !this.navigation.ownsDraft(id);
      if (!navigationEnabled) {
        this.navigation.clearAim(id);
        if (previous.accepted) this.navigation.cancelSource(id);
        if (held) this.cancelledUntilRelease.add(id);
        this.gestures.delete(id); continue;
      }
      // A captured marker drag or the owner's draft may cross the robot collider.
      // Other targets (including UI and walls) still consume the gesture.
      const ownedRobot = fromRobot && (this.navigation.ownsDraft(id) || previous.accepted && previous.fromMarker);
      const unobstructed = !target || fromMarker || ownedRobot === true;
      let accepted = held && !previous.held ? unobstructed : previous.accepted;
      if (!unobstructed || this.cancelledUntilRelease.has(id)) {
        if (previous.accepted) this.navigation.cancelSource(id);
        this.navigation.clearAim(id);
        if (held) this.cancelledUntilRelease.add(id);
        accepted = false;
      }
      // Release the captured gesture before returning to idle aim. Unselected
      // idle aim clears navigation state, including an unfinished direct drag.
      if (unobstructed && !held && !previous.accepted && !this.cancelledUntilRelease.has(id)) this.navigation.aim(id, from, direction);
      else if (!held && !previous.accepted) this.navigation.clearAim(id);
      if (held && accepted) this.navigation.hold(id, from, direction, previous.held ? previous.fromMarker : fromMarker);
      if (!held && previous.held && previous.accepted) this.navigation.release(id, from, direction);
      this.gestures.set(id, { held, accepted: held && accepted, fromMarker: previous.held ? previous.fromMarker : fromMarker,
        fromRobot: previous.held ? previous.fromRobot : held && fromRobot && hoverEligible });
    }
    const linked = navigationEnabled && robotEnabled && this.navigation.isMarkerAttachedToRobot();
    const hover = worldMarkerHover(linked, robotHovered, markerHovered);
    this.robot?.setHovered(hover.robot); this.navigation.setHovered(hover.marker);
    for (const [id, gesture] of this.gestures) if (!seen.has(id)) {
      this.navigation.clearAim(id);
      if (gesture.accepted) this.navigation.cancelSource(id);
      if (gesture.held) this.cancelledUntilRelease.add(id);
      this.gestures.delete(id);
    }
  }

  reset(): void { this.gestures.clear(); this.cancelledUntilRelease.clear(); this.navigation.cancelDrag(); this.navigation.setHovered(false); this.robot?.setHovered(false); }
}
