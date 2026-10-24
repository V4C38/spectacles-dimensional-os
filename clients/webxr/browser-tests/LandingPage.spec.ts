import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

test("prioritizes robot features with compact technical footnotes on desktop and mobile", async ({ page }, info) => {
  test.setTimeout(90000);
  await page.addInitScript({ path: fileURLToPath(new URL("../node_modules/iwer/build/iwer.js", import.meta.url)) });
  await page.addInitScript(() => {
    const w = window as any;
    w.questDevice = new w.IWER.XRDevice(w.IWER.metaQuest3);
    w.questDevice.installRuntime({ forceInstall: true });
  });
  const on = { available: true, reason: null };
  await page.routeWebSocket("**/ar", socket => {
    socket.onMessage(raw => {
      if (typeof raw !== "string") return;
      const request = JSON.parse(raw);
      if (request.type !== "hello_request") return;
      socket.send(JSON.stringify({ type: "hello", client_id: "landing-review", time_sync: { ts_client: request.ts_client, ts_server: 1 },
        robot: { display_name: "Unitree Go2", body_bounds_m: [0.7, 0.5, 0.55], footprint_m: [0.7, 0.5], base_height_m: 0.33 },
        server_info: { robot_ip: "192.168.1.42", dimos_version: "0.4.0", armodule_version: "0.2.0" },
        capabilities: { navigation: { ...on, nav_goal: on, nav_joystick: on }, agent: on, lidar: on, localization: on, estop: on } }) + "\n");
    });
  });
  await page.goto("/");
  await expect(page.locator("#enter")).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Unitree Go2" })).toBeVisible();
  await expect(page.locator(".feature-list li:visible")).toHaveCount(5);
  await expect(page.locator(".connection-footnote")).toContainText("192.168.1.42");
  await expect(page.locator(".connection-panel")).not.toContainText("0.4.0");
  await expect(page.locator(".connection-panel")).not.toContainText("192.168");
  await expect(page.locator(".robot-status-dot")).toHaveCSS("background-color", "rgb(48, 209, 88)");
  await page.screenshot({ path: info.outputPath("landing-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator("#enter")).toBeInViewport();
  await page.screenshot({ path: info.outputPath("landing-mobile.png"), fullPage: true });
});
