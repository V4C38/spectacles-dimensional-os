import * as THREE from "three";
import { ManipulationInteraction } from "@dimos-ar-client/manipulation/ManipulationInteraction";
import type { ARModuleSession } from "@dimos-ar-client/websocket/arModuleSession";
import type { ClientTrackingOrigin } from "@dimos-ar-client/localization/clientTrackingOrigin";
import { clientTrackingToOdomPose } from "@dimos-ar-client/localization/clientTrackingTransforms";
import { webxrToClientTrackingPose } from "../utilities/WebXRCoordinates";
import type { Quat, Vec3 } from "@dimos-ar-client/websocket/protocolTypes";
import { ManipulationRenderer } from "./ManipulationRenderer";

export class WebXRManipulationController {
  readonly interaction: ManipulationInteraction;
  readonly renderer = new ManipulationRenderer();
  readonly object = this.renderer.object;
  private offset: THREE.Matrix4 | null = null;
  private lastOrigin: ClientTrackingOrigin | null = null;
  private selected = false;
  private enabledBefore = false;
  private panelOffset: THREE.Matrix4 | null = null;
  private smoothedPosition = new THREE.Vector3();
  private smoothedRotation = new THREE.Quaternion();
  private lastHold = 0;
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
    this.interaction = new ManipulationInteraction(session, now);
  }
  setSelected(selected: boolean): void {
    if (this.selected !== selected) this.end();
    this.selected = selected;
    this.interaction.setSelected(selected);
  }
  owns(target: THREE.Object3D): boolean {
    return this.renderer.owns(target);
  }
  begin(position: Vec3, orientation: Quat): boolean {
    if (!this.origin() || !this.interaction.begin()) return false;
    this.renderer.handle.object.updateWorldMatrix(true, false);
    this.offset = this.matrix(position, orientation)
      .invert()
      .multiply(this.renderer.handle.object.matrixWorld);
    this.renderer.handle.object.matrixWorld.decompose(
      this.smoothedPosition,
      this.smoothedRotation,
      new THREE.Vector3(),
    );
    this.lastHold = this.now();
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
    if (!origin || !this.offset) {
      this.end();
      return;
    }
    const transform = this.matrix(position, orientation).multiply(this.offset);
    const p = new THREE.Vector3(),
      q = new THREE.Quaternion();
    transform.decompose(p, q, new THREE.Vector3());
    const time = this.now();
    const alpha =
      1 - Math.exp(-14 * Math.max(0, Math.min(0.1, time - this.lastHold)));
    this.lastHold = time;
    this.smoothedPosition.lerp(p, alpha);
    this.smoothedRotation.slerp(q, alpha);
    p.copy(this.smoothedPosition);
    q.copy(this.smoothedRotation);
    this.interaction.aim(
      clientTrackingToOdomPose(
        webxrToClientTrackingPose({
          position: p.toArray() as Vec3,
          orientation: q.toArray() as Quat,
        }),
        origin,
      ),
    );
  }
  end(): void {
    this.panelOffset = null;
    this.offset = null;
    this.interaction.end();
  }
  interrupt(): void {
    const intent = this.interaction.snapshot();
    if (
      this.interaction.target ||
      intent.dragging ||
      intent.planning ||
      intent.resetting
    )
      this.interaction.cancel();
    this.end();
    this.renderer.previewRequested = false;
  }
  action(action: string): void {
    switch (action) {
      case "reset":
        this.renderer.previewRequested = false;
        this.interaction.resetJoints();
        break;
      case "estop":
        this.interaction.discard();
        this.renderer.previewRequested = false;
        this.session.sendText(JSON.stringify({ type: "estop_request" }) + "\n");
        break;
      case "plan":
        if (!this.interaction.snapshot().canPreview) break;
        this.renderer.previewRequested = !this.renderer.previewRequested;
        if (this.renderer.previewRequested && !this.interaction.plan)
          this.interaction.requestPlan();
        break;
      case "execute":
        this.renderer.previewRequested = false;
        this.interaction.execute();
        break;
      case "cancel":
      case "stop":
        this.renderer.previewRequested = false;
        this.interaction.cancel();
        this.offset = null;
        break;
      case "resume":
        this.interaction.resume();
        break;
      case "group": {
        const groups = this.session.view().manipulation?.groups ?? [];
        const index = groups.findIndex(
          (g) => g.id === this.interaction.groupId,
        );
        if (groups.length)
          this.interaction.selectGroup(groups[(index + 1) % groups.length].id);
        break;
      }
      case "gripper": {
        const value =
          this.selected && this.interaction.desiredGripper != null
            ? this.interaction.desiredGripper
            : this.session.view().manipulation?.observations?.[
                this.interaction.groupId ?? ""
              ]?.gripper;
        if (value != null) this.interaction.setGripper(value < 0.5 ? 1 : 0);
        break;
      }
    }
  }
  tick(enabled: boolean): void {
    const origin = this.origin();
    if (
      (!enabled && this.enabledBefore) ||
      (this.lastOrigin !== null && origin !== this.lastOrigin)
    )
      this.interrupt();
    this.enabledBefore = enabled;
    this.lastOrigin = origin;
    this.interaction.tick();
    const intent = this.interaction.snapshot();
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
      this.interaction.plan ?? this.interaction.previewPlan,
      this.now(),
      this.interaction.status,
      this.interaction.feedbackFresh,
      this.session.view().hello?.robot.display_name,
      intent,
    );
  }
  dispose(): void {
    this.end();
    this.interaction.dispose();
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
