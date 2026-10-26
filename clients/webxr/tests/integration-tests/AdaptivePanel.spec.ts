import { test, expect, type Page } from "@playwright/test";
import { bootstrap } from "./fixtures/Runtime";
import { frameMenu } from "./fixtures/Input";

async function state(page: Page, overrides: Record<string, unknown>, subpage = "main", advance = 0.28) {
  return page.evaluate(({ overrides, subpage, advance }) => {
    const w = window as any;
    const app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
    const menu = app.mainMenu;
    w.adaptiveSnapshot = { ...w.adaptiveBase,
      ...(overrides.setupCompleted ? { robotSelectable: true, robotSelected: true, agentAvailable: true, estopAvailable: true } : {}),
      ...(overrides.wizardStep === "localization" ? { connectComplete: true, backVisible: true, nextLabel: "Skip" } : {}),
      ...overrides };
    menu.settingsOpen = subpage === "settings";
    menu.sensorsOpen = subpage === "sensors";
    menu.detailsOpen = subpage === "diagnostics";
    menu.apply(w.adaptiveSnapshot, { prompt: "Go to the kitchen", response: "I can help with that.", status: "Ready", recognitionAvailable: true });
    w.advancePanel(advance);
    menu.updateHover([], 0.28);
    const plate = menu.plate;
    const top = plate.localToWorld(plate.position.clone().set(0, menu.heightController.height / 2, 0));
    return { height: menu.heightController.height, target: menu.heightController.target, top: top.toArray() };
  }, { overrides, subpage, advance });
}

// Synthetic UI snapshots isolate every layout state while retaining real WebGL,
// XR Blocks controls, XR frame updates and the emulated headset renderer.
test("adaptive setup and runtime panels keep a fixed top through resizing", async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const runtime = await bootstrap(page, "controller");
  await frameMenu(page);
  await page.evaluate(() => {
    const w = window as any;
    const app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
    app.setupPlacement.pin(); app.menuAnchor.detach();
    w.adaptiveBase = { ...app.client.ui.snapshot(), setupCompleted: false, setupCelebrating: false, menuOpen: true,
      connectComplete: false, connectionTone: "muted", operatingMode: "manual", wizardStep: "connect", localizationIssue: null,
      wizardCardTitle: "Connecting", wizardCardBody: "Waiting for the launcher.", wizardDescription: "", alignmentReview: null };
    w.adaptiveSnapshot = w.adaptiveBase;
    app.client.speech.snapshot = () => ({ prompt: "Go to the kitchen", response: "I can help with that.",
      status: "Ready", recognitionAvailable: true, error: null, severity: "ok" });
    app.client.ui.snapshot = () => w.adaptiveSnapshot;
    w.advancePanel = app.mainMenu.heightController.tick.bind(app.mainMenu.heightController);
    app.mainMenu.heightController.tick = () => {};
    const input = w.questDevice.controllers.right;
    input.position.set(1, 0.5, -0.2);
    document.body.style.background = "#182028";
    document.querySelector("canvas")!.style.background = "#182028";
  });
  const capture = async (name: string) => {
    // Allow the actual XR renderer and SDF text sync to display the settled geometry.
    await page.waitForTimeout(200);
    const path = info.outputPath(`${name}.png`);
    await page.screenshot({ path });
    await info.attach(name, { path, contentType: "image/png" });
  };
  try {
    const entry = await state(page, {});
    await capture("setup-connecting");
    const connected = await state(page, { connectComplete: true, connectionTone: "success", wizardCardTitle: "Connected to dimOS ARModule",
      wizardCardBody: "WebSocket connected\nRobot: Go2\nAvailable: Navigation, Agent, LiDAR" });
    expect(connected.height).toBeGreaterThan(entry.height);
    expect(connected.top).toEqual(entry.top);
    await capture("setup-connected");
    await state(page, { connectionTone: "error", wizardCardTitle: "Connection failed", wizardCardBody: "The server could not be reached. Reconnect to try again." });
    await capture("setup-connection-error");
    await state(page, { wizardStep: "localization", localizationKind: "marker", wizardDescription: "AprilTag", wizardCardTitle: "Frame the tag", wizardCardBody: "Frame the tag at the guide’s approximate size." });
    await capture("setup-capture");
    await state(page, { wizardStep: "localization", localizationIssue: "Camera unavailable", wizardDescription: "AprilTag", wizardCardTitle: "Camera unavailable", wizardCardBody: "The camera is unavailable. Try again or skip to continue." });
    await capture("setup-camera-error");
    await state(page, { wizardStep: "localization", localizationKind: "unavailable", wizardDescription: "No localization provider", wizardCardTitle: "Localization unavailable", wizardCardBody: "Skip to continue without localization." });
    await capture("setup-unavailable");
    await state(page, { setupCompleted: true, setupCelebrating: true, setupSuccessProgress: 1 });
    await capture("setup-success");
    const manual = await state(page, { setupCompleted: true });
    await capture("runtime-manual");
    const middle = await state(page, { setupCompleted: true, operatingMode: "agent" }, "main", 0.14);
    expect(middle.height).toBeGreaterThan(manual.height);
    expect(middle.height).toBeLessThan(middle.target);
    for (let i = 0; i < 3; i++) expect(middle.top[i]).toBeCloseTo(manual.top[i], 6);
    await capture("runtime-growing");
    const agent = await state(page, { setupCompleted: true, operatingMode: "agent" }, "main", 0.14);
    expect(agent.height).toBe(agent.target);
    await capture("runtime-agent");
    const shrinking = await state(page, { setupCompleted: true }, "main", 0.14);
    expect(shrinking.height).toBeGreaterThan(shrinking.target);
    for (let i = 0; i < 3; i++) expect(shrinking.top[i]).toBeCloseTo(manual.top[i], 6);
    await capture("runtime-shrinking");
    for (const subpage of ["settings", "sensors", "diagnostics"]) {
      await state(page, { setupCompleted: true }, subpage);
      await capture(`runtime-${subpage}`);
    }
    await state(page, { setupCompleted: true, alignmentReview: { reason: "Tracking resumed", pending: true } });
    await capture("runtime-alignment");
    await page.evaluate(() => {
      const w = window as any;
      const app = w.xb.core.scene.children.find((o: any) => o.constructor.name === "WebXRApp");
      app.client.notifications.show({ text: "Emergency stop requested", tone: "danger", glyph: "stop", priority: 100, durationS: 30 });
    });
    await capture("notification-upward-tilt");
    expect(errors).toEqual([]);
  } finally {
    runtime.close();
  }
});
