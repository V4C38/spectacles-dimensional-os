import { sameTrackingReference } from "DimOSARClient.lspkg/Scripts/DimOSARClient/localization/clientTrackingOrigin";
import type { ClientTrackingOrigin } from "DimOSARClient.lspkg/Scripts/DimOSARClient/localization/clientTrackingOrigin";
import { clientTrackingToOdomPose } from "DimOSARClient.lspkg/Scripts/DimOSARClient/localization/clientTrackingTransforms";
import { ManipulationController } from "DimOSARClient.lspkg/Scripts/DimOSARClient/manipulation/ManipulationController";
import { ManipulationGesture } from "DimOSARClient.lspkg/Scripts/DimOSARClient/manipulation/ManipulationGesture";
import { ManipulationInputCapture } from "DimOSARClient.lspkg/Scripts/DimOSARClient/manipulation/ManipulationInputCapture";
import type { ManipulationPose } from "DimOSARClient.lspkg/Scripts/DimOSARClient/manipulation/ManipulationTypes";
import type { ARModuleSession } from "DimOSARClient.lspkg/Scripts/DimOSARClient/websocket/arModuleSession";
import { specsToClientTrackingPose } from "../utilities/SpecsCoordinates";
import { ManipulationRenderer } from "./ManipulationRenderer";
import { SpecsManipulationInput } from "./SpecsManipulationInput";

export class SpecsManipulationController {
  readonly core: ManipulationController;
  readonly renderer: ManipulationRenderer;
  readonly input: SpecsManipulationInput;
  private readonly gesture = new ManipulationGesture();
  private lastOrigin: ClientTrackingOrigin | null = null;
  private selected = false;
  constructor(private readonly session: ARModuleSession,
    private readonly origin: () => ClientTrackingOrigin | null, parent: SceneObject,
    private readonly camera: SceneObject, private readonly select: () => void, stop: () => void, recalibrate: () => void = () => {}) {
    this.core = new ManipulationController(session, () => getTime(), stop);
    const capture = new ManipulationInputCapture();
    this.renderer = new ManipulationRenderer(parent, this.core, capture, recalibrate);
    this.input = new SpecsManipulationInput(this, capture);
  }
  setSelected(selected: boolean): void {
    if (selected !== this.selected) this.interrupt();
    this.selected = selected; this.core.setSelected(selected);
  }
  pressTarget(object: SceneObject, sourceId: string): boolean {
    if (this.renderer.pressEndEffectorAction(object, sourceId)) return true;
    if (!this.renderer.ownsMesh(object)) return false;
    this.select(); return true;
  }
  ownsHandle(object: SceneObject): boolean { return this.renderer.ownsHandle(object); }
  begin(pose: ManipulationPose): boolean {
    const origin = this.origin(), interaction = this.core.interaction;
    const observed = this.session.view().manipulation?.observations?.[interaction.groupId ?? ""]?.pose;
    if (!origin || !observed || !interaction.begin()) return false;
    const transform = this.renderer.handle.getTransform(), p = transform.getWorldPosition(), q = transform.getWorldRotation();
    this.gesture.begin(pose, specsToClientTrackingPose({ position: [p.x, p.y, p.z], orientation: [q.x, q.y, q.z, q.w] }), getTime());
    return true;
  }
  hold(pose: ManipulationPose): void {
    const origin = this.origin() ?? (this.core.interaction.retainingFeedback ? this.lastOrigin : null); if (!origin) { this.end(); return; }
    const target = this.gesture.hold(pose, getTime());
    if (target) this.core.interaction.aim(clientTrackingToOdomPose(target, origin));
  }
  end(): void { this.gesture.end(); this.core.interaction.end(); }
  interrupt(): void { this.gesture.end(); this.core.interaction.interrupt(); }
  suspend(): void { this.input.reset(); this.core.suspend(); }
  tick(enabled: boolean): void {
    const view = this.session.view();
    const supported = view.capabilities?.manipulation?.available === true ||
      view.connection !== "ready" && view.capabilities === null && this.core.interaction.retainingFeedback;
    const retained = supported && this.core.interaction.retainingFeedback;
    const origin = this.origin() ?? (retained ? this.lastOrigin : null);
    if (!supported || (!enabled && !retained) || !sameTrackingReference(origin, this.lastOrigin)) this.suspend();
    if (origin && this.lastOrigin && origin !== this.lastOrigin && sameTrackingReference(origin, this.lastOrigin)) this.gesture.rebase(this.lastOrigin, origin);
    this.lastOrigin = origin;
    const active = supported && (enabled || retained) && !!origin && this.core.interaction.available;
    this.core.tick(active);
    if (!this.core.interaction.dragging && this.input.capture.owner !== null) this.input.reset();
    this.input.tick(active);
    this.renderer.localizationAvailable = this.session.view().capabilities?.localization.available === true;
    this.renderer.apply(this.session.view().manipulation, supported ? origin : null, this.selected, active, getTime(), this.camera,
      this.session.view().hello?.robot.display_name ?? "Arm");
    this.input.updateCursor();
  }
  dispose(): void { this.suspend(); this.core.dispose(); this.renderer.dispose(); }
}
