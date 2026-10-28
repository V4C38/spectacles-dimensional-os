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
    this.hold(position, orientation);
    return true;
  }
  hold(position: Vec3, orientation: Quat): void {
    const origin = this.origin();
    if (!origin || !this.offset) {
      this.end();
      return;
    }
    const transform = this.matrix(position, orientation).multiply(this.offset);
    const p = new THREE.Vector3(),
      q = new THREE.Quaternion();
    transform.decompose(p, q, new THREE.Vector3());
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
    this.offset = null;
    this.interaction.end();
  }
  action(action: string): void {
    switch (action) {
      case "plan":
        this.interaction.requestPlan();
        break;
      case "execute":
        this.interaction.execute();
        break;
      case "cancel":
        this.interaction.cancel();
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
          this.session.view().manipulation?.observations?.[
            this.interaction.groupId ?? ""
          ]?.gripper;
        if (value != null) this.interaction.setGripper(value < 0.5 ? 1 : 0);
        break;
      }
    }
  }
  tick(enabled: boolean): void {
    const origin = this.origin();
    if (!enabled || origin !== this.lastOrigin) this.end();
    this.lastOrigin = origin;
    this.interaction.tick();
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
