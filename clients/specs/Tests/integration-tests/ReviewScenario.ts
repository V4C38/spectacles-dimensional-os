import { RUNTIME_LAYOUTS, RUNTIME_PANEL_SCALE, SETUP_LAYOUTS, panelContentOffset } from "../Scripts/DimOSSpecsClient/presentation/PanelLayout";
// Copied into disposable Assets/Review by tools/review.py; never shipped to hardware.
import { DimOSSpecsClient } from "../Scripts/DimOSSpecsClient/DimOSSpecsClient";
import { getFrameComponent } from "../Scripts/DimOSSpecsClient/presentation/UIKit";
import { specsToClientTrackingPoint } from "../Scripts/DimOSSpecsClient/utilities/SpecsCoordinates";
import { decodeOutbound, LIDAR_FOURCC } from "../Scripts/DimOSARClient/websocket/protocol";
import type { Vec3 } from "../Scripts/DimOSARClient/websocket/protocolTypes";
import { InteractionManager } from "SpectaclesInteractionKit.lspkg/Core/InteractionManager/InteractionManager";
import { InteractorInputType, type Interactor } from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor";
import { Interactable, type InteractableEventArgs } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { RoundedRectangle } from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle";

const CAMERA_FIXTURE = requireAsset("./CameraFixture.png") as Texture;

