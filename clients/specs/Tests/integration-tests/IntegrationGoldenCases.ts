import { integrationTestsEnabled } from "../Scripts/Integration Test Harness";
// Hardware inputs are deterministic fixtures. Production state owners, SIK/SUK controls and renderers run unchanged.
import { availableCapabilityLabels } from "../Scripts/DimOSARClient/presentation/ControlPanelPresentation";
import { FLOOR_MARKER_STYLE } from "../Scripts/DimOSARClient/presentation/WorldVisualStyle";
import { RUNTIME_LAYOUTS,RUNTIME_PANEL_SCALE,SETUP_LAYOUTS } from "../Scripts/DimOSSpecsClient/presentation/PanelLayout";
import { getFrameComponent } from "../Scripts/DimOSSpecsClient/presentation/UIKit";
import { WristMenuController } from "../Scripts/DimOSSpecsClient/presentation/WristMenuController";
import { IntegrationArmGolden } from "./IntegrationArmGolden";
import { INTEGRATION_CATALOG as CATALOG } from "./IntegrationCatalog";
import type { ReviewScenario } from "./IntegrationScenario";

/** Case actions share the scenario's fixture, scheduler and assertion owner. */
export function runGoldenCase(scenario: ReviewScenario, id: string): void {
  if (!integrationTestsEnabled(scenario.getSceneObject())) return;
  const root = scenario.root, ui = root.uiPresenter, menu = ui.mainMenuView, controller = ui.setupWizardController;
  if (id.startsWith("manipulation_")) {
    if (!scenario.armGolden) {
      root.session.stop();
      const yes = { available: true, reason: null }, no = { available: false, reason: "Stationary arm" };
      scenario.caps = { ...scenario.caps, manipulation: yes, agent: no, lidar: no,
        navigation: { ...no, nav_goal: { ...no, preview: false }, nav_joystick: no } };
      scenario.ready(scenario.caps); scenario.runtime(); scenario.worldOnly();
      scenario.worldCamera = false; // Arm framing is owned by the golden helper until completion.
      scenario.armGolden = new IntegrationArmGolden(root, scenario.peer, scenario.input!,
        (delay, action) => scenario.after(delay, action), passed => scenario.check(scenario.activeCase, passed));
      scenario.armGolden.tick();
    }
    scenario.armGolden.chapter(id, action => { scenario.move = action; });
    return;
  }
  switch (id) {
    case "setup_entry":
      scenario.headerMetrics();
      scenario.check(id, controller.isVisible() && controller.flow.step === "connect" && !controller.view.previous.sceneObject.enabled &&
        controller.view.description.text === "" && !controller.view.description.getSceneObject().enabled &&
        controller.view.heightController.target === SETUP_LAYOUTS.entry.height);
      break;
    case "connection_ready":
      scenario.ready();
      scenario.later(1.2, () => {
        const view = controller.view, session = root.session.view();
        const labels = availableCapabilityLabels(session.capabilities);
        const runs = view.capabilityRuns as Text[];
        const completeLabels = runs.map(run => run.text.replace(/, $/, ""));
        const positions = runs.map(run => run.getSceneObject().getTransform().getLocalPosition());
        const bounds = runs.every((run, index) => {
          const box = run.getBoundingBox(), left = positions[index].x + box.left;
          return box.getSize().x > 0 && left >= -40.01 && left + box.getSize().x <= 40.01;
        });
        const fonts = runs.every((run, index) => {
          const principal = ["Navigation", "Manipulation", "Localization"].includes(completeLabels[index]);
          return run.font.name.includes(principal ? "Inter-Semibold" : "Inter-Regular");
        });
        scenario.emit({ type: "capability-summary", labels: completeLabels,
          fonts: runs.map(run => run.font.name), lines: [...new Set(positions.map(position => position.y))], bounds });
        return session.connection === "ready" && session.hello.robot.display_name === CATALOG.fixtures.robot.display_name &&
          view.cardBody.text === `Robot: ${CATALOG.fixtures.robot.display_name}` &&
          view.capabilityHeading.text === "Capabilities:" && view.capabilitiesRoot.isEnabledInHierarchy &&
          !view.description.getSceneObject().enabled && JSON.stringify(completeLabels) === JSON.stringify(labels) &&
          new Set(positions.map(position => position.y)).size <= 2 && fonts && bounds;
      });
      break;
    case "localization_capture":
      scenario.ready();
      scenario.after(.3, () => scenario.press(controller.view.next.button));
      // Three 0.5-second-spaced frames plus UI/request dispatch must settle
      // before this assertion; 1.5 seconds races the final asynchronous frame.
      scenario.later(2.5, () => {
        const phase = root.episode.view().phase;
        scenario.emit({ type: "diagnostic", caseId: id, name: "capture-state",
          step: controller.flow.step, preview: controller.view.previewRoot.enabled,
          batches: scenario.batches.length, phase });
        return controller.flow.step === "localization" && controller.view.previewRoot.enabled &&
          scenario.batches.length > 0 && phase === "awaiting_result";
      });
      break;
    case "localization_success":
      scenario.acceptLocalization();
      scenario.later(0.4, () => root.clientTrackingOriginStore.hasTrackingOrigin && controller.view.success.enabled && controller.view.successCheck.object.enabled);
      break;
    case "runtime_manual":
      scenario.showMenu();
      scenario.later(0.4, () => ui.isSetupCompleted() && ui.getOperatingMode() === "manual" && menu.manual.enabled &&
        Math.abs(getFrameComponent(ui.mainUIFrame)!.totalSize.y - RUNTIME_LAYOUTS.manual.height) < 0.01);
      break;
    case "panel_follow": {
      const frame = getFrameComponent(ui.mainUIFrame)!;
      const panel = ui.mainUIFrame.getTransform(), initial = panel.getWorldPosition();
      const viewer = global.scene.createSceneObject("FixtureMenuViewer");
      viewer.getTransform().setWorldPosition(root.cameraObject.getTransform().getWorldPosition());
      viewer.getTransform().setWorldRotation(root.cameraObject.getTransform().getWorldRotation());
      const forward = viewer.getTransform().getWorldRotation().multiplyVec3(new vec3(0, 0, -1));
      const length = Math.hypot(forward.x, forward.z) || 1;
      const offset = new vec3(forward.x / length * 18, 0, forward.z / length * 18);
      const centerOffset = (76 - frame.totalSize.y) * RUNTIME_PANEL_SCALE / 2;
      const wrist = initial.sub(new vec3(0, 20 + centerOffset, 0)).sub(offset);
      let facing = true, closed = false, headStayed = false;
      const hand = { isTracked: () => true, getPalmPitchAngle: () => facing ? 45 : -80,
        isFacingCamera: () => facing, wrist: { position: wrist } };
      let initialized = false;
      menu.applySpectaclesFrameMotion();
      scenario.wristFixture = new WristMenuController({ panel: ui.mainUIFrame, anchorRoot: ui.mainUIFrame,
        cameraObject: viewer, hands: { left: hand, right: { ...hand, isTracked: () => false } } as any,
        centerOffsetCm: () => (76 - frame.totalSize.y) * RUNTIME_PANEL_SCALE / 2,
        onBeforeShow: () => menu.applySpectaclesFrameMotion(),
        onMenuShow: () => { menu.placed(); ui.setUIState(1, { immediate: true }); },
        onMenuHide: () => { if (initialized) { closed = true; ui.setUIState(0, { immediate: true }); } },
        onPin: () => menu.setFrameFollowEnabled(false),
      });
      initialized = true;
      frame.onTranslationStart.add(() => scenario.wristFixture?.pin());
      let baseline = initial;
      scenario.after(.6, () => { baseline = panel.getWorldPosition(); viewer.getTransform().setWorldPosition(new vec3(8, 0, 0)); });
      scenario.after(1.2, () => { headStayed = panel.getWorldPosition().distance(baseline) < .2; });
      const x = wrist.x;
      scenario.move = t => { if (t > .27 && t < .53) wrist.x = x + Math.min(6, (t - .27) * 24); };
      scenario.after(2.6, () => { facing = false; });
      scenario.after(3.2, () => { facing = true; });
      scenario.later(4.4, () => headStayed && panel.getWorldPosition().distance(baseline) > 2 && closed &&
        scenario.wristFixture?.sourceHand() === "left" && !frame.following);
      scenario.after(4.5, () => scenario.emit({type:"result",caseId:id,name:"native-hand-follow-cm",passed:headStayed && panel.getWorldPosition().distance(baseline) > 2,
        movedCm:panel.getWorldPosition().distance(baseline),headOnlyTranslation:!headStayed}));
      break;
    }
    case "panel_grab": {
      const frame: any = getFrameComponent(ui.mainUIFrame), panel = ui.mainUIFrame.getTransform();
      const initial = panel.getWorldPosition(), eye = root.cameraObject.getTransform().getWorldPosition();
      const hit = panel.getWorldTransform().multiplyPoint(new vec3(44, 0, 0));
      scenario.input!.active = true;
      scenario.input!.ray(eye, hit, frame._interactable);
      scenario.input!.hover(frame._interactable);
      scenario.after(0.3, () => scenario.input!.start());
      scenario.move = t => {
        if (t < 0.07 || t > 0.8)
          return;
        const offset = new vec3(Math.min(4, t * 7), 0, 0);
        scenario.input!.ray(eye.add(offset), hit.add(offset), frame._interactable);
      };
      scenario.after(4, () => {
        scenario.input!.end();
        scenario.input!.unhover();
        scenario.input!.active = false;
        scenario.check(id, panel.getWorldPosition().distance(initial) > 2 && !frame.following && scenario.wristFixture?.isPinned() === true, id);
        scenario.wristFixture = null;
      });
      break;
    }
    case "robot_hover": {
      scenario.worldOnly();
      const visual = root.robotPresenter.worldVisuals;
      scenario.input!.active = true;
      scenario.input!.ray(root.cameraObject.getTransform().getWorldPosition(), root.robotPresenter.worldPosition(), visual.interactable);
      scenario.input!.hover(visual.interactable);
      scenario.later(0.6, () => !root.selection.isSelected() && visual.hovered && visual.outline.object.enabled);
      break;
    }
    case "robot_selected":
      scenario.worldOnly();
      scenario.press(root.robotPresenter.worldVisuals);
      scenario.check(id, root.selection.isSelected());
      scenario.input!.unhover();
      break;
    case "relocalization": {
      scenario.worldOnly();
      const before = root.robotPresenter.worldPosition() as vec3;
      root.episode.requestCorrection();
      let corrected = false;
      scenario.after(2.6, () => {
        // The native fixture derives its origin from the editor camera placement.
        scenario.origin = scenario.origin.map((v, i) => v + (i === 1 ? 0.25 : 0));
        scenario.acceptLocalization();
      });
      scenario.after(2.75, () => {
        const copy = root.robotPresenter.worldVisuals.correction.sphere.object as SceneObject;
        corrected = copy.enabled && copy.getTransform().getWorldPosition().distance(root.robotPresenter.worldPosition()) > 1 &&
          root.robotPresenter.worldVisuals.correction.stem.object.enabled &&
          !copy.getComponent("Physics.ColliderComponent");
      });
      scenario.later(3.5, () => corrected && !root.robotPresenter.worldVisuals.correction.sphere.object.enabled &&
        root.robotPresenter.worldPosition().distance(before) > 20 && root.robotPresenter.worldPosition().distance(before) < 26 &&
        root.clientTrackingOriginStore.T_odom_client.position[1] === scenario.origin[1]);
      break;
    }
    case "navigation_preview": {
      const before = scenario.count("interaction_request", row => row.action === "confirm");
      scenario.aim();
      scenario.after(0.2, () => scenario.input!.start(null));
      scenario.later(0.8, () => root.navigationController.isAiming() && root.navigationController.previewPath()?.length >= 2 &&
        scenario.count("interaction_request", row => row.action === "confirm") === before &&
        Math.abs(root.navigationController.draftCircleBounds().radius - FLOOR_MARKER_STYLE.radiusM * 100 * 1.15) < .01 &&
        Math.abs(scenario.measuredCircleRadius(root.navigationController.draftMarker.worldVisuals) - FLOOR_MARKER_STYLE.radiusM * 100 * 1.15) < .02 &&
        root.navigationController.draftMarker.worldVisuals.draftCircle.object.enabled &&
        root.navigationController.draftMarker.worldVisuals.arrow.object.enabled &&
        !root.navigationController.draftMarker.worldVisuals.circle.object.enabled);
      break;
    }
    case "navigation_drag": {
      const before = scenario.count("interaction_request", row => row.action === "confirm");
      const start = [...scenario.goal];
      scenario.aim(start);
      scenario.move = t => { scenario.goal = [start[0] + Math.min(0.3, t * 0.5), start[1], start[2]]; scenario.aim(); };
      scenario.after(2.4, () => {
        scenario.input!.end();
        scenario.check(id, root.navigationController.ownsDraft(String(scenario.input!.actor.inputType)) &&
          Math.abs(root.navigationController.interaction.snapshot().draft.position[0] - (start[0] - scenario.origin[0])) > 0.05 &&
          scenario.count("interaction_request", row => row.action === "confirm") === before, id);
      });
      break;
    }
    case "navigation_route": {
      const before = scenario.count("interaction_request", row => row.action === "confirm");
      scenario.input!.end();
      scenario.after(.25, () => scenario.input!.start(root.robotPresenter.worldVisuals.interactable));
      scenario.after(0.55, () => scenario.input!.end());
      scenario.after(1, () => {
        scenario.input!.active = false;
        scenario.check(id, scenario.count("interaction_request", row => row.action === "confirm") === before + 1 &&
          root.selection.isSelected() && root.navigationController.activePath()?.length >= 2 && root.navGoalPresenter.ribbon.object.enabled, id);
      });
      break;
    }
    case "robot_movement": {
      const initial = root.robotPresenter.worldPosition(), pose = CATALOG.fixtures.pose;
      scenario.move = t => scenario.pose([pose[0] + 0.6 * t, pose[1] + 0.15 * t, pose[2]]);
      scenario.later(3.9, () => root.robotPresenter.worldPosition().distance(initial) > 30 && root.navigationController.activePath()?.length >= 2);
      break;
    }
    case "navigation_success":
      scenario.state("resolved", "succeeded");
      scenario.later(0.42, () => root.navigationController.flash() === "succeeded" && root.navigationController.marker.worldVisuals.glyph.object.enabled);
      break;
    case "navigation_cancelled": {
      scenario.goal = [scenario.goal[0] + 0.4, scenario.goal[1], scenario.goal[2]];
      const before = scenario.count("estop_request");
      scenario.startGoal();
      scenario.after(1.1, () => {
        scenario.press(root.navigationController.marker.cancelButton);
        scenario.check(id, scenario.count("estop_request") === before + 1 && root.navigationController.flash() === "cancelled", id);
        scenario.input!.active = false;
      });
      break;
    }
    case "agent_recording": {
      scenario.input!.active = false;
      scenario.showMenu();
      const before = scenario.count("user_message_request");
      scenario.after(0.2, () => scenario.press(menu.modeButtons[1]));
      scenario.after(0.9, () => {
        scenario.input!.active = true;
        scenario.input!.target = menu.draft.window.interactable;
        scenario.input!.hover(scenario.input!.target!);
        scenario.input!.start();
        scenario.recognitionText?.(CATALOG.fixtures.transcript, false);
      });
      scenario.later(1.3, () => root.speechController.asrRunning && scenario.count("user_message_request") === before);
      break;
    }
    case "agent_draft": {
      const before = scenario.count("user_message_request");
      scenario.input!.end();
      scenario.input!.unhover();
      scenario.later(0.4, () => !root.speechController.asrRunning && root.speechController.snapshot().prompt === CATALOG.fixtures.transcript &&
        scenario.count("user_message_request") === before);
      break;
    }
    case "agent_response": {
      const before = scenario.count("user_message_request");
      runGoldenCase(scenario, "agent_recording");
      scenario.after(1.5, () => { scenario.input!.end(); scenario.input!.unhover(); });
      scenario.after(1.9, () => scenario.press(menu.send));
      scenario.after(2.1, () => scenario.wire({ type: "agent_message", text: CATALOG.fixtures.response }));
      scenario.later(2.6, () => scenario.count("user_message_request") === before + 1 && root.speechController.snapshot().response === CATALOG.fixtures.response && menu.reply.text.text === CATALOG.fixtures.response);
      break;
    }
    case "sensors_full":
      scenario.press(scenario.button("Capabilities button"));
      scenario.after(0.2, () => scenario.press(menu.lidarButtons[2]));
      scenario.lidar();
      scenario.later(0.7, () => menu.page === "sensors" && ui.getLidarMode() === "full" && root.session.view().lidar.points.length === CATALOG.fixtures.pointLimit && root.lidarPresenter.visual.enabled);
      break;
    case "sensors_obstacles": {
      scenario.press(menu.lidarButtons[1]);
      const before = ui.getLidarPreferences().obstacleRangeM;
      scenario.after(0.2, () => scenario.press(scenario.button("Sensor8:1")));
      scenario.later(0.6, () => ui.getLidarMode() === "obstacles" && ui.getLidarPreferences().obstacleRangeM > before && menu.rangeLabel.text === "Clearance");
      break;
    }
    case "settings":
      scenario.press(scenario.button("Back from Sensors"));
      scenario.after(0.2, () => scenario.press(scenario.button("Global settings")));
      scenario.after(0.5, () => { scenario.press(menu.debug.button); scenario.press(scenario.button("Sound")); });
      scenario.later(0.8, () => menu.page === "settings" && ui.getDebugMode() && !menu.soundEnabled && menu.debug.button.style === "Primary");
      break;
    case "diagnostics": {
      const timing = root.episode.timing.bind(root.episode);
      root.episode.timing = () => ({ ...timing(), fixtureEvents: Array.from({ length: 30 }, (_, i) => `Capture phase ${i}: recorded timing detail`).join("\n") });
      scenario.press(scenario.button("Diagnostics"));
      scenario.after(0.6, () => { menu.diagnostics.window.scrollPositionNormalized = new vec2(0, -1); });
      scenario.later(1, () => menu.page === "diagnostics" && menu.diagnostics.window.scrollDimensions.y > menu.diagnostics.window.windowSize.y && menu.diagnostics.window.scrollPositionNormalized.y < -0.9);
      break;
    }
    case "world_marker": {
      scenario.worldOnly();
      const place = (title: string) => scenario.wire({ type: "agent_skill", name: "ar_place_marker",
        args: { id: "integration-door", title, x: scenario.goal[0], y: scenario.goal[1], z: 0.7 } });
      const rendered = () => root.annotations._entries.get("integration-door")?.visual?.title;
      place("Doorway");
      let original: Text | null = null, initialTitle = false, updatedTitle = false;
      scenario.after(.3, () => { original = rendered(); initialTitle = original?.text === "Doorway"; place("Doorway updated"); });
      scenario.after(.6, () => {
        updatedTitle = rendered() === original && rendered()?.text === "Doorway updated";
        place("Doorway");
        root.annotations.recompose(root.clientTrackingOriginStore.T_odom_client);
      });
      scenario.later(.9, () => root.annotations.size() === 1 && initialTitle && updatedTitle &&
        rendered() === original && rendered()?.text === "Doorway");
      break;
    }
    case "relocalize":
      scenario.showMenu();
      scenario.autoLocalize = true;
      scenario.after(0.2, () => scenario.press(scenario.button("Capabilities button")));
      scenario.after(0.4, () => scenario.press(menu.realign.button));
      scenario.later(0.7, () => controller.isVisible() && controller.flow.step === "localization" && !root.clientTrackingOriginStore.hasTrackingOrigin);
      break;
    case "setup_restart": {
      const baseline = root.clientTrackingOriginStore.T_odom_client;
      scenario.showMenu();
      scenario.after(.2, () => scenario.press(scenario.button("Global settings")));
      scenario.after(.4, () => scenario.press(scenario.button("Setup")));
      scenario.after(.8, () => scenario.check("restart-connect-back", !ui.isSetupCompleted() && controller.isVisible() &&
        controller.flow.step === "connect" && controller.view.previous.sceneObject.enabled, id));
      scenario.after(2, () => scenario.press(controller.view.previous.button));
      scenario.later(2.4, () => ui.isSetupCompleted() && menu.page === "main" &&
        root.clientTrackingOriginStore.hasTrackingOrigin &&
        root.clientTrackingOriginStore.T_odom_client.position.every((v: number,i: number) => v === baseline.position[i]));
      break;
    }
    default: throw new Error(`Unimplemented golden case ${id}`);
  }
}
