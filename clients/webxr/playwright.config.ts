import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./browser-tests",
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "https://localhost:5175",
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 900 },
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
    screenshot: "only-on-failure",
    video: { mode: "on", size: { width: 1280, height: 900 } },
  },
  webServer: {
    command: "npm run dev -- --port 5175 --strictPort",
    url: "https://localhost:5175",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
  },
});
