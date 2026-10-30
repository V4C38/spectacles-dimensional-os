import { ManipulationInputCapture } from "../../DimOSARClient/manipulation/ManipulationInputCapture";
import TargetProvider, { type InteractableHitInfo } from "SpectaclesInteractionKit.lspkg/Providers/TargetProvider/TargetProvider";
import { SpecsNavigationTargetPriority } from "../navigation/SpecsNavigationTargetPriority";
import { ManipulationController } from "../../DimOSARClient/manipulation/ManipulationController";
import { ManipulationGesture } from "../../DimOSARClient/manipulation/ManipulationGesture";
import { clientTrackingToOdomPose, odomToClientTrackingPose } from "../../DimOSARClient/localization/clientTrackingTransforms";
import type { ClientTrackingOrigin } from "../../DimOSARClient/localization/clientTrackingOrigin";
import type { ARModuleSession } from "../../DimOSARClient/websocket/arModuleSession";
import type { ManipulationPose } from "../../DimOSARClient/manipulation/ManipulationTypes";
import { ManipulationRenderer } from "./ManipulationRenderer";
import { SpecsManipulationInput } from "./SpecsManipulationInput";

export class SpecsManipulationController {
  readonly core: ManipulationController;
  readonly renderer: ManipulationRenderer;
  readonly input: SpecsManipulationInput;
  private readonly gesture = new ManipulationGesture();
  private lastOrigin: ClientTrackingOrigin | null = null;
  private selected = false;
  private readonly targetPriority: SpecsNavigationTargetPriority<InteractableHitInfo>;
  constructor(private readonly session: ARModuleSession,
    private readonly origin: () => ClientTrackingOrigin | null, parent: SceneObject,
    private readonly camera: SceneObject, select: () => void, stop: () => void) {
    this.core = new ManipulationController(session, () => getTime(), stop);
    const capture = new ManipulationInputCapture();
    this.renderer = new ManipulationRenderer(parent, this.core, select, stop, capture);
    this.input = new SpecsManipulationInput(this, capture);
    this.targetPriority = new SpecsNavigationTargetPriority(TargetProvider,
      object => this.renderer.ownsBounds(object), object => this.renderer.ownsHandle(object));
  }
  setSelected(selected: boolean): void {
    if (selected !== this.selected) this.end();
    this.selected = selected; this.core.setSelected(selected);
  }
  ownsHandle(object: SceneObject): boolean { return this.renderer.ownsHandle(object); }
  begin(pose: ManipulationPose): boolean {
    const origin = this.origin(), interaction = this.core.interaction;
    const observed = this.session.view().manipulation?.observations?.[interaction.groupId ?? ""]?.pose;
    if (!origin || !observed || !interaction.begin()) return false;
    this.gesture.begin(pose, odomToClientTrackingPose(this.selected ? interaction.target ?? observed : observed, origin), getTime());
    return true;
  }
  hold(pose: ManipulationPose): void {
    const origin = this.origin(); if (!origin) { this.end(); return; }
    const target = this.gesture.hold(pose, getTime());
    if (target) this.core.interaction.aim(clientTrackingToOdomPose(target, origin));
  }
  end(): void { this.gesture.end(); this.core.interaction.end(); }
  suspend(): void { this.input.reset(); this.core.suspend(); }
  tick(enabled: boolean): void {
    const origin = this.origin();
    if (!enabled || origin !== this.lastOrigin) this.suspend();
    this.lastOrigin = origin;
    const active = enabled && !!origin && this.core.interaction.available;
    this.core.tick(active);
    this.input.tick(active);
    this.renderer.apply(this.session.view().manipulation, origin, this.selected, active, getTime(), this.camera,
      this.session.view().hello?.robot.display_name ?? "Arm");
  }
  dispose(): void { this.suspend(); this.core.dispose(); this.targetPriority.dispose(); this.renderer.dispose(); }
}
