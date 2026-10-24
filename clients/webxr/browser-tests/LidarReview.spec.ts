import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
test("renders height dots and distance obstacles in one bounded draw call", async ({ page }, info) => {
  await page.goto("/");
  const metrics = await page.evaluate(async () => {
    const fixture = await import("/browser-tests/fixtures/LidarReview.ts");
    const review = fixture.createLidarReview(); (window as any).lidarReview = review; return review.metrics;
  });
  expect(metrics.drawCalls).toBe(1); expect(metrics.pointCount).toBe(4000);
  await writeFile(info.outputPath("lidar-performance.json"), JSON.stringify(metrics, null, 2));
  await info.attach("lidar-performance.json", { path: info.outputPath("lidar-performance.json"), contentType: "application/json" });
  await page.waitForTimeout(1200); await page.screenshot({ path: info.outputPath("lidar-height.png") });
  await page.waitForTimeout(1800);
  await page.evaluate(() => (window as any).lidarReview.show("obstacles"));
  await page.waitForTimeout(1200); await page.screenshot({ path: info.outputPath("lidar-obstacles.png") });
  await page.waitForTimeout(1800);
  await page.evaluate(() => (window as any).lidarReview.show("full"));
  await page.waitForTimeout(2000);
  await page.evaluate(() => (window as any).lidarReview.dispose());
});
