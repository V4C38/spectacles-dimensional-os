// Optional native regression harness: run tools/review.py --harness Tests/integration-tests/NativeInteractionProbe.ts.
// Uses real SIK events and the real TTS adapter; only network connection attempts are suppressed.
import { DimOSSpecsClient } from "../Scripts/DimOSSpecsClient/DimOSSpecsClient";
import { getFrameComponent } from "../Scripts/DimOSSpecsClient/presentation/UIKit";
import { InteractionManager } from "SpectaclesInteractionKit.lspkg/Core/InteractionManager/InteractionManager";
import { InteractorInputType } from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor";
@component
export class ReviewScenario extends BaseScriptComponent {
  @input startDelayS = 5;
  private root: any;
  private elapsed = 0;
  private phase = -1;
  private failed = false;
  private originalAudio = true;
  private originalOwner = true;
  private emit(value: Record<string, unknown>): void { print(`SPECS_REVIEW ${JSON.stringify({ ...value, unixMs: Date.now() })}`); }
  private check(name: string, passed: boolean): void { this.failed ||= !passed; this.emit({ type: "result", name, passed }); }
  onAwake(): void { this.createEvent("OnStartEvent").bind(() => this.createEvent("UpdateEvent").bind(() => this.tick())); }
  private press(button: any): void {
    const target = button.interactable;
    const actor = InteractionManager.getInstance().getInteractorsByType(InteractorInputType.Mouse)[0];
    if (!actor) throw new Error("Native editor Mouse interactor missing");
    const args: any = { interactor: actor, target, propagationPhase: "Target", connectionId: null,
      endedInsideInteractable: true, stopPropagation: () => {} };
    target.triggerStart(args); target.triggerEnd(args);
  }
  private checkFollow(afterResize: boolean): void {
    const frame = getFrameComponent(this.root.uiPresenter.setupWizardPanel)!;
    const button = frame.followButton;
    const scale = button.getSceneObject().getTransform().getLocalScale();
    this.check(afterResize ? "native-follow-size-after-resize" : "native-follow-size", Math.abs(button.size.x * scale.x - 7.2) < 0.05);
    if (!afterResize) {
      const before = frame.following; this.press(button);
      this.check("native-follow-toggle", frame.following !== before); this.press(button);
      this.check("native-follow-toggle-restored", frame.following === before);
    }
  }
  private tick(): void {
    this.elapsed += Math.min(0.1, Math.max(0, getDeltaTime()));
    if (!this.root) {
      if (this.elapsed < this.startDelayS) return;
      const find = (object: SceneObject): any => {
        const root = object.getComponent(DimOSSpecsClient.getTypeName()); if (root) return root;
        for (let i = 0; i < object.getChildrenCount(); i++) { const found = find(object.getChild(i)); if (found) return found; }
        return null;
      };
      for (let i = 0; i < global.scene.getRootObjectsCount(); i++) { this.root = find(global.scene.getRootObject(i)); if (this.root) break; }
      if (!this.root) throw new Error("Production root missing");
      const audio = this.root.textToSpeechAudio;
      this.originalAudio = audio.enabled; this.originalOwner = audio.getSceneObject().enabled;
      this.root.transport.connect = () => {}; this.root.transport.close = () => {};
      this.root.uiPresenter.setupWizardController.invalidatePending();
      this.elapsed = 3;
    }
    if (this.elapsed < 3) return;
    this.elapsed = 0; this.phase++;
    const root = this.root, ui = root.uiPresenter, controller = ui.setupWizardController;
    const audio = root.textToSpeechAudio as AudioComponent, owner = audio.getSceneObject();
    try {
      if (this.phase === 0) {
        this.checkFollow(false); audio.enabled = false; root.tts.stop(); this.check("disabled-audio-is-idle", !root.tts.isPlaying);
        this.press(controller.view.connectionToggle.button);
        this.check("native-disabled-audio-pin-to-ip", controller._connectionMethod === "ip" && controller.view.input.placeholderText.includes("IP"));
        controller.view.heightController.request(57);
      } else if (this.phase === 1) {
        this.checkFollow(true); owner.enabled = false; audio.enabled = true; root.tts.stop(); this.check("disabled-audio-parent-is-idle", !root.tts.isPlaying);
        this.press(controller.view.connectionToggle.button);
        this.check("native-disabled-parent-ip-to-pin", controller._connectionMethod === "pin" && controller.view.input.placeholderText.includes("PIN"));
      } else if (this.phase === 2) {
        owner.enabled = true; audio.enabled = true;
        root.tts.stop(); this.check("enabled-idle-audio-stop", !root.tts.isPlaying);
        this.press(controller.view.connectionToggle.button);
        this.check("native-enabled-idle-pin-to-ip", controller._connectionMethod === "ip");
      } else if (this.phase === 3 || this.phase === 5) {
        audio.enabled = this.phase === 5; owner.enabled = this.phase !== 5;
        ui.finishWizard(); ui.mainUIFrame.enabled = true; ui.mainMenuView.showPage("settings");
        const event = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
        event.bind(() => {
          const button = ui.mainMenuView.buttons.find((value: any) => value.getSceneObject().name === "Setup");
          this.press(button);
        }); event.reset(0.1);
      } else if (this.phase === 4 || this.phase === 6) {
        const name = this.phase === 4 ? "disabled-component" : "disabled-parent";
        this.check(`native-setup-restart-${name}`, !ui.isSetupCompleted() && controller.isVisible() &&
          controller.flow.step === "connect" && ui.setupWizardPanel.enabled && !ui.mainUIFrame.enabled);
      } else {
        audio.enabled = this.originalAudio; owner.enabled = this.originalOwner;
        this.emit({ type: "complete", passed: !this.failed }); this.enabled = false; return;
      }
      this.emit({ type: "scene", name: ["pin-ip-disabled-component", "ip-pin-disabled-parent", "pin-ip-enabled-idle",
        "restart-disabled-component-press", "restart-disabled-component-connect", "restart-disabled-parent-press", "restart-disabled-parent-connect"][this.phase] });
    } catch (error) { this.check(`native-interaction-phase-${this.phase}`, false); print(`SPECS_NATIVE_INTERACTION ${String(error)}`); }
  }
}
