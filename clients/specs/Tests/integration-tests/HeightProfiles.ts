// Optional native harness: tools/review.py --harness Tests/integration-tests/HeightProfiles.ts.
// Exercises real setup views and Frame geometry; connection attempts stay disabled.
import { DimOSSpecsClient } from "../Scripts/DimOSSpecsClient/DimOSSpecsClient";
import { getFrameComponent } from "../Scripts/DimOSSpecsClient/presentation/UIKit";
import { SETUP_LAYOUTS } from "../Scripts/DimOSSpecsClient/presentation/PanelLayout";

const PROFILES = ["error", "connected", "message", "success"] as const;

@component
export class ReviewScenario extends BaseScriptComponent {
  @input startDelayS: number = 5;
  private root: any;
  private stage = -1;
  private elapsed = 0;
  private measured = false;
  private failed = false;
  private anchor: vec3 | null = null;

  private emit(value: Record<string, unknown>): void {
    print(`SPECS_REVIEW ${JSON.stringify({ ...value, unixMs: Date.now() })}`);
  }

  private check(name: string, passed: boolean): void {
    this.failed ||= !passed;
    this.emit({ type: "result", name, passed });
  }

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => {
      this.createEvent("UpdateEvent").bind(() => this.tick());
    });
  }

  private findRoot(object: SceneObject): any {
    const root = object.getComponent(DimOSSpecsClient.getTypeName());
    if (root) return root;
    for (let i = 0; i < object.getChildrenCount(); i++) {
      const found = this.findRoot(object.getChild(i));
      if (found) return found;
    }
    return null;
  }

  private prepare(): void {
    for (let i = 0; i < global.scene.getRootObjectsCount(); i++) {
      this.root = this.findRoot(global.scene.getRootObject(i));
      if (this.root) break;
    }
    if (!this.root) throw new Error("Production root missing");
    const ui = this.root.uiPresenter;
    const controller = ui.setupWizardController;
    controller.invalidatePending();
    // This fixture controls presentation profiles without changing connection state.
    controller.tick = () => {};
    controller.onSessionViewChanged = () => {};
    this.root.transport.connect = () => {};
    ui.mainUIFrame.enabled = false;
    this.root.robotPresenter.odometryRoot.enabled = false;
    ui.setupWizardPanel.enabled = true;
    getFrameComponent(ui.setupWizardPanel)?.setFollowing(false);
    this.elapsed = 4;
  }

  private tick(): void {
    const dt = Math.min(0.1, Math.max(0, getDeltaTime()));
    this.elapsed += dt;
    if (!this.root) {
      if (this.elapsed < this.startDelayS) return;
      this.prepare();
    }
    const ui = this.root.uiPresenter;
    const view = ui.setupWizardController.view;
    view.tick(dt);
    if (this.stage >= 0 && !this.measured && this.elapsed >= 0.6) {
      this.measure();
      this.measured = true;
    }
    if (this.elapsed < 4) return;
    this.elapsed = 0;
    this.measured = false;
    this.stage++;
    if (this.stage === PROFILES.length) {
      this.emit({ type: "complete", passed: !this.failed });
      this.enabled = false;
      return;
    }
    this.anchor ??= this.top();
    switch (this.stage) {
      case 0:
        view.applyStepLayout(1);
        view.setConnectionState({ phase: "error", text: "Unable to connect. Check the PIN and try again.",
          color: new vec4(1, 0.3, 0.3, 1), details: null });
        break;
      case 1:
        view.setConnectionState({ phase: "connected", text: "Connected", color: new vec4(1, 1, 1, 1),
          details: "Connection complete. Continue to localize your robot." });
        break;
      case 2:
        view.setCaptureLayout(false);
        view.applyStepLayout(2);
        view.setStatus("Localize your robot", new vec4(1, 1, 1, 1));
        view.setLocalizationGuidance("Look at the robot and keep your hands clear.");
        break;
      case 3:
        view.celebrate(1, "Unitree Go2");
        break;
    }
    this.emit({ type: "scene", name: `setup-profile-${PROFILES[this.stage]}` });
  }

  private measure(): void {
    const ui = this.root.uiPresenter;
    const frame = getFrameComponent(ui.setupWizardPanel)!;
    const key = PROFILES[this.stage];
    const height = SETUP_LAYOUTS[key].height;
    this.check(`${key}-native-height`, Math.abs(frame.totalSize.x - 90) < 0.01 &&
      Math.abs(frame.totalSize.y - height) < 0.01);
    const scale = ui.setupWizardPanel.getTransform().getWorldScale().y;
    this.check(`${key}-native-world-height`, Math.abs(frame.totalSize.y * scale - height * 0.432) < 0.01);
    const top = this.top();
    this.check(`${key}-fixed-top`, this.anchor !== null && top.distance(this.anchor) < 0.05);
    this.emit({ type: "metrics", key, height: frame.totalSize.y, top: top.toString() });
  }

  private top(): vec3 {
    const panel = this.root.uiPresenter.setupWizardPanel;
    const frame = getFrameComponent(panel)!;
    const transform = panel.getTransform();
    const localTop = new vec3(0, frame.totalSize.y * transform.getWorldScale().y / 2, 0);
    return transform.getWorldPosition().add(transform.getWorldRotation().multiplyVec3(localTop));
  }
}