@component
export class ReviewScenario extends BaseScriptComponent {
  @input startDelayS: number = 5;
  // Screenshot comparison only: front-on UI, no world geometry. Production placement is untouched.
  @input comparisonMode: boolean = false;
  @input restartProbeOnly: boolean = false;
  private root: any;
  private sent: any[] = [];
  private steps: { name: string; run: () => void; videoOnly?: boolean }[] = [];
  private next = 0;
  private started = 0;
  private failed = false;
  private editorInteractor: Interactor | null = null;
  private robot: Vec3 = [1.6, -0.45, -0.3];
  private goal: Vec3 = [2.5, 0.5, -0.63];

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => {
      const delay = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
      delay.bind(() => this.start()); delay.reset(this.startDelayS);
    });
  }
  private emit(value: Record<string, unknown>): void { print(`SPECS_REVIEW ${JSON.stringify({ ...value, unixMs: Date.now() })}`); }
  private check(name: string, passed: boolean): void {
    if (!passed) this.failed = true;
    this.emit({ type: "result", name, passed });
  }
  private wire(value: unknown): void {
    const text = JSON.stringify(value); decodeOutbound(text);
    this.root.session.onTransportText(text + "\n");
  }
  private nativeTrigger(target: Interactable, end = false): void {
    if (!this.editorInteractor) throw new Error("Native review requires the registered editor Mouse interactor");
    const args: InteractableEventArgs = { interactor: this.editorInteractor, target,
      propagationPhase: "Target", connectionId: null, endedInsideInteractable: end,
      stopPropagation: () => {} };
    if (end) target.triggerEnd(args); else target.triggerStart(args);
  }
  private state(nav = "idle", outcome: string | null = null): void {
    this.wire({ type: "state", server: { connected_clients: 1 },
      lidar: { enabled: true, min_height_m: 0.1, max_height_m: 1.5, max_range_m: 5 },
      nav: { state: nav, outcome }, agent: { idle: true } });
  }
  private placePanel(panel: SceneObject): void {
    const frame = getFrameComponent(panel);
    // Pin through the native Frame API for a stable review pose; retain its built-in follow capability.
    if (frame?.smoothFollow) frame.setFollowing(false);
    const camera = this.root.cameraObject.getTransform();
    const t = panel.getTransform();
    const eye = camera.getWorldPosition();
    const target = eye.add(camera.getWorldRotation().multiplyVec3(new vec3(0, 0, -90)));
    if (!this.comparisonMode && panel !== this.root.uiPresenter.setupWizardPanel) target.y -= 18;
    t.setWorldPosition(target);
    // Preserve production scale; otherwise the review defeats physical UI calibration.
    t.setWorldRotation(quat.lookAt(eye.sub(target).normalize(), vec3.up())); panel.enabled = true;
  }
  private checkFrameLayout(name: string, panel: SceneObject, worldScale: number): void {
    const frame = getFrameComponent(panel);
    const size = frame?.totalSize;
    this.check(`${name}-frame-layout`, Boolean(frame?.content && size &&
      Math.abs(size.x - 90) < 0.001 && Math.abs(size.y - (name === "setup" ? SETUP_LAYOUTS.entry.height : RUNTIME_LAYOUTS.manual.height)) < 0.001 &&
      !frame.allowScaling && !frame.autoScaleContent));
    this.check(`${name}-native-frame-interaction`, Boolean(frame?.smoothFollow && frame.allowTranslation &&
      frame.onlyInteractOnBorder && !frame.grabZoneOnly && !frame.allowScaling));
    this.check(`${name}-frame-world-occlusion`, frame?.roundedRectangle.renderMeshVisual.mainPass.depthWrite === true &&
      frame.roundedRectangle.renderMeshVisual.mainPass.depthTest === true);
    const settled = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
    settled.bind(() => {
      const scale = panel.getTransform().getWorldScale();
      this.check(`${name}-frame-world-size`, Boolean(size &&
        Math.abs(size.x * scale.x - 90 * worldScale) < 0.01 &&
        Math.abs(size.y * scale.y - (name === "setup" ? SETUP_LAYOUTS.entry.height : RUNTIME_LAYOUTS.manual.height) * worldScale) < 0.01));
      print(`SPECS_FRAME_METRICS ${JSON.stringify({ name, outerLocalCm: size?.toString(),
        worldScale: scale.toString(), expectedWorldScale: worldScale })}`);
    });
    settled.reset(0.6);
  }
  private checkContentLayout(menu: any, panel: SceneObject): void {
    const inverse = panel.getTransform().getInvertedWorldTransform();
    const measurements: Record<string, unknown>[] = [];
    const offset = panelContentOffset(RUNTIME_LAYOUTS.agent.height);
    const close = (a: number, b: number) => Math.abs(a - b) < 0.05;
    const control = (name: string, button: any, x: number, y: number, width: number, height: number) => {
      const object = button.getSceneObject() as SceneObject;
      const position = inverse.multiplyPoint(object.getTransform().getWorldPosition());
      const rectangle = object.getComponent(RoundedRectangle.getTypeName()) as RoundedRectangle;
      const size = rectangle?.size;
      this.check(name, Boolean(size && close(position.x, x) && close(position.y, y + offset) && close(size.x, width) && close(size.y, height)));
      measurements.push({ name, position: position.toString(), primitiveSize: size?.toString(), buttonSize: button.size.toString() });
    };
    control("native-manual-tab-layout", menu.modeButtons[0], -19.85, 19.8, 39.1, 6.4);
    control("native-agent-tab-layout", menu.modeButtons[1], 19.85, 19.8, 39.1, 6.4);
    control("native-send-layout", menu.send, -20.5, RUNTIME_LAYOUTS.agent.rows.actions, 39, 6.4);
    control("native-clear-layout", menu.clear, 20.5, RUNTIME_LAYOUTS.agent.rows.actions, 39, 6.4);
    for (const [name, field, y] of [["native-draft-viewport", menu.draft, RUNTIME_LAYOUTS.agent.rows.draft - 1.6], ["native-reply-viewport", menu.reply, RUNTIME_LAYOUTS.agent.rows.reply - 1.6]] as const) {
      const position = inverse.multiplyPoint(field.root.getTransform().getWorldPosition());
      const size = field.window.windowSize;
      this.check(name, close(size.x, 74.4) && close(size.y, 5.7) && close(position.x, 0) && close(position.y, y + offset));
      measurements.push({ name, position: position.toString(), viewport: size.toString(), textRect: field.text.worldSpaceRect.toString() });
    }
    let header: Text | null = null;
    const find = (object: SceneObject) => {
      const text = object.getComponent("Component.Text") as Text;
      if (text?.text === "dimOS AR") header = text;
      for (let i = 0; i < object.getChildrenCount(); i++) find(object.getChild(i));
    };
    find(menu.root);
    const text = header as Text | null;
    const position = text ? inverse.multiplyPoint(text.getSceneObject().getTransform().getWorldPosition()) : null;
    this.check("native-header-layout", Boolean(text && position && close(position.x, -18) && close(position.y, 30.6 + offset) && text.horizontalAlignment === HorizontalAlignment.Left));
    this.check("native-no-extra-activity", menu.activity === undefined);
    measurements.push({ name: "native-header-layout", position: position?.toString(), alignment: text?.horizontalAlignment });
    print(`SPECS_CONTENT_METRICS ${JSON.stringify(measurements)}`);
  }
  private start(): void {
    const find = (o: SceneObject): any => {
      const c = o.getComponent(DimOSSpecsClient.getTypeName()); if (c) return c;
      for (let i = 0; i < o.getChildrenCount(); i++) { const result = find(o.getChild(i)); if (result) return result; }
      return null;
    };
    for (let i = 0; i < global.scene.getRootObjectsCount(); i++) { this.root = find(global.scene.getRootObject(i)); if (this.root) break; }
    if (!this.root?.uiPresenter?.mainMenuView) { this.check("composition-ready", false); this.emit({ type: "complete", passed: false }); return; }
    this.editorInteractor = InteractionManager.getInstance().getInteractorsByType(InteractorInputType.Mouse)[0] ?? null;
    this.check("native-editor-interactor", this.editorInteractor !== null);
    if (!this.editorInteractor) { this.emit({ type: "complete", passed: false }); return; }
    const root = this.root, ui = root.uiPresenter, menu = ui.mainMenuView, callbacks = menu.callbacks;
    // Desktop fixtures replace hardware ports, while using production session parsing,
    // state owners, presenters, native SUK controls and shaders without test branches.
    root.transport.connect = () => {}; root.transport.close = () => {};
    root.transport.sendText = (text: string) => { for (const line of text.trim().split("\n")) this.sent.push(JSON.parse(line)); };
    root.transport.sendBinary = () => {};
    root.cameraSource.start = () => {}; root.cameraSource.stop = () => {};
    const camera = root.cameraObject.getTransform();
    const position = camera.getWorldPosition().add(camera.getWorldRotation().multiplyVec3(new vec3(0, -25, -200)));
    this.robot = specsToClientTrackingPoint([position.x, position.y, position.z]);
    const goal = camera.getWorldPosition().add(camera.getWorldRotation().multiplyVec3(new vec3(-12, -45, -280)));
    this.goal = specsToClientTrackingPoint([goal.x, goal.y, goal.z]);
    let textUpdate: ((text: string, final: boolean) => void) | null = null;
    let recognitionEnd: (() => void) | null = null;
    root.speechController.draft.deps.recognition = {
      start: (text: typeof textUpdate, _error: unknown, end: () => void, started: () => void) => { textUpdate = text; recognitionEnd = end; started(); },
      stop: () => { textUpdate = null; }, finish: () => { recognitionEnd?.(); }
    };
    root.speechController.draft.snapshotValue.recognitionAvailable = true;
    root.speechController.draft.deps.synthesis = { speak: (_: string, end: () => void) => end(), stop: () => {} };
    this.steps = [
      { name: "setup-connect", run: () => {
        this.placePanel(ui.setupWizardPanel);
        this.checkFrameLayout("setup", ui.setupWizardPanel, 0.432);
        const steps = ui.setupWizardController.view.steps;
        this.check("native-setup-filled-selection", steps[0].button.style === "Primary" &&
          steps[1].button.style === "Secondary" && !steps[0].button._toggleable && !steps[1].button._toggleable);
        this.check("native-initial-back-hidden", !ui.setupWizardController.view.previous.sceneObject.enabled);
      } },
      { name: "setup-align", run: () => {
        root.session.start(); root.session.onTransportOpen();
        const available = { available: true, reason: null };
        this.wire({ type: "hello", client_id: "specs-review", time_sync: { ts_client: getTime(), ts_server: getTime() },
          robot: { display_name: "Unitree Go2", body_bounds_m: [0.7, 0.5, 0.55], footprint_m: [0.7, 0.5], base_height_m: 0.33 },
          capabilities: { lidar: available, localization: available, estop: available, agent: available,
            navigation: { ...available, nav_goal: available, nav_joystick: { available: false, reason: "Hands only" } } } });
        ui.setupWizardController.deps.previewTexture = () => CAMERA_FIXTURE;
        this.state(); ui.setupWizardController.onNext();
        this.check("ready-session", root.session.view().connection === "ready");
      } },
      { name: "setup-success", videoOnly: true, run: () => {
        this.check("camera-preview", ui.setupWizardController.view.previewRoot.enabled);
        root.clientTrackingOriginStore.restore({ position: [0, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: getTime() });
        this.wire({ type: "pose", position: this.robot, orientation: [0, 0, 0, 1], ts: getTime() }); this.state();
      } },
      { name: "runtime-manual", run: () => {
        this.placePanel(ui.mainUIFrame); this.check("setup-completed", ui.isSetupCompleted());
        this.checkFrameLayout("runtime", ui.mainUIFrame, RUNTIME_PANEL_SCALE);
        this.check("native-manual-filled-selection", menu.modeButtons[0].style === "Primary" &&
          menu.modeButtons[1].style === "Secondary" && !menu.modeButtons[0]._toggleable && !menu.modeButtons[1]._toggleable);
      } },
      { name: "robot-selected", run: () => {
        ui.mainUIFrame.enabled = false;
        this.nativeTrigger(root.robotPresenter.worldVisuals.interactable);
        this.check("native-robot-selected-on-press", root.selection.isSelected());
        this.nativeTrigger(root.robotPresenter.worldVisuals.interactable, true);
        this.check("shared-selection", root.selection.isSelected());
      } },
      { name: "agent-recording", run: () => {
        this.placePanel(ui.mainUIFrame); callbacks.onModeButtonPressed("agent");
        this.nativeTrigger(menu.draft.window.interactable);
        this.check("native-hold-recording", root.speechController.asrRunning);
        textUpdate?.("Please inspect the doorway and report any obstacles.", false);
        this.check("recording-does-not-send", !this.sent.some(v => v.type === "user_message_request"));
      } },
      { name: "agent-draft", run: () => {
        this.nativeTrigger(menu.draft.window.interactable, true);
        this.check("native-hold-released", !root.speechController.asrRunning);
        this.check("draft-retained", root.speechController.snapshot().prompt.length > 0);
        this.check("native-agent-filled-selection", menu.modeButtons[1].style === "Primary" &&
          menu.modeButtons[0].style === "Secondary" && !menu.modeButtons[1]._toggleable);
        this.check("native-robot-filled-selection", menu.robot.button.style === "Primary" && !menu.robot.button._toggleable);
        const inverse = ui.mainUIFrame.getTransform().getInvertedWorldTransform();
        const draft = inverse.multiplyPoint(menu.draft.text.getSceneObject().getTransform().getWorldPosition());
        const reply = inverse.multiplyPoint(menu.reply.text.getSceneObject().getTransform().getWorldPosition());
        const layoutPassed = draft.y < reply.y - 2;
        this.check("draft-below-reply", layoutPassed);
        this.checkContentLayout(menu, ui.mainUIFrame);
        if (!layoutPassed) print(`Draft layout positions: ${JSON.stringify({ draft: [draft.x, draft.y, draft.z], reply: [reply.x, reply.y, reply.z],
          draftRoot: menu.draft.root.getTransform().getLocalPosition().toString(),
          screenPosition: menu.draft.root.getComponent("Component.ScreenTransform").position.toString() })}`);
      } },
      { name: "agent-response", run: () => {
        this.nativeTrigger(menu.send.interactable); this.nativeTrigger(menu.send.interactable, true);
        this.wire({ type: "agent_message", text: "The doorway is clear. I will wait for your next instruction." });
        this.check("explicit-send", this.sent.some(v => v.type === "user_message_request"));
      } },
      { name: "sensors-full", run: () => { menu.showPage("sensors"); callbacks.onLidarMode("full"); this.lidar(); } },
      { name: "sensors-obstacles", run: () => { callbacks.onLidarMode("obstacles"); callbacks.onLidarRange(1); this.lidar(); } },
      { name: "settings", run: () => { menu.showPage("settings"); callbacks.onDebugModeChanged(true); } },
      { name: "diagnostics", run: () => menu.showPage("diagnostics") },
      { name: "navigation-preview", run: () => {
        ui.mainUIFrame.enabled = false; menu.showPage("main"); callbacks.onModeButtonPressed("manual"); root.selection.setSelected(true);
        const interaction = root.navigationController.interaction;
        interaction.hold(getTime(), { position: this.goal, blocked: false }, false, "review-left");
        interaction.release(getTime(), { position: this.goal, blocked: false }, "review-left");
        this.check("draft-owner", interaction.ownsDraft("review-left"));
      } },
      { name: "navigation-route", run: () => {
        this.wire({ type: "nav_goal", pose: [...this.goal, 0.7], path_poses: [[...this.robot, 0], [this.robot[0] + 0.4, this.robot[1], this.goal[2], 0], [...this.goal, 0.7]], ts: getTime() });
        this.state("following_path"); root.navigationController.interaction.cancelDrag();
      } },
      { name: "navigation-stop", run: () => {
        this.check("route-retained", root.navigationController.activePath()?.length >= 2);
        this.placePanel(ui.mainUIFrame); menu.showPage("main");
        // Let native OnEnable subscriptions settle before dispatching the press.
        const press = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
        press.bind(() => {
          try {
            const before = this.sent.filter(v => v.type === "estop_request").length;
            this.nativeTrigger(menu.stop.interactable);
            this.check("native-stop-on-press", this.sent.filter(v => v.type === "estop_request").length > before);
            this.nativeTrigger(menu.stop.interactable, true);
            this.check("stop-command", this.sent.filter(v => v.type === "estop_request").length > before);
          } catch (error) { this.check("native-stop-event", false); print(String(error)); }
          ui.mainUIFrame.enabled = false;
        });
        press.reset(0);
      } },
      { name: "world-marker", run: () => {
        this.wire({ type: "agent_skill", name: "ar_place_marker", args: { id: "door", title: "Doorway", x: this.goal[0], y: this.goal[1], z: this.goal[2] + 0.5 } });
      } },
      { name: "alignment-review", run: () => { this.placePanel(ui.mainUIFrame); ui.requestAlignmentReview("Review fixture: tracking resumed"); } },
      { name: "disconnected", run: () => { root.session.onTransportClose(); this.check("selection-cleared", !root.selection.isSelected()); } },
      { name: "setup-restart", run: () => {
        callbacks.onDismissAlignment();
        this.check("review-dismiss-closes-ui", ui.uiState === 0);
        ui.setUIState(1, { immediate: true }); this.placePanel(ui.mainUIFrame); menu.showPage("settings");
        const controller = ui.setupWizardController;
        let restartCalled = false, startCalled = false;
        const restart = ui.restartSetup.bind(ui), start = controller.start.bind(controller);
        ui.restartSetup = () => { restartCalled = true; print("SPECS_RESTART restartSetup entered"); restart(); };
        controller.start = (fromRuntime: boolean) => { startCalled = true; print("SPECS_RESTART controller.start entered"); start(fromRuntime); };
        const press = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
        press.bind(() => {
          try {
            const button = menu.buttons.find((value: any) => value.getSceneObject().name === "Setup");
            if (!button) throw new Error("Native Settings Setup button missing");
            this.nativeTrigger(button.interactable); this.nativeTrigger(button.interactable, true);
            this.check("native-setup-restart-callback", restartCalled);
            this.check("native-setup-restart-queued", !startCalled);
            const reopened = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
            reopened.bind(() => {
              this.check("native-setup-controller-start", startCalled);
              this.check("native-setup-reopened", !ui.isSetupCompleted() && controller.isVisible() && ui.setupWizardPanel.enabled && controller.flow.step === "connect");
              this.check("native-restart-main-hidden", !ui.mainUIFrame.enabled);
              this.check("native-restart-back-hidden", !controller.view.previous.sceneObject.enabled);
              const skip = this.createEvent("UpdateEvent");
              let visibleHold = 0;
              skip.bind(() => {
                visibleHold += Math.min(0.1, Math.max(0, getDeltaTime()));
                if (visibleHold < 1.3) return;
                skip.enabled = false;
                this.nativeTrigger(controller.view.next.button.interactable);
                this.nativeTrigger(controller.view.next.button.interactable, true);
                this.check("native-restart-skip-main", ui.isSetupCompleted() && menu.page === "main");
              });
              print(`SPECS_RESTART ${JSON.stringify({ restartCalled, startCalled, completed: ui.isSetupCompleted(), visible: controller.isVisible(), panel: ui.setupWizardPanel.enabled, step: controller.flow.step })}`);
            }); reopened.reset(0.1);
          } catch (error) { this.check("native-setup-restart", false); print(`SPECS_RESTART ERROR ${String(error)}`); }
        }); press.reset(0.1);
      } },
    ];
    const outcomeSteps = [
      { name: "navigation-success", videoOnly: true, run: () => {
        this.wire({ type: "nav_goal", pose: [...this.goal, 0.7], path_poses: [[...this.goal, 0.7]], ts: getTime() });
        this.state("following_path");
        const settled = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
        settled.bind(() => {
          this.state("resolved", "succeeded");
          const check = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
          check.bind(() => this.check("native-success-feedback", root.navigationController.flash() === "succeeded"));
          check.reset(0.1);
        });
        settled.reset(0.1);
      } },
      { name: "navigation-cancelled", videoOnly: true, run: () => {
        this.wire({ type: "nav_goal", pose: [...this.goal, 0.7], path_poses: [[...this.goal, 0.7]], ts: getTime() });
        this.state("following_path");
        const press = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
        press.bind(() => {
          try {
            const before = this.sent.filter(value => value.type === "estop_request").length;
            const button = root.navigationController.marker.cancelButton;
            this.nativeTrigger(button.interactable);
            this.check("native-marker-cancel-on-press", this.sent.filter(value => value.type === "estop_request").length > before);
            this.check("native-cancelled-feedback", root.navigationController.flash() === "cancelled");
            this.nativeTrigger(button.interactable, true);
          } catch (error) { this.check("native-marker-cancel", false); print(String(error)); }
        }); press.reset(0.1);
      } },
    ];
    this.steps.splice(this.steps.findIndex(step => step.name === "world-marker"), 0, ...outcomeSteps);
    if (this.restartProbeOnly) {
      const names = new Set(["setup-connect", "setup-align", "setup-success", "runtime-manual", "settings", "setup-restart"]);
      this.steps = this.steps.filter(step => names.has(step.name));
    }
    if (this.comparisonMode) {
      const pages = new Set(["setup-connect", "setup-align", "setup-success", "runtime-manual",
        "agent-recording", "agent-draft", "sensors-full", "settings"]);
      this.steps = this.steps.filter(step => pages.has(step.name));
    }
    this.started = 4;
    this.createEvent("UpdateEvent").bind(() => this.tick()); this.tick();
  }
  private tick(): void {
    if (this.comparisonMode) {
      // Keep the real UI state owners and native primitives; omit unrelated world ink in this fixture.
      this.root.robotPresenter.odometryRoot.enabled = false;
      this.root.lidarPresenter.getSceneObject().enabled = false;
    }
    this.started += Math.min(0.1, Math.max(0, getDeltaTime()));
    if (this.started < 4) return;
    this.started = 0;
    if (this.next >= this.steps.length) { this.emit({ type: "complete", passed: !this.failed }); this.enabled = false; return; }
    const step = this.steps[this.next++];
    try { step.run(); this.emit({ type: "scene", name: step.name, videoOnly: step.videoOnly ?? false }); }
    catch (error) { this.failed = true; this.emit({ type: "result", name: step.name, passed: false, detail: String(error) }); }
  }
  private lidar(): void {
    const count = 1500, data = new Uint8Array(16 + count * 12), view = new DataView(data.buffer);
    view.setUint32(0, LIDAR_FOURCC, true); view.setFloat64(4, getTime(), true); view.setUint32(12, count, true);
    for (let i = 0; i < count; i++) {
      const angle = i * 2.39996323, radius = 0.3 + (i % 47) / 47 * 1.8;
      const values = [this.robot[0] + Math.cos(angle) * radius, this.robot[1] + Math.sin(angle) * radius,
        this.robot[2] - 0.23 + (i % 17) / 17 * 1.3];
      values.forEach((v, axis) => view.setFloat32(16 + i * 12 + axis * 4, v, true));
    }
    this.root.session.onTransportBinary(data);
  }
}
