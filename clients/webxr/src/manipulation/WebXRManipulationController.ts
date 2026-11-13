import { sameTrackingReference, type ClientTrackingOrigin, clientTrackingToOdomPose } from "@dimos-ar-client/localization/ClientTracking";
import { ARM_PANEL_STYLE } from "@dimos-ar-client/presentation/ControlPanelPresentation";
import { updatePanelGesture, type PanelGesture } from "../presentation/PanelInteraction";
import * as THREE from "three";
import { ManipulationGesture } from "@dimos-ar-client/manipulation/ManipulationInput";
import { ManipulationController, type ManipulationControlAction, ManipulationInteraction } from "@dimos-ar-client/manipulation/ManipulationController";

import type { ARModuleSession } from "@dimos-ar-client/websocket/ARModuleSession";


import { webxrToClientTrackingPose } from "../utilities/WebXRCoordinates";
import type { Quat, Vec3 } from "@dimos-ar-client/ClientContracts";
import { ManipulationRenderer } from "./ManipulationRenderer";

export class WebXRManipulationController {
  readonly interaction: ManipulationInteraction;
  readonly core: ManipulationController;
  readonly renderer: ManipulationRenderer;
  readonly object: THREE.Group;
  private readonly gesture = new ManipulationGesture();
  private lastOrigin: ClientTrackingOrigin | null = null;
  private selected = false;
  private lastPanelUpdate = 0;
  private panelGesture: PanelGesture | null = null;
  beginPanel(position: Vec3, orientation: Quat, zone: "bar" | "left" | "right" | "body" = "bar", ray?: {origin: Vec3; direction: Vec3}): void {
    this.lastPanelUpdate = this.now();
    this.renderer.detachPanel();
    const panel = this.renderer.panel;
    panel.updateWorldMatrix(true,true);
    const normal = new THREE.Vector3(0,0,1).applyQuaternion(panel.getWorldQuaternion(new THREE.Quaternion()));
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal,panel.getWorldPosition(new THREE.Vector3()));
    const origin = new THREE.Vector3(...(ray?.origin ?? position));
    const direction = ray ? new THREE.Vector3(...ray.direction) : new THREE.Vector3(0,0,-1).applyQuaternion(new THREE.Quaternion(...orientation));
    const start = new THREE.Ray(origin,direction).intersectPlane(plane,new THREE.Vector3());
    if (!start) return;
    const resize = zone === "left" || zone === "right";
    const anchor = panel.localToWorld(new THREE.Vector3(resize ? (zone === "left" ? .112 : -.112) : 0,0,0));
    this.panelGesture={plane,start,position:panel.position.clone(),anchor,span:start.clone().sub(anchor),scale:panel.scale.x,distance:start.distanceTo(origin),resize,rotation:panel.quaternion.clone(),controllerInverse:new THREE.Quaternion(...orientation).invert(),zone};
  }
  constructor(
    private readonly session: ARModuleSession,
    private readonly origin: () => ClientTrackingOrigin | null,
    private readonly now: () => number,
  ) {
    this.core = new ManipulationController(session, now);
    this.interaction = this.core.interaction;
    this.renderer = new ManipulationRenderer(this.core.presentation);
    this.object = this.renderer.object;
  }
  setSelected(selected: boolean): void {
    if (this.selected !== selected) { this.panelGesture = null; this.gesture.end(); }
    this.selected = selected;
    this.core.setSelected(selected);
  }
  owns(target: THREE.Object3D): boolean {
    return this.renderer.owns(target);
  }
  begin(position: Vec3, orientation: Quat): boolean {
    if (!this.origin() || !this.interaction.begin()) return false;
    this.renderer.handle.object.updateWorldMatrix(true, false);
    const handle = this.renderer.handle.object;
    this.gesture.begin(
      webxrToClientTrackingPose({ position, orientation }),
      webxrToClientTrackingPose({
        position: handle.getWorldPosition(new THREE.Vector3()).toArray() as Vec3,
        orientation: handle.getWorldQuaternion(new THREE.Quaternion()).toArray() as Quat,
      }), this.now(),
    );
    this.hold(position, orientation);
    return true;
  }
  hold(position: Vec3, orientation: Quat, ray?: {origin: Vec3; direction: Vec3}): void {
    if (this.panelGesture) {
      const direction = ray?.direction ?? new THREE.Vector3(0,0,-1).applyQuaternion(new THREE.Quaternion(...orientation)).toArray() as Vec3;
      updatePanelGesture(this.renderer.panel,this.panelGesture,ray?.origin ?? position,direction,new THREE.Quaternion(...orientation),Math.max(0, this.now() - this.lastPanelUpdate),ARM_PANEL_STYLE.minScale,ARM_PANEL_STYLE.maxScale,this.renderer.viewerPosition);
      this.lastPanelUpdate = this.now();
      return;
    }
    const origin = this.origin() ?? (this.interaction.retainingFeedback ? this.lastOrigin : null);
    if (!origin) { this.end(); return; }
    const pose = this.gesture.hold(webxrToClientTrackingPose({ position, orientation }), this.now());
    if (pose) this.interaction.aim(clientTrackingToOdomPose(pose, origin));
  }

  end(): void {
    this.panelGesture = null;
    this.gesture.end();
    this.interaction.end();
  }
  suspend(): void { this.end(); this.core.suspend(); }
  interrupt(): void { this.panelGesture = null; this.gesture.end(); this.core.suspend(); }
  action(action: ManipulationControlAction | "pin" | "recalibrate"): void {
    if (action === "recalibrate") { if (this.renderer.controlsView.buttons.get(action)?.enabled) this.renderer.controlsView.onRecalibrate?.(); return; }
    if (action === "pin") { this.panelGesture = null; this.renderer.resetPanel(); return; }
    this.core.action(action);
  }
  tick(enabled: boolean): void {
    const view = this.session.view();
    const supported = view.capabilities?.manipulation?.available === true ||
      view.connection !== "ready" && view.capabilities === null && this.interaction.retainingFeedback;
    const retained = supported && this.interaction.retainingFeedback;
    const origin = this.origin() ?? (retained ? this.lastOrigin : null);
    if (!supported || (!enabled && !retained) || !sameTrackingReference(origin, this.lastOrigin)) { this.end(); this.core.suspend(); }
    if (origin && this.lastOrigin && origin !== this.lastOrigin && sameTrackingReference(origin, this.lastOrigin)) this.gesture.rebase(this.lastOrigin, origin);
    this.lastOrigin = origin;
    this.core.tick(supported && enabled && !!origin && this.interaction.available);
    this.renderer.controlsView.localizationAvailable = this.session.view().capabilities?.localization.available === true;
    this.renderer.apply({
      state: this.session.view().manipulation,
      origin: supported && (enabled || retained) ? origin : null,
      groupId: this.interaction.groupId,
      selected: this.selected,
      target: this.interaction.target,
      solution: this.interaction.previewJoints,
      plan: this.interaction.plan,
      now: this.now(),
      robotTitle: this.session.view().hello?.robot.display_name ?? "Arm",
      intent: this.interaction.snapshot(),
      rejection: this.interaction.rejection,
      desiredGripper: this.interaction.desiredGripper,
      speedScale: this.interaction.speedScale,
    });
    const blocked = !supported || this.session.collaboration.snapshot("manipulation", this.interaction.groupId ?? undefined).blocked;
    this.renderer.handle.collider.userData.rayDisabled = blocked;
  }

  dispose(): void {
    this.end();
    this.core.dispose();
    this.renderer.dispose();
  }
}
