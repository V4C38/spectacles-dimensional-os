import { expect, test } from "@playwright/test";
import { bootstrap } from "./fixtures/Runtime";
import { frameMenu } from "./fixtures/Input";

for (const capture of [true, false]) {
  test(`shows the complete localization fallback status (preview=${capture})`, async ({ page }, testInfo) => {
    const runtime = await bootstrap(page);
    const message = "VPS could not localize. Look at the robot marker.";
    await page.evaluate(({ capture, message }) => {
      const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
      const snapshot = app.client.ui.snapshot.bind(app.client.ui);
      app.client.ui.snapshot = () => ({ ...snapshot(), setupCompleted: false, setupCelebrating: false,
        wizardStep: "localization", localizationKind: capture ? "marker" : "unavailable",
        wizardCardTitle: message, wizardCardBody: "Keep the marker visible", localizationIssue: null });
    }, { capture, message });
    await expect.poll(() => page.evaluate(({ capture, message }) => {
      const app = (window as any).xb.core.scene.children.find((o: any) => o.client?.manipulation);
      const title = app.mainMenu.pageViews.setup.cardTitle;
      const text = title.textObj;
      const bounds = text?.textRenderInfo?.blockBounds;
      if (title.text !== message || !bounds || text._needsSync) return false;
      const clip = text.clipRect;
      return text.lineHeight === 1.2 && bounds[3] - bounds[1] >= text.fontSize * (capture ? 2 : 1) && bounds[0] >= clip[0] && bounds[1] >= clip[1] && bounds[2] <= clip[2] && bounds[3] <= clip[3];
    }, { capture, message })).toBe(true);
    await frameMenu(page, true);
    await page.screenshot({ path: testInfo.outputPath("localization-status.png") });
    runtime.close();
  });
}
