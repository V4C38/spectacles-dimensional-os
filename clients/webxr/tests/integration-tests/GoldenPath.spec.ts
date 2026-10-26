import { test, expect, type Page } from "@playwright/test";
import { join } from "node:path";
import { bootstrap, snapshot, shared } from "./fixtures/Runtime";
import { Flow } from "./fixtures/Flow";
import {
  activateButton,
  activateRuntimeButton,
  pointRuntimeButton,
  setSelection,
  frameMenu,
  summonMenu,
  moveInput,
  scrollResponse,
} from "./fixtures/Input";

const appValue = async (page: Page, expression: string) =>
  page.evaluate((expression) => {
    const w = window as any,
      app = w.xb.core.scene.children.find(
        (o: any) => o.constructor.name === "WebXRApp",
      );
    return new Function("app", "w", `return (${expression})`)(app, w);
  }, expression);
async function worldView(page: Page) {
  await page.evaluate(() => {
    const w = window as any,
      app = w.xb.core.scene.children.find(
        (o: any) => o.constructor.name === "WebXRApp",
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
        (o: any) => o.constructor.name === "WebXRApp",
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
        (o: any) => o.constructor.name === "WebXRApp",
      ),
      p = app.client.robot.worldPosition();
    const input = w.questDevice.hands.right;
    input.position.set(p[0] + 0.65, app.client.robot.floorWorldY() + 0.5, p[2]);
    input.quaternion.set(-Math.sin(Math.PI / 8), 0, 0, Math.cos(Math.PI / 8));
  });
  await page.waitForTimeout(180);
}

