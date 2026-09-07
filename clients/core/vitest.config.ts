import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "websocket/**/*.ts",
        "localization/**/*.ts",
        "navigation/**/*.ts",
        "sensors/**/*.ts",
      ],
    },
  },
});
