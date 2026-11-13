import { integrationTestsEnabled } from "../Scripts/Integration Test Harness";
// Hardware inputs are deterministic fixtures. Production state owners, SIK/SUK controls and renderers run unchanged.
import { SETUP_LAYOUTS,SETUP_PANEL_SCALE } from "../Scripts/DimOSSpecsClient/presentation/SpecsPanelPresentation";
import { SetupWizardStep } from "../Scripts/DimOSSpecsClient/presentation/SetupWizardView";
import { getFrameComponent } from "../Scripts/DimOSSpecsClient/presentation/UIKit";
import { INTEGRATION_CATALOG as CATALOG } from "./IntegrationCatalog";
import type { ReviewScenario } from "./IntegrationScenario";

/** Case actions share the scenario's fixture, scheduler and assertion owner. */
export function runRegressionCase(scenario: ReviewScenario, id: string): void {
  if (!integrationTestsEnabled(scenario.getSceneObject())) return;
  const root = scenario.root, ui = root.uiPresenter, menu = ui.mainMenuView, controller = ui.setupWizardController;
  switch (id) {
    case "setup_navigation": {
      root.session.stop();
      controller.start(false);
      const backHidden = !controller.view.previous.sceneObject.enabled;
      let skipped = false, settingsOpened = false, runtimeRestarted = false, runtimeBack = false;
      // Each dependent action is scheduled after its predecessor actually runs.
      // Native frame stalls can batch absolute offsets; the deferred setup
      // restart must receive a natural frame before checking its result.
      scenario.after(0.2, () => {
        scenario.press(controller.view.next.button);
        scenario.after(0.2, () => {
          skipped = ui.isSetupCompleted() && menu.page === "main";
          scenario.showMenu();
          scenario.after(0.2, () => {
            scenario.press(scenario.button("Global settings"));
            scenario.after(0.2, () => {
              settingsOpened = menu.page === "settings";
              const setup = scenario.button("Setup");
              const deadline = scenario.clock + 2;
              const pressReadySetup = () => {
                // The settings header is available during panel expansion, but
                // MainMenuView keeps its body hidden until the height fits.
                if (!setup.getSceneObject().isEnabledInHierarchy || !setup.interactable.enabled) {
                  if (scenario.clock >= deadline) {
                    print(`SETUP_CONTROL_TIMEOUT ${JSON.stringify({ hierarchyEnabled: setup.getSceneObject().isEnabledInHierarchy, interactableEnabled: setup.interactable.enabled, inactive: setup.inactive, height: menu.heightController.height, targetHeight: menu.heightController.target, page: menu.page })}`);
                    scenario.check("setup-control-ready", false, id);
                    return;
                  }
                  scenario.after(0.05, pressReadySetup);
                  return;
                }
                scenario.press(setup);
                scenario.after(0.2, () => {
                  runtimeRestarted = controller.isVisible() && !ui.isSetupCompleted();
                  runtimeBack = controller.view.previous.sceneObject.enabled;
                  scenario.press(controller.view.previous.button);
                  scenario.later(0.2, () => {
                    const completed = ui.isSetupCompleted();
                    print(`SETUP_NAVIGATION ${JSON.stringify({ backHidden, skipped, settingsOpened, runtimeRestarted, runtimeBack, completed, step: controller.flow.step })}`);
                    return backHidden && skipped && settingsOpened && runtimeRestarted && runtimeBack && completed;
                  }, id);
                });
              };
              pressReadySetup();
            });
          });
        });
      });
      break;
    }
    case "connection_recovery": {
      scenario.runtime();
      scenario.after(0.3, () => scenario.press(root.robotPresenter.worldVisuals));
      let cleared = false;
      scenario.after(0.6, () => { root.session.onTransportClose(); cleared = !root.selection.isSelected(); });
      scenario.after(1, () => scenario.ready(scenario.caps, true));
      scenario.later(1.5, () => cleared && root.session.view().connection === "ready" && !root.selection.isSelected());
      break;
    }
    case "capabilities_unavailable": {
      root.session.stop();
      scenario.ready(Object.fromEntries(Object.entries(scenario.caps).map(([key, value]) => [key,
        key === "navigation" ? { available: false, reason: "Fixture unavailable", nav_goal: { preview: false, available: false, reason: "Fixture unavailable" }, nav_joystick: { available: false, reason: "Hand only" } } : { available: false, reason: "Fixture unavailable" }])));
      scenario.runtime();
      const before = scenario.sent.length;
      scenario.after(0.5, () => { scenario.press(menu.modeButtons[1]); scenario.press(menu.stop); scenario.press(menu.lidarButtons[2]); });
      scenario.later(0.9, () => ui.getOperatingMode() === "manual" && menu.modeButtons[1].inactive && menu.stop.inactive &&
        !scenario.sent.slice(before).some(row => ["nav_goal_request", "estop_request", "user_message_request", "lidar_settings_request"].includes(row.type)));
      break;
    }
    case "localization_providers": {
      root.session.stop();
      scenario.ready(scenario.caps, false, ["fiducial_marker"]);
      scenario.input!.active = false;
      controller.start(true);
      ui.mainUIFrame.enabled = false;
      scenario.after(0.4, () => scenario.press(controller.view.next.button));
      let marker = false, vps = false, mixed = false, none = false, unavailable = false;
      const observations: unknown[] = [];
      const observe = (label: string, guide: boolean): boolean => {
        const actual = { label: controller.view.description.text, guide: controller.view.guide.object.enabled,
          policy: root.episode.view().capturePolicy, providers: root.session.view().hello?.localization?.providers };
        observations.push(actual);
        return actual.label === label && actual.guide === guide && actual.policy === "any_angle";
      };
      const select = (providers: ("fiducial_marker" | "vps")[]) => {
        root.episode.reset();
        root.session.stop();
        scenario.ready(scenario.caps, false, providers);
        scenario.captureRequest("any_angle");
      };
      scenario.after(0.7, () => { marker = observe("Fiducial marker", true); });
      scenario.after(0.8, () => select(["vps"]));
      scenario.after(1.1, () => { vps = observe("VPS", false); });
      scenario.after(1.2, () => select(["fiducial_marker", "vps"]));
      scenario.after(1.5, () => { mixed = observe("Fiducial marker + VPS", true); });
      scenario.after(1.6, () => select([]));
      scenario.after(1.9, () => { none = observe("No localization provider", false); });
      scenario.after(2, () => {
        scenario.captureFailure = true;
        select(["vps"]);
        // Inventory changes reset/queue capture while paused. Resume through
        // the public owner before checking an actual camera failure.
        root.episode.requestStart();
      });
      scenario.after(2.6, () => {
        unavailable = root.episode.view().phase === "failed" && !!root.episode.view().lastError;
        scenario.captureFailure = false;
        print("LOCALIZATION_PROVIDERS " + JSON.stringify({ marker, vps, mixed, none, unavailable, observations }));
      });
      scenario.later(2.8, () => marker && vps && mixed && none && unavailable && controller.view.cardBody.text.length > 0);
      scenario.after(3.2, () => { scenario.captureFailure = false; select(["vps"]); });
      break;
    }
    case "localization_rejection": {
      scenario.captureFailure = false;
      root.episode.reset();
      root.clientTrackingOriginStore.clear();
      controller.start(true);
      scenario.after(0.4, () => scenario.press(controller.view.next.button));
      let stale = false;
      scenario.after(1.8, () => { scenario.acceptLocalization(scenario.captureTs - 100); stale = !root.clientTrackingOriginStore.hasTrackingOrigin; scenario.captureFailure = true; scenario.captureRequest(); });
      scenario.later(2.4, () => stale && !ui.isSetupCompleted() && root.episode.view().phase === "failed" && !root.clientTrackingOriginStore.hasTrackingOrigin);
      scenario.after(3, () => { scenario.captureFailure = false; root.episode.reset(); });
      break;
    }
    case "tracking_recovery": {
      scenario.runtime();
      scenario.worldOnly();
      scenario.after(0.4, () => { if (!root.selection.isSelected())
        scenario.press(root.robotPresenter.worldVisuals); scenario.aim(); scenario.input!.start(null); });
      const before = scenario.count("interaction_request", row => row.action === "confirm");
      let lost = false;
      scenario.after(0.9, () => { scenario.input!.active = false; scenario.input!.held = false; });
      scenario.after(1.2, () => { lost = !root.navigationController.isAiming(); scenario.aim(); });
      scenario.after(1.4, () => scenario.input!.start(null));
      scenario.after(1.7, () => scenario.input!.end());
      scenario.later(2, () => lost && root.navigationController.isAiming() && scenario.count("interaction_request", row => row.action === "confirm") === before);
      scenario.after(2.2, () => { scenario.input!.active = false; scenario.input!.cancel(); });
      break;
    }
    case "interaction_safety": {
      scenario.runtime();
      const before = scenario.count("interaction_request", row => row.action === "confirm");
      scenario.after(0.4, () => { scenario.input!.active = true; scenario.input!.hover(menu.robot.button.interactable); scenario.input!.start(); });
      scenario.after(0.9, () => scenario.input!.cancel());
      scenario.later(1.3, () => scenario.count("interaction_request", row => row.action === "confirm") === before && !root.navigationController.isAiming() && !root.speechController.asrRunning);
      break;
    }
    case "navigation_failure":
      scenario.runtime();
      scenario.worldOnly();
      scenario.wire({ type: "nav_goal", pose: [...scenario.goal, 0], path_poses: CATALOG.fixtures.path, ts: getTime() });
      scenario.state("following_path", null);
      scenario.after(0.2, () => scenario.state("resolved", "failed"));
      scenario.later(0.5, () => root.navigationController.flash() === "failed" && root.navigationController.marker.worldVisuals.outcomeRing.object.enabled);
      break;
    case "emergency_stop": {
      scenario.runtime();
      scenario.after(0.4, () => {
        const before = scenario.count("estop_request");
        scenario.input!.hover(menu.stop.interactable);
        scenario.input!.start();
        scenario.check("stop_before_release", scenario.count("estop_request") === before + 1, id);
        scenario.input!.end();
        scenario.input!.unhover();
        scenario.check(id, scenario.count("estop_request") === before + 1, id);
      });
      break;
    }
    case "speech_lifecycle": {
      scenario.runtime();
      scenario.after(0.3, () => scenario.press(menu.modeButtons[1]));
      const before = scenario.count("user_message_request");
      scenario.after(0.9, () => { scenario.input!.active = true; scenario.input!.hover(menu.draft.window.interactable); scenario.input!.start(); scenario.recognitionText?.(Array.from({ length: 70 }, () => "A retained long message.").join(" "), false); });
      scenario.after(1.3, () => scenario.input!.cancel());
      scenario.after(1.8, () => { menu.draft.window.scrollPositionNormalized = new vec2(0, -1); });
      scenario.later(2.2, () => !root.speechController.asrRunning && root.speechController.snapshot().prompt.length > 500 && menu.draft.window.scrollDimensions.y > menu.draft.window.windowSize.y && menu.draft.window.scrollPositionNormalized.y < -.9 && scenario.count("user_message_request") === before);
      break;
    }
    case "speech_errors": {
      scenario.runtime();
      scenario.after(0.3, () => scenario.press(menu.modeButtons[1]));
      let visible = false, recovered = false;
      scenario.after(0.9, () => { scenario.input!.active = true; scenario.input!.hover(menu.draft.window.interactable); scenario.input!.start(); scenario.recognitionError?.("network"); scenario.input!.cancel(); });
      scenario.after(1.3, () => { visible = menu.status.text.includes("Speech unavailable"); scenario.input!.active = true; scenario.input!.hover(menu.draft.window.interactable); scenario.input!.start(); recovered = root.speechController.asrRunning; scenario.recognitionText?.("Recovered message", false); scenario.input!.end(); scenario.input!.unhover(); scenario.wire({ type: "agent_message", text: "No client pose: requested action is unavailable." }); });
      scenario.later(1.9, () => visible && recovered && root.speechController.snapshot().severity === "error" && menu.reply.text.text.includes("No client pose"));
      break;
    }
    case "audio_reset": {
      const generation = root.tts.generation;
      root.speechController.reset();
      scenario.check(id, !root.speechController.asrRunning && root.speechController.snapshot().prompt === "" && root.tts.generation > generation && !root.tts.isPlaying);
      break;
    }
    case "sensor_limits": {
      scenario.runtime();
      scenario.after(.3, () => { scenario.press(scenario.button("Capabilities button")); });
      let off = false, low = false, high = false;
      scenario.after(.6, () => scenario.press(menu.lidarButtons[0]));
      scenario.after(.8, () => { off = ui.getLidarMode() === "off"; scenario.press(menu.lidarButtons[2]); });
      for (let i = 0; i < 24; i++) {
        scenario.after(1 + i * .05, () => scenario.press(scenario.button("Sensor-1:-1")));
        scenario.after(2.5 + i * .05, () => scenario.press(scenario.button("Sensor-1:1")));
      }
      scenario.after(2.3, () => { low = ui.getLidarPreferences().pointLimit === 250; });
      scenario.after(3.8, () => { high = ui.getLidarPreferences().pointLimit === 4000; });
      scenario.later(4, () => off && low && high && ui.getLidarPreferences().fullRangeM <= 10);
      break;
    }
    case "viewport_aspect": {
      scenario.runtime();
      scenario.press(scenario.button("Global settings"));
      const frame = getFrameComponent(ui.mainUIFrame)!;
      frame.setFollowing(false);
      const width = frame.totalSize.x;
      const controlWidth = menu.debug.button.size.x;
      const debugBefore = ui.getDebugMode();
      scenario.after(0.4, () => scenario.emit({ type: "host", action: "resize_viewport", variant: "wide", width: 1280, height: 923 }));
      scenario.after(1.6, () => scenario.emit({ type: "host", action: "resize_viewport", variant: "portrait", width: 1024, height: 923 }));
      scenario.after(2.8, () => scenario.press(menu.debug.button));
      const worldWidth = width * ui.mainUIFrame.getTransform().getWorldScale().x;
      scenario.later(3.2, () => {
        const camera = root.cameraObject.getComponent("Component.Camera") as Camera;
        const transform = ui.mainUIFrame.getTransform().getWorldTransform();
        const points = [-45, 45].flatMap(x => [-frame.totalSize.y / 2, frame.totalSize.y / 2].map(y =>
          camera.worldSpaceToScreenSpace(transform.multiplyPoint(new vec3(x, y, 0)))));
        return Math.abs(frame.totalSize.x - width) < 0.01 &&
          Math.abs(frame.totalSize.x * ui.mainUIFrame.getTransform().getWorldScale().x - worldWidth) < 0.01 &&
          menu.debug.button.size.x === controlWidth &&
          points.every(point => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1) &&
          ui.getDebugMode() !== debugBefore;
      });
      break;
    }
    case "pin_ip_switch": {
      controller.start(true);
      ui.mainUIFrame.enabled = false;
      let ip = false;
      scenario.after(.4, () => { scenario.press(controller.view.connectionToggle.button); ip = controller._connectionMethod === "ip" && controller.view.input.placeholderText.includes("IP"); });
      scenario.after(.8, () => scenario.press(controller.view.connectionToggle.button));
      scenario.later(1.2, () => {
        const mode = controller.view.connectionToggle;
        const field = controller.view.input;
        return ip && controller._connectionMethod === "pin" && field.placeholderText.includes("PIN") &&
          mode.button.style === "Ghost" && mode.button.visual.cornerRadius === 0 &&
          Math.abs(field.getSceneObject().getTransform().getLocalPosition().x + field.getSize().x / 2 -
            (mode.sceneObject.getTransform().getLocalPosition().x - mode.button.size.x / 2)) < 0.01 &&
          !controller.view.retry.sceneObject.enabled;
      });
      break;
    }
    case "pin_error": {
      controller.start(true);
      ui.mainUIFrame.enabled = false;
      // Reproduce the platform keyboard lifecycle: text/Return alone does not
      // open an edit cycle, and each new submission needs its own cycle.
      const keyboard = controller.view.input.keyboardOptions;
      keyboard.onKeyboardStateChanged(true);
      keyboard.onTextChanged("12");
      keyboard.onReturnKeyPressed();
      keyboard.onKeyboardStateChanged(false);
      scenario.after(.3, () => {
        const invalid = controller.view.cardTitle.text.includes("6-digit PIN");
        scenario.check("pin-invalid-format", invalid, id);
        keyboard.onKeyboardStateChanged(true);
        keyboard.onTextChanged("123456");
        keyboard.onReturnKeyPressed();
        keyboard.onKeyboardStateChanged(false);
        // Allow the asynchronous relay result a natural frame even when native
        // frame stalls batch the scenario's previously scheduled callbacks.
        scenario.later(.6, () => {
          const unresolved = controller.view.cardTitle.text.includes("did not resolve");
          scenario.check("pin-unresolved", unresolved, id);
          return invalid && unresolved;
        }, id);
      });
      break;
    }
    case "compact_frames": {
      controller.invalidatePending();
      const tick = controller.tick.bind(controller);
      controller.tick = () => { };
      const frame = getFrameComponent(ui.setupWizardPanel)!;
      frame.setFollowing(false);
      const top = () => { const t = ui.setupWizardPanel.getTransform(); return t.getWorldPosition().add(t.getWorldRotation().multiplyVec3(new vec3(0, frame.totalSize.y * t.getWorldScale().y / 2, 0))); };
      const anchor = top();
      let valid = true;
      const follow = frame.followButton;
      const following = frame.following;
      const followEnabled = follow.interactable.enabled && follow.getSceneObject().isEnabledInHierarchy;
      scenario.press(follow); const toggled = frame.following !== following;
      scenario.press(follow); const restored = frame.following === following;
      valid &&= toggled && restored;
      print(`COMPACT_FOLLOW ${JSON.stringify({ followEnabled, toggled, restored, following })}`);
      const measure = (key: keyof typeof SETUP_LAYOUTS) => {
        const scale = ui.setupWizardPanel.getTransform().getWorldScale().y;
        const height = frame.totalSize.y, expectedHeight = SETUP_LAYOUTS[key].height;
        const diameter = follow.size.x * follow.getSceneObject().getTransform().getLocalScale().x;
        const topMovement = top().distance(anchor);
        const checks = { width: Math.abs(frame.totalSize.x - 90) < .01,
          height: Math.abs(height - expectedHeight) < .01,
          worldHeight: Math.abs(height * scale - expectedHeight * SETUP_PANEL_SCALE) < .01,
          followDiameter: Math.abs(diameter - 7.2) < .05, fixedTop: topMovement < .05 };
        valid &&= Object.values(checks).every(Boolean);
        print(`COMPACT_FRAME ${JSON.stringify({ key, width: frame.totalSize.x, height, expectedHeight, scale, expectedWorldHeight: expectedHeight * SETUP_PANEL_SCALE, worldHeight: height * scale, diameter, topMovement, checks })}`);
      };
      controller.view.setConnectionState({ phase: "error", text: "Fixture error", color: new vec4(1, .3, .3, 1) });
      scenario.after(.5, () => { controller.view.tick(.5); measure("error"); controller.view.setConnectionState({ phase: "connected", text: "Connected", details: "Ready to localize", color: vec4.one() }); });
      scenario.after(1, () => { controller.view.tick(.5); measure("connected"); controller.view.setCaptureLayout(false); controller.view.applyStepLayout(SetupWizardStep.Localization); });
      scenario.after(1.5, () => { controller.view.tick(.5); measure("message"); controller.view.celebrate(1, "Robot"); });
      scenario.after(2, () => { controller.view.tick(.5); measure("success"); scenario.check(id, valid, id); controller.tick = tick; });
      break;
    }
    case "native_audio_reset": {
      const audio = root.textToSpeechAudio, owner = audio.getSceneObject(), enabled = audio.enabled, ownerEnabled = owner.enabled;
      let safe = true;
      controller.start(true);
      const toggleConnection = () => {
        const before = controller._connectionMethod;
        scenario.press(controller.view.connectionToggle.button);
        safe &&= controller._connectionMethod !== before;
      };
      try {
        audio.enabled = false;
        root.tts.stop();
        safe &&= !root.tts.isPlaying;
        toggleConnection();
        audio.enabled = true;
        owner.enabled = false;
        root.tts.stop();
        safe &&= !root.tts.isPlaying;
        toggleConnection();
        owner.enabled = true;
        root.tts.stop();
        safe &&= !root.tts.isPlaying;
        toggleConnection();
      }
      finally {
        audio.enabled = enabled;
        owner.enabled = ownerEnabled;
      }
      scenario.check(id, safe);
      break;
    }
    default: throw new Error(`Unimplemented regression case ${id}`);
  }
}
