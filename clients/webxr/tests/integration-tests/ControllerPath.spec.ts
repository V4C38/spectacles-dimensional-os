import { test, expect } from "@playwright/test";
import { join } from "node:path";
import { bootstrap } from "./fixtures/Runtime";
import { Flow } from "./fixtures/Flow";
import { summonMenu, frameMenu, activateRuntimeButton } from "./fixtures/Input";

test("controller-only walkthrough", async ({ page }, info) => {
  test.setTimeout(90000);
  const runtime = await bootstrap(page, "controller");
  await runtime.localized();
  await summonMenu(page);
  await frameMenu(page, true);
  const flow = new Flow(
    page,
    join(process.env.INTEGRATION_RESULTS_DIR ?? info.outputDir, "controller"),
    "controller",
  );
  const state = () =>
    page.evaluate(() => {
      const w = window as any;
      return w.xb.core.scene.children
        .find((o: any) => o.constructor.name === "WebXRApp")
        .client.ui.snapshot();
    });
  try {
    await flow.start();
    await flow.step(
      "controller_input",
      async () => {
        await activateRuntimeButton(page, "Robot selection button");
        await activateRuntimeButton(page, "Agent");
        await expect
          .poll(() => state().then((s) => s.operatingMode))
          .toBe("agent");
        await activateRuntimeButton(page, "Manual");
      },
      async () =>
        (await state()).operatingMode === "manual" &&
        (await state()).robotSelected,
      { durationS: 11 },
    );
    await flow.step(
      "controller_joystick",
      async () => {
        await activateRuntimeButton(page, "Close");
        await page.evaluate(() => {
          const w = window as any;
          w.questDevice.position.set(0, 1.1, 0.1);
          w.questDevice.quaternion.set(-Math.sin(0.15), 0, 0, Math.cos(0.15));
          w.questDevice.controllers.left.updateAxis(
            "thumbstick",
            "y-axis",
            -0.8,
          );
        });
        await expect
          .poll(() =>
            runtime.commands.some(
              (c) => c.type === "nav_joystick_request" && c.linear[0] > 0,
            ),
          )
          .toBe(true);
        for (let i = 0; i < 15; i++) {
          runtime.send({
            type: "pose",
            position: [2 + i / 20, 0, 0.33],
            orientation: [0, 0, 0, 1],
            ts: Date.now() / 1000,
          });
          await page.waitForTimeout(80);
        }
        await page.evaluate(() =>
          (window as any).questDevice.controllers.left.updateAxis(
            "thumbstick",
            "y-axis",
            0,
          ),
        );
      },
      async () =>
        runtime.commands.some(
          (c) =>
            c.type === "nav_joystick_request" &&
            c.linear.every((v: number) => v === 0),
        ),
      { durationS: 12 },
    );
  } finally {
    await flow.save(info);
  }
});
