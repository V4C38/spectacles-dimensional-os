import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const output = resolve(process.argv[2] ?? "tests/integration-tests/test-results/material-direction");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  for (const kind of ["arm", "strokes"]) for (const baseline of [true, false]) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, ignoreHTTPSErrors: true });
    page.on("pageerror", error => { console.error(error); });
    await page.route("**/material-review", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><html><head><title>WebXR material direction</title></head><body></body></html>" }));
    await page.goto("https://localhost:5176/material-review");
    await page.evaluate(async ({ kind, baseline }) => {
      const { renderMaterialReview } = await import("/tools/material-review.ts");
      await renderMaterialReview(kind, baseline);
    }, { kind, baseline });
    const path = resolve(output, `${kind}-${baseline ? "current" : "proposed"}.png`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path }); console.log(path);
    await page.close();
  }
} finally { await browser.close(); }
