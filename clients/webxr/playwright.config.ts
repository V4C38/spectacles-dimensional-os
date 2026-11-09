import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: "./tests/integration-tests",
  workers: 1,
  reporter: [["list"], ["json", { outputFile: process.env.INTEGRATION_RESULTS_DIR ? `${process.env.INTEGRATION_RESULTS_DIR}/playwright-results.json` : "../../Review Data/unit/browser/results.json" }]],
  outputDir: process.env.INTEGRATION_RESULTS_DIR ? `${process.env.INTEGRATION_RESULTS_DIR}/diagnostics/playwright` : fileURLToPath(new URL("../../Review Data/webxr/playwright", import.meta.url)),
  timeout: 30000,
  expect: { timeout: 15000 },
  use: {
    baseURL: "https://localhost:5175",
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 900 },
    launchOptions: { args: [process.platform === "darwin" ? "--use-angle=metal" : "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
    screenshot: "only-on-failure",
    video: { mode: process.env.INTEGRATION_EXTRA_MEDIA === "1" ? "on" : "retain-on-failure", size: { width: 1280, height: 900 } },
  },
  webServer: {
    command: process.env.INTEGRATION_PRODUCTION === "1" ? "npm run preview -- --port 5175 --strictPort" : "npm run dev -- --port 5175 --strictPort",
    url: "https://localhost:5175",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
  },
});
