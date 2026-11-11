import { test, expect, type Page } from "@playwright/test";
import { join } from "node:path";
import { bootstrap, snapshot, shared, isNavigationCommit } from "./fixtures/Runtime";
import { Flow } from "./fixtures/Flow";
import { aimArm, clickArm, frameArm } from "./fixtures/ArmInput";
import {
  activateButton,
  activateRuntimeButton,
  pointRuntimeButton,
  setSelection,
  frameMenu,
  summonMenu,
  moveInput,
  touchButton,
} from "./fixtures/Input";

const appValue = async (page: Page, expression: string) =>
  page.evaluate((expression) => {
    const w = window as any,
      app = w.xb.core.scene.children.find(
        (o: any) => o.client?.manipulation,
      );
    return new Function("app", "w", `return (${expression})`)(app, w);
  }, expression);
async function worldView(page: Page) {
  await page.evaluate(() => {
    const w = window as any,
      app = w.xb.core.scene.children.find(
        (o: any) => o.client?.manipulation,
      );
    const center = app.client.robot.collider.getWorldPosition(app.client.robot.collider.position.clone());
    const target = center.clone().set(center.x + 0.25, app.client.robot.floorWorldY() + 0.22, center.z - 0.12);
    const eye = target.clone().add(target.clone().set(0, 0.72, 1.2));
    const direction = target.clone().sub(eye).normalize();
    const rotation = app.mainMenu.panel.quaternion.clone().setFromUnitVectors(target.clone().set(0, 0, -1), direction);
    w.questDevice.position.set(eye.x, eye.y, eye.z);
    w.questDevice.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    w.xb.core.scene.background = app.client.robot.collider.material.color
      .clone()
      .setHex(0x182028);
  });
  await page.waitForTimeout(150);
}
async function pointRobot(page: Page) {
  await page.evaluate(() => {
    const w = window as any,
      app = w.xb.core.scene.children.find(
        (o: any) => o.client?.manipulation,
      ),
      p = app.client.robot.collider.getWorldPosition(
        app.client.robot.collider.position.clone(),
      );
    const input = w.questDevice.hands.right;
    input.position.set(p.x, p.y, p.z + 0.8);
    input.quaternion.set(0, 0, 0, 1);
  });
  await expect
    .poll(() =>
      appValue(
        page,
        "app.interaction.hit(w.xb.core.input.rightController)?.object === app.client.robot.collider",
      ),
    )
    .toBe(true);
}
async function aimFloor(page: Page) {
  await page.evaluate(() => {
    const w = window as any,
      app = w.xb.core.scene.children.find(
        (o: any) => o.client?.manipulation,
      ),
      p = app.client.robot.worldPosition();
    const input = w.questDevice.hands.right;
    input.position.set(p[0] + 0.65, app.client.robot.floorWorldY() + 0.5, p[2]);
    input.quaternion.set(-Math.sin(Math.PI / 8), 0, 0, Math.cos(Math.PI / 8));
  });
  await page.waitForTimeout(180);
}

test.use({ video: { mode: "on", size: { width: 1280, height: 900 } } });

