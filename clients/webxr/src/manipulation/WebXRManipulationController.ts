import * as THREE from "three";
import { ManipulationGesture } from "@dimos-ar-client/manipulation/ManipulationGesture";
import { ManipulationController, type ManipulationControlAction } from "@dimos-ar-client/manipulation/ManipulationController";
import { ManipulationInteraction } from "@dimos-ar-client/manipulation/ManipulationInteraction";
import type { ARModuleSession } from "@dimos-ar-client/websocket/arModuleSession";
import type { ClientTrackingOrigin } from "@dimos-ar-client/localization/clientTrackingOrigin";
import { clientTrackingToOdomPose } from "@dimos-ar-client/localization/clientTrackingTransforms";
import { webxrToClientTrackingPose } from "../utilities/WebXRCoordinates";
import type { Quat, Vec3 } from "@dimos-ar-client/websocket/protocolTypes";
import { ManipulationRenderer } from "./ManipulationRenderer";

export class WebXRManipulationController {
  readonly interaction: ManipulationInteraction;
  readonly core: ManipulationController;
  readonly renderer: ManipulationRenderer;
  readonly object: THREE.Group;
  private readonly gesture = new ManipulationGesture();
  private lastOrigin: ClientTrackingOrigin | null = null;
  private selected = false;
  private panelOffset: THREE.Matrix4 | null = null;
  beginPanel(position: Vec3, orientation: Quat): void {
    this.renderer.pinned = true;
    this.renderer.panel.updateWorldMatrix(true, false);
    this.panelOffset = this.matrix(position, orientation)
      .invert()
      .multiply(this.renderer.panel.matrixWorld);
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
    if (this.selected !== selected) this.end();
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
  hold(position: Vec3, orientation: Quat): void {
    if (this.panelOffset) {
      const m = this.matrix(position, orientation).multiply(this.panelOffset);
      m.decompose(
        this.renderer.panel.position,
        this.renderer.panel.quaternion,
        new THREE.Vector3(),
      );
      return;
    }
    const origin = this.origin();
    if (!origin) { this.end(); return; }
    const pose = this.gesture.hold(webxrToClientTrackingPose({ position, orientation }), this.now());
    if (pose) this.interaction.aim(clientTrackingToOdomPose(pose, origin));
  }

  end(): void {
    this.panelOffset = null;
    this.gesture.end();
    this.interaction.end();
  }
  suspend(): void { this.end(); this.core.suspend(); }
  action(action: ManipulationControlAction): void {
    this.core.action(action);
    this.renderer.previewRequested = this.core.presentation.previewRequested;
  }
  tick(enabled: boolean): void {
    const origin = this.origin();
    if (!enabled || origin !== this.lastOrigin) { this.end(); this.core.suspend(); }
    this.lastOrigin = origin;
    this.core.tick(enabled && !!origin && this.interaction.available);
    this.renderer.working =
      this.interaction.busy ||
      ["accepted", "executing"].includes(
        this.session.view().manipulation?.execution ?? "",
      );
    this.renderer.rejection = this.interaction.rejection;
    this.renderer.desiredGripper = this.interaction.desiredGripper;
    this.renderer.speedScale = this.interaction.speedScale;
    this.renderer.apply(
      this.session.view().manipulation,
      enabled ? origin : null,
      this.interaction.groupId,
      this.selected,
      this.interaction.target,
      this.interaction.solution,
      this.interaction.plan,
      this.now(),
      this.interaction.status,
      this.interaction.feedbackFresh,
      this.session.view().hello?.robot.display_name,
    );
  }
  dispose(): void {
    this.end();
    this.core.dispose();
    this.renderer.dispose();
  }
  private matrix(position: Vec3, orientation: Quat): THREE.Matrix4 {
    return new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion(...orientation),
      new THREE.Vector3(1, 1, 1),
    );
  }
}
