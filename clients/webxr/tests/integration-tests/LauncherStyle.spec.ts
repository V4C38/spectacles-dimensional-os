import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("uses compact monochrome desktop chrome in the launcher", async ({ page }, info) => {
  for (const [url, name, contentType] of [
    ["**/launcher-review", "index.html", "text/html"],
    ["**/static/app.css", "app.css", "text/css"],
    ["**/static/app.js", "app.js", "application/javascript"],
  ]) {
    const body = await readFile(new URL(`../../../../launcher/app/static/${name}`, import.meta.url), "utf8");
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

async function launcherWithHardwareChecks(page: import("@playwright/test").Page, plannerReady = true) {
  const profiles = ["unitree_go2", "openyam"].map(robot => ({
    id: robot, robot, name: robot, settings: {fiducial_marker: true, vps: false, map_code: null,
      mounts: [{marker_id: 0, print_size_mm: 70, forward_m: 0, lateral_m: 0, up_m: 0, yaw_deg: 0, pitch_deg: 0, roll_deg: 0}]},
  }));
  let canReady = false;
  const planner = {ready: plannerReady, state: plannerReady ? "ready" : "incomplete", message: plannerReady ? "Manipulation planner ready" : "RoboPlan does not match DimOS"};
  for (const [url, name, contentType] of [
    ["**/launcher-review", "index.html", "text/html"],
    ["**/static/app.css", "app.css", "text/css"],
    ["**/static/app.js", "app.js", "application/javascript"],
  ]) {
    const body = await readFile(new URL(`../../../../launcher/app/static/${name}`, import.meta.url), "utf8");
    await page.route(url, route => route.fulfill({contentType, body}));
  }
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/robot-profiles") return route.fulfill({json: {profiles}});
    if (path === "/api/planner/status") return route.fulfill({json: planner});
    if (path === "/api/can/setup") canReady = true;
    if (path.startsWith("/api/can/")) return route.fulfill({json: {
      ready: canReady, state: canReady ? "ready" : "down", message: canReady ? "can0 ready · 1 Mbit/s" : "can0 is down. Set up CAN to continue.",
    }});
    return route.fulfill({json: {phase: "ready", check_ok: true, dimos_python: "/selected/python3", planner, refs: ["main"]}});
  });
  await page.addInitScript(() => { (window as any).EventSource = class { onmessage = null; }; });
  await page.goto("/launcher-review");
  await page.selectOption("#blueprintSelect", "openyam_ar_planner");
  await page.locator("#canCard summary").click();
}

test("OpenYAM CAN card checks readiness, configures on click, and hides for Go2", async ({page}, info) => {
  await launcherWithHardwareChecks(page);
  await expect(page.locator("#canStatus")).toContainText("can0 is down");
  await expect(page.locator("#startBtn")).toBeDisabled();
  await expect(page.locator("#canSetupBtn")).toBeEnabled();
  await page.screenshot({path: info.outputPath("launcher-can-incomplete.png")});
  await page.locator("#canSetupBtn").click();
  await expect(page.locator("#canStatus")).toContainText("can0 ready");
  await expect(page.locator("#startBtn")).toBeEnabled();
  await expect(page.locator("#canSetupBtn")).toBeDisabled();
  await page.screenshot({path: info.outputPath("launcher-can-ready.png")});
  await page.selectOption("#blueprintSelect", "unitree_go2_ar");
  await expect(page.locator("#canCard")).toBeHidden();
});

test("mock hardware bypasses CAN but still requires compatible planner dependencies", async ({page}) => {
  await launcherWithHardwareChecks(page);
  await expect(page.locator("#startBtn")).toBeDisabled();
  await page.locator("#simulationEnabled").check();
  await expect(page.locator("#canStatus")).toHaveText("Not required for mock hardware.");
  await expect(page.locator("#startBtn")).toBeEnabled();
  await expect(page.locator("#canSetupBtn")).toBeDisabled();
});

test("incompatible planner keeps mock startup disabled and exposes dependency repair", async ({page}) => {
  await launcherWithHardwareChecks(page, false);
  await page.locator("#simulationEnabled").check();
  await expect(page.locator("#startBtn")).toBeDisabled();
  await page.locator("#installBanner summary").click();
  await expect(page.locator("#plannerStatus")).toContainText("RoboPlan does not match");
  await expect(page.locator("#installBtn")).toBeVisible();
});