test("comparable hand golden path", async ({ page }, info) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const runtime = await bootstrap(page);
  const root = process.env.INTEGRATION_RESULTS_DIR ?? info.outputDir;
  const flow = new Flow(page, join(root, "golden"));
  try {
    await frameMenu(page, true);
    await flow.start();
    await flow.step(
      "setup_entry",
      async () => {},
      async () =>
        (await snapshot(page)).wizardStep === "connect" &&
        !(await snapshot(page)).setupCompleted,
    );
    await flow.step(
      "connection_ready",
      async () => {},
      async () =>
        (await snapshot(page)).wizardCardTitle ===
        "Connected to dimOS ARModule",
    );
    await flow.step(
      "localization_capture",
      async () => {
        await activateButton(page);
      },
      async () =>
        (await snapshot(page)).wizardStep === "localization" &&
        (await appValue(
          page,
          "app.mainMenu.preview.userData.frameVersion > 0",
        )),
    );
    await flow.step(
      "localization_success",
      async () => {
        await page.evaluate(() => { const w = window as any; w.questDevice.hands.right.position.set(0.8, 1.2, -0.3); w.questDevice.hands.right.quaternion.set(0, 0, 0, 1); });
        await runtime.completeLocalization();
      },
      async () => !!(await snapshot(page)).setupCelebrating,
      { screenshotOffsetS: 0.9 },
    );
    await flow.step(
      "runtime_manual",
      async () => {
        await expect
          .poll(() => snapshot(page).then((s) => !s.setupCelebrating))
          .toBe(true);
        await summonMenu(page);
        await frameMenu(page, true);
      },
      async () =>
        (await snapshot(page)).setupCompleted &&
        (await snapshot(page)).operatingMode === "manual",
    );
    let panelX = 0;
    await flow.step(
      "panel_follow",
      async () => {
        await frameMenu(page);
        panelX = await appValue(page, "app.mainMenu.panel.position.x");
        await moveInput(page, [0.12, 0, 0], 900, "left");
      },
      async () =>
        (await appValue(page, "app.mainMenu.panel.position.x")) > panelX + 0.08,
    );
    await flow.step(
      "panel_grab",
      async () => {
        await frameMenu(page);
        await page.evaluate(() => {
          const w = window as any,
            app = w.xb.core.scene.children.find(
              (o: any) => o.constructor.name === "WebXRApp",
            ),
            p = app.mainMenu.barZone.getWorldPosition(
              app.mainMenu.panel.position.clone(),
            );
          const q = app.mainMenu.panel.getWorldQuaternion(
            app.mainMenu.panel.quaternion.clone(),
          );
          p.addScaledVector(p.clone().set(0, 0, 1).applyQuaternion(q), 0.4);
          w.questDevice.hands.right.position.set(p.x, p.y, p.z);
          w.questDevice.hands.right.quaternion.set(q.x, q.y, q.z, q.w);
        });
        await expect
          .poll(() =>
            appValue(
              page,
              "app.interaction.hit(w.xb.core.input.rightController)?.object === app.mainMenu.barZone",
            ),
          )
          .toBe(true);
        await setSelection(page, 1);
        await moveInput(page, [0.1, 0.04, 0], 1000);
        await setSelection(page, 0);
      },
      async () =>
        await appValue(
          page,
          "app.menuAnchor.source === null && !app.panelHold",
        ),
    );
    await activateRuntimeButton(page, "Close");
    await worldView(page);
    await flow.step(
      "robot_hover",
      async () => {
        await pointRobot(page);
      },
      async () =>
        !(await snapshot(page)).robotSelected &&
        (await appValue(
          page,
          "app.client.robot.object.getObjectByName('Robot selection outline').material.opacity >= 0.44",
        )),
    );
    await flow.step(
      "robot_selected",
      async () => {
        await setSelection(page, 1);
        await setSelection(page, 0);
      },
      async () => !!(await snapshot(page)).robotSelected,
    );
    let goals = runtime.commands.filter(
      (c) => c.type === "nav_goal_request" && !c.preview,
    ).length;
    await flow.step(
      "navigation_preview",
      async () => {
        await aimFloor(page);
        await setSelection(page, 1);
        await setSelection(page, 0);
      },
      async () =>
        (await appValue(
          page,
          "app.client.navigation.isAiming() && app.client.previewRoute.object.visible",
        )) &&
        runtime.commands.filter(
          (c) => c.type === "nav_goal_request" && !c.preview,
        ).length === goals,
    );
    await flow.step(
      "navigation_drag",
      async () => {
        await setSelection(page, 1);
        await moveInput(page, [0.2, 0, 0], 850);
      },
      async () => !!(await appValue(page, "app.worldHold")),
    );
    await flow.step(
      "navigation_route",
      async () => {
        await setSelection(page, 0);
      },
      async () =>
        runtime.commands.filter(
          (c) => c.type === "nav_goal_request" && !c.preview,
        ).length > goals &&
        (await appValue(page, "app.client.route.object.visible")),
    );
    await flow.step(
      "robot_movement",
      async () => {
        for (let i = 0; i <= 12; i++) {
          runtime.send({
            type: "pose",
            position: [2 + i / 24, i / 48, 0.33],
            orientation: [0, 0, 0, 1],
            ts: Date.now() / 1000,
          });
          await page.waitForTimeout(80);
        }
      },
      async () =>
        await appValue(
          page,
          "app.client.session.view().pose.position[0] >= 2.5",
        ),
    );
    await flow.step(
      "navigation_success",
      async () => runtime.state("resolved", "succeeded"),
      async () =>
        await appValue(page, "app.client.navigation.flash() === 'succeeded'"),
      { screenshotOffsetS: 0.38 },
    );
    await flow.step(
      "navigation_cancelled",
      async () => {
        await aimFloor(page);
        await setSelection(page, 1);
        await setSelection(page, 0);
        await setSelection(page, 1);
        await setSelection(page, 0);
        await expect
          .poll(() =>
            appValue(page, "app.client.navigation.marker.cancelVisible()"),
          )
          .toBe(true);
        await page.evaluate(() => {
          const w = window as any,
            app = w.xb.core.scene.children.find(
              (o: any) => o.constructor.name === "WebXRApp",
            ),
            button = app.client.navigation.marker.cancelObject,
            p = button.getWorldPosition(button.position.clone());
          w.questDevice.hands.right.position.set(p.x, p.y, p.z + 0.5);
          w.questDevice.hands.right.quaternion.set(0, 0, 0, 1);
        });
        await page.waitForTimeout(150);
        await setSelection(page, 1);
        await setSelection(page, 0);
      },
      async () =>
        await appValue(page, "app.client.navigation.flash() === 'cancelled'"),
      { screenshotOffsetS: 0.38 },
    );
    await summonMenu(page);
    await frameMenu(page, true);
    await flow.step(
      "agent_recording",
      async () => {
        await activateRuntimeButton(page, "Agent");
        await pointRuntimeButton(page, "Agent dictation field");
        await setSelection(page, 1);
        await page.evaluate(
          (text) => (window as any).integrationTranscript(text, false),
          shared.fixtures.transcript,
        );
      },
      async () =>
        await appValue(
          page,
          "app.client.speech.snapshot().status === 'Listening'",
        ),
    );
    await flow.step(
      "agent_draft",
      async () => {
        await setSelection(page, 0);
      },
      async () =>
        (await appValue(
          page,
          "app.client.speech.snapshot().prompt.length > 0",
        )) && !runtime.commands.some((c) => c.type === "user_message_request"),
    );
    await flow.step(
      "agent_response",
      async () => {
        await activateRuntimeButton(page, "Send to agent");
        runtime.send({
          type: "agent_message",
          text:
            shared.fixtures.response +
            " Keep the doorway clear while I follow the route.".repeat(12),
        });
        await scrollResponse(page);
      },
      async () =>
        runtime.commands.some(
          (c) =>
            c.type === "user_message_request" &&
            c.text === shared.fixtures.transcript,
        ) &&
        (await appValue(
          page,
          "app.mainMenu.agent.text.includes('requested location')",
        )),
    );
    await flow.step(
      "sensors_full",
      async () => {
        await activateRuntimeButton(page, "Manual");
        await activateRuntimeButton(page, "Sensors button");
        await activateRuntimeButton(page, "Full");
        runtime.lidar();
      },
      async () => (await snapshot(page)).lidarMode === "full",
    );
    await flow.step(
      "sensors_obstacles",
      async () => {
        await activateRuntimeButton(page, "Obstacles");
      },
      async () => (await snapshot(page)).lidarMode === "obstacles",
    );
    await flow.step(
      "settings",
      async () => {
        await activateRuntimeButton(page, "Back from Sensors");
        await activateRuntimeButton(page, "Global settings");
        await activateRuntimeButton(page, "Debug · Off");
        await activateRuntimeButton(page, "Sound · On");
      },
      async () =>
        (await snapshot(page)).debugEnabled &&
        (await appValue(page, "!app.sound.enabled")),
    );
    await flow.step(
      "diagnostics",
      async () => {
        await activateRuntimeButton(page, "Diagnostics");
      },
      async () => !!(await appValue(page, "app.mainMenu.detailsOpen")),
    );
    await activateRuntimeButton(page, "Done");
    await activateRuntimeButton(page, "Done");
    await activateRuntimeButton(page, "Close");
    await worldView(page);
    await flow.step(
      "world_marker",
      async () =>
        runtime.send({
          type: "agent_skill",
          name: "ar_place_marker",
          args: { id: "door", title: "Doorway", x: 2.5, y: -0.5, z: 0.5 },
        }),
      async () =>
        await appValue(page, "app.client.markers.object.children.length > 0"),
    );
    await summonMenu(page);
    await frameMenu(page, true);
    await activateRuntimeButton(page, "Global settings");
    await flow.step(
      "relocalize",
      async () => {
        await activateRuntimeButton(page, "Re-localize");
        await expect
          .poll(() => snapshot(page).then((s) => s.wizardStep))
          .toBe("localization");
        await runtime.completeLocalization();
      },
      async () => (await snapshot(page)).setupCompleted,
    );
    await expect
      .poll(() => snapshot(page).then((s) => !s.setupCelebrating))
      .toBe(true);
    await summonMenu(page);
    await frameMenu(page, true);
    await activateRuntimeButton(page, "Global settings");
    await flow.step(
      "setup_restart",
      async () => {
        await activateRuntimeButton(page, "Setup");
        await expect
          .poll(() =>
            snapshot(page).then(
              (s) => s.wizardStep === "connect" && !s.setupCompleted,
            ),
          )
          .toBe(true);
        await activateButton(page);
        await activateButton(page);
        await summonMenu(page);
        await frameMenu(page, true);
      },
      async () =>
        (await snapshot(page)).setupCompleted &&
        (await snapshot(page)).menuOpen &&
        (await appValue(page, "!app.mainMenu.settingsOpen")),
    );
    expect(errors).toEqual([]);
  } finally {
    await flow.save(info);
  }
});
