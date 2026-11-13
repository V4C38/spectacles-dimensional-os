import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    reporters: ["default", "json"],
    outputFile: { json: fileURLToPath(new URL("../../Review Data/unit/core/results.json", import.meta.url)) },
  },
});
