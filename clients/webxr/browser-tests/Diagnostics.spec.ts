import { expect, test } from "@playwright/test";

test("keeps scene inspection quiet and only enables traces with explicit diagnostics opt-in", async ({ page }) => {
  const entries: { event?: string; level?: string }[] = [];
  page.on("console", async message => {
    if (message.text().startsWith("[WebXR]")) {
      const entry = await message.args()[1]?.jsonValue().catch(() => null);
      if (entry) entries.push(entry);
    }
  });
  await page.routeWebSocket("**/ar", () => {});
  await page.goto("/?debug=1");
  await page.evaluate(async () => {
    const diagnostics = await import("/src/diagnostics/BrowserDiagnostics.ts");
    diagnostics.reportDiagnostic("panel-visible", { x: 1 });
    diagnostics.reportDiagnostic("ray-select", { surface: "test" });
  });
  await page.waitForTimeout(100);
  expect(entries.filter(entry => entry.level === "debug")).toEqual([]);
  await page.goto("/?debug=1&diagnostics=1");
  await page.evaluate(async () => {
    const diagnostics = await import("/src/diagnostics/BrowserDiagnostics.ts");
    diagnostics.reportDiagnostic("panel-visible", { x: 1 });
    diagnostics.reportDiagnostic("panel-visible", { x: 2 });
  });
  await expect.poll(() => entries.filter(entry => entry.event === "panel-visible").length).toBe(1);
});
