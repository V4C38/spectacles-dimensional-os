// Run with tools/review.py --harness Tests/integration-tests/BendyLaserProbe.ts.
// Hardware poses are fixtures; production SIK cursor, beam presenter and shader are unchanged.
import { DimOSSpecsClient } from "../Scripts/DimOSSpecsClient/DimOSSpecsClient";
import { createIconButton } from "../Scripts/DimOSSpecsClient/presentation/UIKit";
import { CursorControllerProvider } from "SpectaclesInteractionKit.lspkg/Providers/CursorControllerProvider/CursorControllerProvider";
import { TargetingMode } from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor";
import { IntegrationInput } from "./IntegrationInput";

@component
export class ReviewScenario extends BaseScriptComponent {
  @input startDelayS = 5;
  private elapsed = 0;
  private phase = -1;
  private root: any;
  private input: IntegrationInput | null = null;
  private button: ReturnType<typeof createIconButton> | null = null;
  private failed = false;
  private direct = false;
  private from = vec3.zero();
  private center = vec3.zero();
  private right = vec3.right();
  private maximumBend = 0;
  private presses = 0;
  private mesh: RenderMesh | null = null;

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.createEvent("UpdateEvent").bind(() => this.tick()));
    this.createEvent("OnDestroyEvent").bind(() => this.input?.restore());
  }
  private emit(value: Record<string, unknown>): void {
    print(`SPECS_REVIEW ${JSON.stringify({ ...value, unixMs: Date.now() })}`);
  }
  private check(name: string, passed: boolean): void {
    this.failed ||= !passed; this.emit({ type: "result", name, passed });
  }
  private scene(name: string, videoOnly = true): void { this.emit({ type: "scene", name, videoOnly }); }
  private beam(): any { return this.root.lasers.beams.get(this.input!.actor.inputType)?.visual; }
  private attached(): boolean {
    const beam = this.beam();
    const cursor = CursorControllerProvider.getInstance().getCursorByInteractor(this.input!.actor)!;
    if (!beam?.object.enabled || !cursor.cursorParameters.isShown) return false;
    const pass = beam.layers[1].pass;
    const endpoint = beam.object.getTransform().getWorldPosition().add(new vec3(pass.endX, pass.endY, pass.endZ));
    return endpoint.distance(cursor.cursorParameters.worldPosition) < 0.02;
  }
  private prepare(): void {
    const find = (object: SceneObject): any => {
      const root = object.getComponent(DimOSSpecsClient.getTypeName());
      if (root) return root;
      for (let i = 0; i < object.getChildrenCount(); i++) { const root = find(object.getChild(i)); if (root) return root; }
      return null;
    };
    for (let i = 0; i < global.scene.getRootObjectsCount(); i++) {
      this.root = find(global.scene.getRootObject(i)); if (this.root) break;
    }
    if (!this.root) throw new Error("Production composition root missing");
    this.root.uiPresenter.setupWizardController.invalidatePending();
    this.root.updateEvent.enabled = false;
    this.root.uiPresenter.setupWizardPanel.enabled = false;
    this.root.uiPresenter.mainUIFrame.enabled = false;
    const camera = this.root.cameraObject.getTransform(), rotation = camera.getWorldRotation();
    this.center = camera.getWorldPosition().add(rotation.multiplyVec3(new vec3(0, 0, -110)));
    this.from = camera.getWorldPosition().add(rotation.multiplyVec3(new vec3(7, -15, -45)));
    this.right = rotation.multiplyVec3(vec3.right());
    this.button = createIconButton(this.getSceneObject(), "Beam target", "SIK cursor + beam", 30, 8, vec3.zero());
    this.button.sceneObject.getTransform().setWorldPosition(this.center);
    this.button.sceneObject.getTransform().setWorldRotation(rotation);
    this.button.button.interactable.ignoreInteractionPlane = true;
    this.button.button.interactable.targetingVisual = 1;
    this.button.button.interactable.onTriggerStart.add(() => this.presses++);
    this.input = new IntegrationInput();
    Object.defineProperty(this.input.actor, "activeTargetingMode", {
      configurable: true, get: () => this.direct ? TargetingMode.Direct : TargetingMode.Indirect,
    });
    this.input.ray(this.from, this.center.add(this.right.uniformScale(80)));
  }
  private tick(): void {
    this.elapsed += Math.min(0.1, getDeltaTime());
    if (!this.root) {
      if (this.elapsed < this.startDelayS) return;
      this.prepare(); this.elapsed = 3;
    }
    const input = this.input!, target = this.button!.button.interactable;
    if (this.phase === 3 || this.phase === 4) {
      input.ray(this.from, this.center.add(this.right.uniformScale(Math.sin(this.elapsed * 4) * 10)), target);
      input.update();
      const beam = this.beam();
      if (beam?.object.enabled) {
        const pass = beam.layers[1].pass;
        const end = new vec3(pass.endX, pass.endY, pass.endZ);
        const control = new vec3(pass.controlX, pass.controlY, pass.controlZ);
        this.maximumBend = Math.max(this.maximumBend, control.cross(end).length / Math.max(1, end.length));
      }
    }
    if (this.elapsed < 3) return;
    this.elapsed = 0; this.phase++;
    if (this.phase === 0) this.scene("beam-empty-space");
    else if (this.phase === 1) {
      this.check("empty-space-hidden", !this.beam()?.object.enabled);
      input.ray(this.from, this.center.add(this.right.uniformScale(17)));
      this.scene("beam-follows-visible-cursor");
    } else if (this.phase === 2) {
      this.check("visible-cursor-reveals-beam-without-extra-hover-rule", input.actor.currentInteractable === null && !!this.beam()?.object.enabled);
      const cursor = CursorControllerProvider.getInstance().getCursorByInteractor(input.actor)!;
      this.check("native-near-miss-cursor-preserved", cursor.cursorParameters.isShown);
      input.ray(this.from, this.center, target); input.hover(target);
      this.scene("beam-hover");
    } else if (this.phase === 3) {
      this.check("endpoint-on-native-cursor", this.attached());
      const beam = this.beam();
      this.mesh = beam?.layers[1].visual.mesh ?? null;
      this.check("native-physical-width", Math.abs(beam?.layers[1].pass.radius - 0.08) < 0.0001);
      const cursor = CursorControllerProvider.getInstance().getCursorByInteractor(input.actor)!;
      const alpha = (cursor.visual.getComponent("Component.RenderMeshVisual") as RenderMeshVisual).mainPass.masterAlpha;
      this.check("native-reduced-opacity", Math.abs(beam?.layers[1].pass.opacity - alpha * 0.45) < 0.001);
      this.check("native-start-offset", Math.abs(beam?.object.getTransform().getWorldPosition().distance(this.from) - 10) < 0.02);
      this.scene("beam-motion");
    } else if (this.phase === 4) {
      this.check("straight-motion-with-attached-endpoint", this.maximumBend < 0.02 && this.attached());
      input.start(target); this.scene("beam-held");
    } else if (this.phase === 5) {
      this.check("native-trigger-preserved", this.presses === 1 && this.attached());
      this.check("fixed-mesh-during-motion", this.mesh !== null && this.beam()?.layers[1].visual.mesh.isSame(this.mesh));
      input.end(); input.unhover(); input.active = false; this.scene("beam-tracking-lost");
    } else if (this.phase === 6) {
      this.check("tracking-loss-hides-beam", !this.beam()?.object.enabled);
      input.active = true; this.direct = true; input.ray(this.from, this.center, target);
      this.scene("beam-direct");
    } else if (this.phase === 7) {
      this.check("direct-interaction-hides-beam", !this.beam()?.object.enabled);
      this.direct = false; target.targetingVisual = 2; this.scene("beam-native-ray-only");
    } else if (this.phase === 8) {
      this.check("ray-only-target-has-no-addon", !this.beam()?.object.enabled);
      target.targetingVisual = 1; this.scene("beam-cursor-return");
    } else if (this.phase === 9) {
      this.check("cursor-return-restores-beam", this.attached());
      this.scene("beam-native-shader", false);
    } else {
      input.restore(); this.emit({ type: "complete", passed: !this.failed }); this.enabled = false;
    }
  }
}
