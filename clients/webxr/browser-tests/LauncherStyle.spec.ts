import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("uses compact monochrome desktop chrome in the launcher", async ({ page }, info) => {
  for (const [url, name, contentType] of [
    ["**/launcher-review", "index.html", "text/html"],
    ["**/static/app.css", "app.css", "text/css"],
    ["**/static/app.js", "app.js", "application/javascript"],
  ]) {
    const body = await readFile(new URL(`../../../launcher/app/static/${name}`, import.meta.url), "utf8");
    await page.route(url, route => route.fulfill({ contentType, body }));
  }
  await page.route("**/api/**", route => route.fulfill({ json: { phase: "idle", check_ok: true, host_ip: "192.168.1.2", robot_ip: "192.168.123.161", refs: ["main"] } }));
  await page.addInitScript(() => { (window as any).EventSource = class { onmessage = null; }; });
  await page.goto("/launcher-review");
  const start = page.locator("#startBtn");
  await expect(start).toBeEnabled();
  await expect(start).toHaveCSS("color", "rgb(23, 23, 25)");
  await expect(start).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator(".app-toolbar #actionsBar")).toBeVisible();
  await expect(page.locator(".app")).toHaveCSS("display", "grid");
  await expect(page.locator("#sidePanel")).toHaveCSS("background-color", "rgb(38, 38, 40)");
  await page.screenshot({ path: info.outputPath("launcher-desktop.png") });
});