test("comparable hand golden path", async ({ page }, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const runtime = await bootstrap(page, "hand", { manipulation: true });
  const root = process.env.INTEGRATION_RESULTS_DIR ?? info.outputDir;
  const flow = new Flow(page, join(root, "golden"));
  const armValue = (expression: string) => appValue(page, `app.client.manipulation.${expression}`);
  const armCommands = (action: string) => runtime.commands.filter(c => c.type === "manipulation_request" && c.action === action);
  try {
    await frameMenu(page, true);
    await flow.start();
    await flow.step("setup_entry", async () => {}, async () => {
      const s = await snapshot(page);
      return s.wizardStep === "connect" && s.wizardCardTitle === "Connected to dimOS ARModule" && !s.setupCompleted;
    });
    await flow.step("localization_capture", () => activateButton(page), async () =>
      (await snapshot(page)).wizardStep === "localization" &&
      await appValue(page, "app.mainMenu.preview.userData.frameVersion > 0"));
    await flow.step("localization_success", async () => {
      await page.evaluate(() => { const w = window as any; w.questDevice.hands.right.position.set(0.8, 1.2, -0.3); });
      await runtime.completeLocalization();
    }, async () => !!(await snapshot(page)).setupCelebrating, { screenshotOffsetS: 0.9 });
    await flow.step("runtime_manual", async () => {
      await expect.poll(() => snapshot(page).then(s => !s.setupCelebrating)).toBe(true);
      await summonMenu(page);
      await frameMenu(page, true);
    }, async () => (await snapshot(page)).setupCompleted && (await snapshot(page)).operatingMode === "manual");
    await activateRuntimeButton(page, "Close");
    await worldView(page);
    await flow.step("robot_selected", async () => {
      await pointRobot(page);
      await setSelection(page, 1);
      await setSelection(page, 0);
    }, async () => !!(await snapshot(page)).robotSelected);
    await flow.step("relocalization", async () => {
      await appValue(page, "app.client.episode.requestCorrection()");
      await runtime.completeLocalization([0, 0.25, 0]);
    }, async () => await appValue(page,
      "app.client.robot.object.getObjectByName('MarkerCorrectionTrail').visible && Math.abs(app.client.robot.object.position.x - 0.25) < 0.001"),
    { screenshotOffsetS: 0.05 });
    expect(await appValue(page, "app.client.robot.object.getObjectByName('MarkerCorrectionTrail').visible")).toBe(false);
    const goals = runtime.commands.filter(isNavigationCommit).length;
    await flow.step("navigation_preview", async () => {
      await aimFloor(page);
      await setSelection(page, 1);
      await setSelection(page, 0);
    }, async () => await appValue(page, "app.client.navigation.isAiming() && app.client.previewRoute.object.visible") &&
      runtime.commands.filter(isNavigationCommit).length === goals);
    await flow.step("navigation_route", async () => {
      await setSelection(page, 1);
      await moveInput(page, [0.2, 0, 0], 500);
      await setSelection(page, 0);
    }, async () => runtime.commands.filter(isNavigationCommit).length > goals &&
      await appValue(page, "app.client.route.object.visible"));
    await flow.step("navigation_success", async () => runtime.state("resolved", "succeeded"),
      async () => await appValue(page, "app.client.navigation.flash() === 'succeeded'"), { screenshotOffsetS: 0.38 });
    await summonMenu(page);
    await frameMenu(page, true);
    await flow.step("agent_response", async () => {
      await touchButton(page, "Agent");
      await pointRuntimeButton(page, "Agent dictation field");
      await setSelection(page, 1);
      await page.evaluate(text => (window as any).integrationTranscript(text, false), shared.fixtures.transcript);
      await expect.poll(() => appValue(page, "app.client.speech.snapshot().status === 'Listening'")).toBe(true);
      await setSelection(page, 0);
      await expect.poll(() => appValue(page, "app.client.speech.snapshot().prompt.length > 0")).toBe(true);
      expect(runtime.commands.some(c => c.type === "user_message_request")).toBe(false);
      await activateRuntimeButton(page, "Send to agent");
    }, async () => runtime.commands.some(c => c.type === "user_message_request" && c.text === shared.fixtures.transcript) &&
      await appValue(page, "app.mainMenu.agent.text.includes('requested location')"));
    await flow.step("sensors_full", async () => {
      await activateRuntimeButton(page, "Manual");
      await activateRuntimeButton(page, "Capabilities button");
      await activateRuntimeButton(page, "Full");
      runtime.lidar();
    }, async () => (await snapshot(page)).lidarMode === "full");
    await activateRuntimeButton(page, "Off");
    await activateRuntimeButton(page, "Back from Sensors");
    await activateRuntimeButton(page, "Close");
    if ((await snapshot(page)).robotSelected) {
      await pointRobot(page);
      await setSelection(page, 1); await setSelection(page, 0);
    }
    await flow.step("manipulation_select", async () => {
      await runtime.enableManipulation();
      await expect.poll(() => armValue("interaction.snapshot().canManipulate")).toBe(true);
      await expect.poll(() => armValue("renderer.modelRenderer.ghosts.size")).toBeGreaterThan(0);
      await frameArm(page);
      await clickArm(page, "base");
    }, async () => !!(await snapshot(page)).robotSelected &&
      await armValue("renderer.handle.object.visible"));
    await flow.step("manipulation_preview", async () => {
      await aimArm(page, "handle");
      await setSelection(page, 1);
      await expect.poll(() => armValue("interaction.dragging")).toBe(true);
      await moveInput(page, [-0.03, 0.06, 0], 600);
      await expect.poll(() => armValue("interaction.previewJoints !== null")).toBe(true);
      expect(armCommands("evaluate").length).toBeGreaterThan(0);
      expect(armCommands("execute")).toHaveLength(0);
      await setSelection(page, 0);
      await expect.poll(() => armValue("interaction.plan !== null")).toBe(true);
      await clickArm(page, "plan");
      await expect.poll(() => armValue("renderer.previewRequested")).toBe(true);
    }, async () => armCommands("plan").length > 0 && await armValue("renderer.path.visible"));
    let reviewedPlan = "";
    await flow.step("manipulation_execute", async () => {
      reviewedPlan = await armValue("interaction.plan.plan_id");
      await clickArm(page, "execute");
      await expect.poll(() => armCommands("execute").at(-1)?.plan_id).toBe(reviewedPlan);
    }, async () => await appValue(page, "app.client.session.view().manipulation?.execution === 'completed'") &&
      await armValue("interaction.snapshot().executing === false"));
    await flow.step("manipulation_following", async () => {
      await clickArm(page, "base");
      expect((await snapshot(page)).robotSelected).toBe(false);
      await aimArm(page, "handle");
      await setSelection(page, 1);
      await expect.poll(() => armValue("interaction.following")).toBe(true);
      await moveInput(page, [0.03, 0.04, 0], 600);
      await expect.poll(() => armValue("interaction.previewJoints !== null")).toBe(true);
      await setSelection(page, 0);
      await expect.poll(() => appValue(page, "app.client.session.view().manipulation?.following_tail !== null")).toBe(true);
    }, async () => await appValue(page, "app.client.session.view().manipulation?.following === false && app.client.session.view().manipulation?.following_tail === null") &&
      await armValue("interaction.dragging === false"));
    await flow.step("manipulation_controls", async () => {
      await clickArm(page, "gripper");
      await expect.poll(() => armCommands("gripper").length).toBeGreaterThan(0);
      const cancelled = armCommands("cancel").length;
      await clickArm(page, "stop");
      await expect.poll(() => armCommands("cancel").length).toBeGreaterThan(cancelled);
      await clickArm(page, "estop");
      await expect.poll(() => appValue(page, "app.client.session.view().manipulation?.stopped")).toBe(true);
      await clickArm(page, "estop");
      await expect.poll(() => armCommands("resume").length).toBeGreaterThan(0);
    }, async () => await appValue(page, "app.client.session.view().manipulation?.stopped === false") &&
      await armValue("interaction.snapshot().canManipulate"));
    expect(armCommands("execute")).toHaveLength(1);
    expect(armCommands("execute")[0].plan_id).toBe(reviewedPlan);
    expect(errors).toEqual([]);
  } finally {
    await flow.save(info);
  }
});
